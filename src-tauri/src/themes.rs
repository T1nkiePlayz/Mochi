use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
    sync::Mutex,
};
use crate::util::{fsio::write_atomic_durable, valid_id as valid_segment, MutexExt};
use tauri::{AppHandle, Manager};

const CONFIG_FILE: &str = "config.json";
const MAX_THEME_ASSET_BYTES: usize = 10 * 1024 * 1024;
const THEMES_DIR: &str = "themes";
const LOCATION_FILE: &str = ".mochi-location";
const MAX_MANIFEST_BYTES: u64 = 1024 * 1024;
const MAX_THEME_CSS_BYTES: u64 = 1024 * 1024;
const MAX_THEME_ASSETS: usize = 64;
const MAX_THEME_ASSET_TOTAL_BYTES: u64 = 48 * 1024 * 1024;

/// Serialises every read-modify-write of config.json (theme switches can race with startup or a location move).
static CONFIG_LOCK: Mutex<()> = Mutex::new(());

fn config_guard() -> std::sync::MutexGuard<'static, ()> {
    CONFIG_LOCK.lock_recover()
}

/// A themes folder import may not drag in an unbounded tree.
#[derive(Debug)]
struct CopyBudget { entries: usize, bytes: u64 }

const THEME_IMPORT_MAX_ENTRIES: usize = 2_000;
const THEME_IMPORT_MAX_BYTES: u64 = 96 * 1024 * 1024;
const THEME_IMPORT_MAX_DEPTH: usize = 8;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeManifest {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub colors: BTreeMap<String, String>,
    #[serde(default)]
    pub ui: BTreeMap<String, String>,
    #[serde(default)]
    pub typography: BTreeMap<String, String>,
    #[serde(default)]
    pub layout: BTreeMap<String, String>,
    #[serde(default)]
    pub effects: BTreeMap<String, String>,
    #[serde(default)]
    pub components: BTreeMap<String, String>,
    #[serde(default)]
    pub icons: BTreeMap<String, String>,
    #[serde(default)]
    pub assets: BTreeMap<String, String>,
    #[serde(default)]
    pub fonts: Vec<String>,
    #[serde(default)]
    pub scheme: Option<String>,
    #[serde(default)]
    pub shell: Option<String>,
    /// Interface sound pack this theme suggests (a built-in or installed pack id).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sound_pack: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserThemeDescriptor {
    pub id: String,
    pub name: String,
    pub version: String,
    pub author: String,
    pub description: String,
    pub source: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedUserTheme {
    pub manifest: ThemeManifest,
    pub css: String,
    pub assets: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MochiConfigInfo {
    pub config_path: String,
    pub themes_path: String,
    pub selected_theme: String,
}

fn default_config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .config_dir()
        .map(|path| path.join("Mochi"))
        .map_err(|error| format!("Unable to resolve Mochi config directory: {error}"))
}

pub(crate) fn config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let default_root = default_config_dir(app)?;
    let location_file = default_root.join(LOCATION_FILE);
    if let Ok(location) = fs::read_to_string(&location_file) {
        let path = PathBuf::from(location.trim());
        // The marker is only ever written for a folder named "Mochi"; refuse anything
        // else so a stray or edited marker can never redirect (or delete) another folder.
        if path.is_absolute() && !path.components().any(|part| matches!(part, Component::ParentDir)) && path.is_dir() && path.file_name().and_then(|name| name.to_str()) == Some("Mochi") {
            return Ok(path);
        }
    }
    Ok(default_root)
}

pub fn game_artwork_cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let path = config_dir(app)?.join("game-artwork");
    fs::create_dir_all(&path).map_err(|error| format!("Unable to create game artwork cache: {error}"))?;
    Ok(path)
}

pub fn initialize_config(app: &AppHandle) -> Result<(), String> {
    let _ = ensure_config(app)?;
    let _ = themes_dir(app)?;
    Ok(())
}

fn themes_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let root = config_dir(app)?;
    let themes = root.join(THEMES_DIR);
    fs::create_dir_all(&themes)
        .map_err(|error| format!("Unable to create Mochi themes directory: {error}"))?;
    Ok(themes)
}

fn ensure_config(app: &AppHandle) -> Result<(PathBuf, Value), String> {
    let _guard = config_guard();
    ensure_config_locked(app)
}

fn ensure_config_locked(app: &AppHandle) -> Result<(PathBuf, Value), String> {
    ensure_config_in(&config_dir(app)?)
}

fn ensure_config_in(root: &Path) -> Result<(PathBuf, Value), String> {
    fs::create_dir_all(root)
        .map_err(|error| format!("Unable to create Mochi config directory: {error}"))?;

    let path = root.join(CONFIG_FILE);
    if !path.exists() {
        let value = json!({
            "schemaVersion": 1,
            "theme": "mochi",
            "settings": {}
        });
        write_json_atomic(&path, &value)?;
        return Ok((path, value));
    }

    let parsed = match fs::read_to_string(&path) {
        Ok(raw) => serde_json::from_str::<Value>(&raw).ok().filter(Value::is_object),
        // Not valid UTF-8 counts as corrupt too; any other I/O error (permissions, disk) is a real failure.
        Err(error) if error.kind() == std::io::ErrorKind::InvalidData => None,
        Err(error) => return Err(format!("Unable to read Mochi config: {error}")),
    };
    match parsed {
        Some(value) => Ok((path, value)),
        None => {
            // A corrupt config must not stop Mochi from starting: keep a copy and start fresh.
            let _ = fs::rename(&path, path.with_extension("json.corrupt"));
            let value = json!({ "schemaVersion": 1, "theme": "mochi", "settings": {} });
            write_json_atomic(&path, &value)?;
            Ok((path, value))
        }
    }
}

fn write_json_atomic(path: &Path, value: &Value) -> Result<(), String> {
    let content = serde_json::to_string_pretty(value)
        .map_err(|error| format!("Unable to serialize Mochi config: {error}"))?;
    write_atomic_durable(path, format!("{content}\n").as_bytes()).map_err(|error| format!("Unable to write Mochi config: {error}"))
}

fn valid_id(id: &str) -> bool { valid_segment(id, 80) }

fn validate_manifest(manifest: &ThemeManifest) -> Result<(), String> {
    if manifest.schema_version != 1 {
        return Err(format!(
            "Unsupported theme schema version {}. This version of Mochi supports schema version 1.",
            manifest.schema_version
        ));
    }
    if !valid_id(&manifest.id) {
        return Err("Theme IDs may only contain letters, numbers, hyphens and underscores.".into());
    }
    if manifest.name.trim().is_empty() {
        return Err("A theme must have a name.".into());
    }
    if manifest.fonts.len() > 6 || manifest.fonts.iter().any(|font| crate::fonts::allowed_css_url(font).is_none()) {
        return Err("Theme fonts must be at most 6 Google Fonts stylesheets (https://fonts.googleapis.com/css...).".into());
    }
    if manifest.shell.as_deref().is_some_and(|shell| !["left", "right", "top", "bottom", "rail"].contains(&shell)) {
        return Err("A theme's shell must be left, right, top, bottom or rail.".into());
    }
    if manifest.sound_pack.as_deref().is_some_and(|pack| !crate::soundpacks::valid_pack_id(pack)) {
        return Err("A theme's soundPack must be a sound pack id.".into());
    }
    if manifest.scheme.as_deref().is_some_and(|scheme| scheme != "light" && scheme != "dark") {
        return Err("A theme's scheme must be \"light\" or \"dark\".".into());
    }
    Ok(())
}

fn safe_relative_path(path: &str) -> Result<PathBuf, String> {
    let candidate = Path::new(path);
    if candidate.is_absolute() {
        return Err("Theme asset paths must be relative.".into());
    }
    for component in candidate.components() {
        if matches!(component, Component::ParentDir | Component::RootDir | Component::Prefix(_)) {
            return Err("Theme asset paths may not escape the theme directory.".into());
        }
    }
    Ok(candidate.to_path_buf())
}

fn mime_type(path: &Path) -> &'static str {
    match path.extension().and_then(|extension| extension.to_str()).unwrap_or_default().to_ascii_lowercase().as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        "avif" => "image/avif",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        _ => "application/octet-stream",
    }
}

fn load_assets(root: &Path, manifest: &ThemeManifest) -> Result<BTreeMap<String, String>, String> {
    let mut result = BTreeMap::new();
    let mut declared_assets = manifest.assets.clone();
    for (logical_name, relative_path) in &manifest.icons {
        declared_assets.insert("icon:".to_owned() + logical_name, relative_path.clone());
    }
    if declared_assets.len() > MAX_THEME_ASSETS {
        return Err(format!("A theme may declare at most {MAX_THEME_ASSETS} assets."));
    }
    let canonical_root = fs::canonicalize(root).map_err(|error| format!("Unable to resolve the theme folder: {error}"))?;
    let mut total = 0u64;

    for (logical_name, relative_path) in &declared_assets {
        let relative = safe_relative_path(relative_path)?;
        let path = root.join(&relative);
        if !path.is_file() {
            return Err(format!("Theme asset '{relative_path}' was not found."));
        }
        // A symlink inside a hand-made theme folder must not pull in files from elsewhere.
        let resolved = fs::canonicalize(&path)
            .map_err(|error| format!("Unable to inspect theme asset '{relative_path}': {error}"))?;
        if !resolved.starts_with(&canonical_root) {
            return Err(format!("Theme asset '{relative_path}' points outside the theme folder."));
        }
        let metadata = fs::metadata(&resolved)
            .map_err(|error| format!("Unable to inspect theme asset '{relative_path}': {error}"))?;
        if metadata.len() > MAX_THEME_ASSET_BYTES as u64 {
            return Err(format!("Theme asset '{relative_path}' exceeds the 10 MiB limit."));
        }
        total += metadata.len();
        if total > MAX_THEME_ASSET_TOTAL_BYTES {
            return Err("Theme assets exceed the 48 MiB total limit.".into());
        }
        let bytes = read_limited(&resolved, MAX_THEME_ASSET_BYTES as u64)
            .map_err(|error| format!("Unable to read theme asset '{relative_path}': {error}"))?;
        let encoded = STANDARD.encode(bytes);
        result.insert(
            logical_name.clone(),
            format!("data:{};base64,{encoded}", mime_type(&path)),
        );
    }
    Ok(result)
}

/// Reads at most `limit` bytes and fails when the file is bigger (it may have grown since `metadata`).
fn read_limited(path: &Path, limit: u64) -> std::io::Result<Vec<u8>> {
    let mut bytes = Vec::new();
    fs::File::open(path)?.take(limit + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > limit { return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "file is too large")); }
    Ok(bytes)
}

fn read_manifest(path: &Path) -> Result<ThemeManifest, String> {
    let label = path.file_name().and_then(|name| name.to_str()).unwrap_or("theme.json");
    let bytes = read_limited(path, MAX_MANIFEST_BYTES)
        .map_err(|error| format!("Unable to read theme manifest '{label}': {error}"))?;
    parse_manifest(&bytes, label)
}

fn parse_manifest(bytes: &[u8], label: &str) -> Result<ThemeManifest, String> {
    let manifest = serde_json::from_slice::<ThemeManifest>(bytes)
        .map_err(|error| format!("Theme manifest '{label}' is invalid JSON: {error}"))?;
    validate_manifest(&manifest)?;
    Ok(manifest)
}

fn copy_directory_recursive(source: &Path, destination: &Path, depth: usize, budget: &mut CopyBudget) -> Result<(), String> {
    if depth > THEME_IMPORT_MAX_DEPTH { return Err("The theme folder is nested too deeply.".into()); }
    fs::create_dir_all(destination)
        .map_err(|error| format!("Unable to create theme directory: {error}"))?;

    for entry in fs::read_dir(source)
        .map_err(|error| format!("Unable to read theme directory: {error}"))?
    {
        let entry = entry.map_err(|error| format!("Unable to inspect theme entry: {error}"))?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        // Symlinks could pull in files from outside the theme (or loop forever).
        let file_type = entry.file_type().map_err(|error| format!("Unable to inspect theme entry: {error}"))?;
        budget.entries += 1;
        if budget.entries > THEME_IMPORT_MAX_ENTRIES { return Err("The theme folder contains too many files.".into()); }
        if file_type.is_symlink() {
            continue;
        } else if file_type.is_dir() {
            copy_directory_recursive(&source_path, &destination_path, depth + 1, budget)?;
        } else if file_type.is_file() {
            let size = entry.metadata().map_err(|error| format!("Unable to inspect theme entry: {error}"))?.len();
            budget.bytes = budget.bytes.saturating_add(size);
            if budget.bytes > THEME_IMPORT_MAX_BYTES { return Err("The theme folder is larger than the 96 MiB limit.".into()); }
            fs::copy(&source_path, &destination_path)
                .map_err(|error| format!("Unable to copy theme file: {error}"))?;
        }
    }
    Ok(())
}

pub fn get_mochi_config_info(app: AppHandle) -> Result<MochiConfigInfo, String> {
    let (path, value) = ensure_config(&app)?;
    let themes = themes_dir(&app)?;
    let selected_theme = value
        .get("theme")
        .and_then(Value::as_str)
        .unwrap_or("mochi")
        .to_owned();

    Ok(MochiConfigInfo {
        config_path: path.to_string_lossy().into_owned(),
        themes_path: themes.to_string_lossy().into_owned(),
        selected_theme,
    })
}

pub fn set_mochi_theme(app: AppHandle, theme_id: String) -> Result<(), String> {
    if !valid_id(&theme_id) {
        return Err("Invalid theme ID.".into());
    }
    let _guard = config_guard();
    let (path, mut value) = ensure_config_locked(&app)?;
    if !value.is_object() {
        value = json!({});
    }
    value["schemaVersion"] = json!(1);
    value["theme"] = Value::String(theme_id);
    if value.get("settings").is_none() {
        value["settings"] = json!({});
    }
    write_json_atomic(&path, &value)
}

pub fn list_user_themes(app: AppHandle) -> Result<Vec<UserThemeDescriptor>, String> {
    let root = themes_dir(&app)?;
    let mut themes = Vec::new();

    for entry in fs::read_dir(root).map_err(|error| format!("Unable to scan themes: {error}"))? {
        let Ok(entry) = entry else { continue };
        let path = entry.path();

        let manifest_path = if path.is_dir() {
            path.join("theme.json")
        } else if path.extension().and_then(|extension| extension.to_str()) == Some("json") {
            path.clone()
        } else {
            continue;
        };

        if !manifest_path.is_file() {
            continue;
        }

        // load_user_theme resolves a theme by folder/file name, so a manifest whose id differs could be listed but never loaded.
        let stem = if path.is_dir() { path.file_name() } else { path.file_stem() }.and_then(|name| name.to_str()).unwrap_or_default().to_owned();
        match read_manifest(&manifest_path).and_then(|manifest| {
            if manifest.id == stem { Ok(manifest) } else { Err(format!("its id '{}' does not match '{stem}'", manifest.id)) }
        }) {
            Ok(manifest) => themes.push(UserThemeDescriptor {
                id: manifest.id,
                name: manifest.name,
                version: manifest.version,
                author: manifest.author,
                description: manifest.description,
                source: "user".into(),
            }),
            Err(error) => eprintln!("Ignoring invalid Mochi theme '{}': {error}", path.display()),
        }
    }

    themes.sort_by_key(|theme| theme.name.to_lowercase());
    Ok(themes)
}

pub fn load_user_theme(app: AppHandle, theme_id: String) -> Result<LoadedUserTheme, String> {
    if !valid_id(&theme_id) {
        return Err("Invalid theme ID.".into());
    }

    let root = themes_dir(&app)?;
    let folder = root.join(&theme_id);
    let file = root.join(format!("{theme_id}.json"));
    let (theme_root, manifest_path) = if folder.join("theme.json").is_file() {
        (folder.clone(), folder.join("theme.json"))
    } else if file.is_file() {
        (root.clone(), file)
    } else {
        return Err(format!("User theme '{theme_id}' was not found."));
    };

    let manifest = read_manifest(&manifest_path)?;
    if manifest.id != theme_id {
        return Err("Theme ID does not match its requested identifier.".into());
    }

    // A standalone <id>.json theme shares the themes folder with every other theme,
    // so only folder themes may supply CSS and assets.
    let is_folder_theme = theme_root != root;
    let css_path = if is_folder_theme {
        theme_root.join("theme.css")
    } else {
        PathBuf::new()
    };
    let css = if css_path.is_file() {
        let bytes = read_limited(&css_path, MAX_THEME_CSS_BYTES)
            .map_err(|error| format!("Unable to read theme CSS (limit 1 MiB): {error}"))?;
        String::from_utf8(bytes).map_err(|_| "Theme CSS must be UTF-8 text.".to_string())?
    } else {
        String::new()
    };

    let assets = if is_folder_theme {
        load_assets(&theme_root, &manifest)?
    } else {
        BTreeMap::new()
    };

    Ok(LoadedUserTheme { manifest, css, assets })
}

pub fn import_theme(app: AppHandle, source_path: String) -> Result<UserThemeDescriptor, String> {
    let source = PathBuf::from(source_path);
    if !source.exists() {
        return Err("The selected theme does not exist.".into());
    }

    let source_manifest = if source.is_dir() {
        source.join("theme.json")
    } else {
        source.clone()
    };

    if !source_manifest.is_file() {
        return Err("The selected folder does not contain a theme.json manifest.".into());
    }

    let manifest = read_manifest(&source_manifest)?;
    let themes = themes_dir(&app)?;

    let destination = if source.is_dir() {
        themes.join(&manifest.id)
    } else {
        themes.join(format!("{}.json", manifest.id))
    };

    if destination.exists() {
        return Err(format!("A theme with the ID '{}' is already installed.", manifest.id));
    }

    if source.is_dir() {
        // Importing the themes folder (or a parent of it) into itself would recurse.
        if let (Ok(src), Ok(dst)) = (fs::canonicalize(&source), fs::canonicalize(&themes)) {
            if dst.starts_with(&src) { return Err("Choose the theme's own folder, not a folder that contains Mochi's themes.".into()); }
        }
        // create_dir (not create_dir_all) fails if the folder appeared since the check above.
        fs::create_dir(&destination).map_err(|error| format!("Unable to import theme: {error}"))?;
        let mut budget = CopyBudget { entries: 0, bytes: 0 };
        if let Err(error) = copy_directory_recursive(&source, &destination, 0, &mut budget) {
            let _ = fs::remove_dir_all(&destination);
            return Err(error);
        }
    } else {
        let bytes = read_limited(&source, MAX_MANIFEST_BYTES).map_err(|error| format!("Unable to import theme: {error}"))?;
        let mut out = fs::OpenOptions::new().write(true).create_new(true).open(&destination)
            .map_err(|error| format!("Unable to import theme: {error}"))?;
        if let Err(error) = std::io::Write::write_all(&mut out, &bytes) {
            drop(out);
            let _ = fs::remove_file(&destination);
            return Err(format!("Unable to import theme: {error}"));
        }
    }

    Ok(UserThemeDescriptor {
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        author: manifest.author,
        description: manifest.description,
        source: "user".into(),
    })
}



fn copy_directory_contents(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir_all(destination)
        .map_err(|error| format!("Unable to create destination directory: {error}"))?;
    for entry in fs::read_dir(source)
        .map_err(|error| format!("Unable to read source directory: {error}"))?
    {
        let entry = entry.map_err(|error| format!("Unable to inspect source entry: {error}"))?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        if source_path.file_name().and_then(|name| name.to_str()) == Some(LOCATION_FILE) {
            continue;
        }
        let file_type = entry.file_type().map_err(|error| format!("Unable to inspect source entry: {error}"))?;
        if file_type.is_symlink() {
            // The old folder is deleted after the move, so a link has to be recreated, not dropped.
            #[cfg(unix)]
            {
                let target = fs::read_link(&source_path).map_err(|error| format!("Unable to read a link in the Mochi data folder: {error}"))?;
                std::os::unix::fs::symlink(target, &destination_path).map_err(|error| format!("Unable to copy a link in the Mochi data folder: {error}"))?;
            }
        } else if file_type.is_dir() {
            copy_directory_contents(&source_path, &destination_path)?;
        } else if file_type.is_file() {
            fs::copy(&source_path, &destination_path)
                .map_err(|error| format!("Unable to copy '{}': {error}", entry.file_name().to_string_lossy()))?;
        }
    }
    Ok(())
}

/// Validates the folder the user picked and returns the exact `.../Mochi` folder to move into.
fn resolve_move_destination(selected: &str) -> Result<PathBuf, String> {
    let selected = selected.trim();
    if selected.is_empty() {
        return Err("A destination folder is required.".into());
    }
    // The location marker is a plain text file: control characters would corrupt it.
    if selected.chars().any(char::is_control) {
        return Err("The destination folder name contains characters Mochi cannot store.".into());
    }
    let selected = PathBuf::from(selected);
    if !selected.is_absolute() || selected.components().any(|part| matches!(part, Component::ParentDir)) {
        return Err("Choose an absolute folder path without '..'.".into());
    }
    Ok(if selected.file_name().and_then(|name| name.to_str()) == Some("Mochi") { selected } else { selected.join("Mochi") })
}

/// An existing destination is only acceptable when it is empty or already a Mochi data folder; anything else
/// (say ~/Documents/Mochi full of unrelated files) would later be wiped by "Clear app data".
fn destination_is_usable(destination: &Path) -> Result<(), String> {
    match fs::read_dir(destination) {
        Ok(mut entries) => {
            if entries.next().is_none() || destination.join(CONFIG_FILE).is_file() { Ok(()) }
            else { Err("That Mochi folder already exists and is not empty. Choose an empty folder.".into()) }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err("The selected Mochi data location is not a directory.".into()),
    }
}

pub fn move_config_location(app: AppHandle, destination: String) -> Result<String, String> {
    let destination = resolve_move_destination(&destination)?;
    let _guard = config_guard();
    let current = config_dir(&app)?;
    let default_root = default_config_dir(&app)?;

    if current == destination {
        return Ok(destination.to_string_lossy().into_owned());
    }
    if destination == default_root {
        return Err("Choose a different folder from the current Mochi data location.".into());
    }
    if current.starts_with(&destination) || destination.starts_with(&current) {
        return Err("The new Mochi data folder cannot be inside the existing Mochi data folder.".into());
    }
    if destination.to_str().is_none() {
        return Err("The destination folder name is not valid text.".into());
    }
    destination_is_usable(&destination)?;

    let created_destination = !destination.exists();
    let attempt = (|| {
        fs::create_dir_all(&destination)
            .map_err(|error| format!("Unable to create the new Mochi data folder: {error}"))?;
        // Symlinks and mounts can hide a nesting the lexical checks above cannot see.
        if let (Ok(old), Ok(new)) = (fs::canonicalize(&current), fs::canonicalize(&destination)) {
            if old.starts_with(&new) || new.starts_with(&old) {
                return Err("The new Mochi data folder cannot be inside the existing Mochi data folder.".to_string());
            }
        }
        copy_directory_contents(&current, &destination)?;
        fs::create_dir_all(&default_root)
            .map_err(|error| format!("Unable to prepare the Mochi location marker: {error}"))?;
        write_atomic_durable(&default_root.join(LOCATION_FILE), format!("{}\n", destination.display()).as_bytes())
            .map_err(|error| format!("Unable to save the Mochi data location: {error}"))
    })();
    if let Err(error) = attempt {
        // Nothing was switched yet, so drop what this attempt copied and keep using the old folder.
        if created_destination { let _ = fs::remove_dir_all(&destination); }
        return Err(error);
    }

    // From here the move has succeeded; cleaning up the old copy is best effort and must not report a failure.
    if current != default_root {
        if let Err(error) = fs::remove_dir_all(&current) { eprintln!("Mochi: could not remove the old data folder: {error}"); }
    } else if let Ok(entries) = fs::read_dir(&current) {
        for entry in entries.flatten() {
            if entry.file_name().to_str() == Some(LOCATION_FILE) { continue; }
            let path = entry.path();
            let removed = if entry.file_type().is_ok_and(|kind| kind.is_dir()) { fs::remove_dir_all(&path) } else { fs::remove_file(&path) };
            if let Err(error) = removed { eprintln!("Mochi: could not remove old data: {error}"); }
        }
    }

    Ok(destination.to_string_lossy().into_owned())
}

pub fn clear_app_data(app: AppHandle) -> Result<(), String> {
    let root = config_dir(&app)?;
    let default_root = default_config_dir(&app)?;
    if root.exists() {
        fs::remove_dir_all(&root)
            .map_err(|error| format!("Unable to clear Mochi app data: {error}"))?;
    }
    if default_root.exists() && default_root != root {
        fs::remove_dir_all(&default_root)
            .map_err(|error| format!("Unable to clear Mochi location marker: {error}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    static TEMP_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mochi-themes-{name}-{}-{}", std::process::id(), TEMP_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed)));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn manifest(id: &str) -> ThemeManifest {
        parse_manifest(format!(r#"{{"schemaVersion":1,"id":"{id}","name":"T","version":"1"}}"#).as_bytes(), "t.json").unwrap()
    }

    #[test]
    fn move_destination_is_validated() {
        assert_eq!(resolve_move_destination("/data").unwrap(), PathBuf::from("/data/Mochi"));
        assert_eq!(resolve_move_destination(" /data/Mochi ").unwrap(), PathBuf::from("/data/Mochi"));
        for bad in ["", "  ", "relative/dir", "/data/../etc", "/data/a\nb", "/data/\0x"] {
            assert!(resolve_move_destination(bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn existing_unrelated_folders_are_not_adopted() {
        let dir = temp_dir("usable");
        assert!(destination_is_usable(&dir.join("missing")).is_ok());
        assert!(destination_is_usable(&dir).is_ok(), "empty folder");
        fs::write(dir.join("holiday.jpg"), b"x").unwrap();
        assert!(destination_is_usable(&dir).is_err());
        fs::write(dir.join(CONFIG_FILE), b"{}").unwrap();
        assert!(destination_is_usable(&dir).is_ok(), "an existing Mochi data folder");
        assert!(destination_is_usable(&dir.join("holiday.jpg")).is_err(), "a file");
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn moving_data_keeps_symlinks_and_skips_the_marker() {
        let dir = temp_dir("move");
        let (from, to) = (dir.join("from"), dir.join("to"));
        fs::create_dir_all(from.join("fonts")).unwrap();
        fs::write(from.join("config.json"), b"{}").unwrap();
        fs::write(from.join(LOCATION_FILE), b"x").unwrap();
        std::os::unix::fs::symlink("/somewhere/else", from.join("fonts/link")).unwrap();
        copy_directory_contents(&from, &to).unwrap();
        assert!(to.join("config.json").is_file() && !to.join(LOCATION_FILE).exists());
        assert_eq!(fs::read_link(to.join("fonts/link")).unwrap(), PathBuf::from("/somewhere/else"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn manifests_are_bounded_and_validated() {
        let dir = temp_dir("manifest");
        let big = dir.join("theme.json");
        fs::write(&big, vec![b' '; (MAX_MANIFEST_BYTES + 10) as usize]).unwrap();
        assert!(read_manifest(&big).is_err());
        assert!(parse_manifest(br#"{"schemaVersion":1,"id":"../x","name":"T","version":"1"}"#, "t").is_err());
        assert!(parse_manifest(br#"{"schemaVersion":2,"id":"x","name":"T","version":"1"}"#, "t").is_err());
        let deep = format!("{}1{}", "[".repeat(5000), "]".repeat(5000));
        assert!(parse_manifest(deep.as_bytes(), "t").is_err(), "deeply nested JSON is an error, not a stack overflow");
        // Error text shows the file name, not the whole local path.
        let error = read_manifest(&dir.join("missing.json")).unwrap_err();
        assert!(error.contains("missing.json") && !error.contains(dir.to_str().unwrap()), "{error}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn asset_paths_cannot_escape() {
        for bad in ["../x.png", "/etc/passwd", "a/../../x.png"] { assert!(safe_relative_path(bad).is_err(), "{bad}"); }
        assert!(safe_relative_path("img/a.png").is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn assets_reject_symlinks_and_oversize_sets() {
        let dir = temp_dir("assets");
        let (theme, secret) = (dir.join("theme"), dir.join("secret.png"));
        fs::create_dir_all(&theme).unwrap();
        fs::write(&secret, b"top secret").unwrap();
        fs::write(theme.join("ok.png"), b"png").unwrap();
        std::os::unix::fs::symlink(&secret, theme.join("link.png")).unwrap();
        let mut m = manifest("x");
        m.assets.insert("bg".into(), "ok.png".into());
        assert_eq!(load_assets(&theme, &m).unwrap().len(), 1);
        m.assets.insert("evil".into(), "link.png".into());
        assert!(load_assets(&theme, &m).unwrap_err().contains("outside"));
        let mut many = manifest("y");
        for i in 0..=MAX_THEME_ASSETS { many.assets.insert(format!("a{i}"), "ok.png".into()); }
        assert!(load_assets(&theme, &many).unwrap_err().contains("at most"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn import_copy_is_bounded_and_skips_symlinks() {
        let dir = temp_dir("copy");
        let src = dir.join("src");
        fs::create_dir_all(src.join("a")).unwrap();
        fs::write(src.join("theme.json"), b"{}").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink("/etc/passwd", src.join("a/pw")).unwrap();
        let mut budget = CopyBudget { entries: 0, bytes: 0 };
        copy_directory_recursive(&src, &dir.join("dst"), 0, &mut budget).unwrap();
        assert!(dir.join("dst/theme.json").is_file() && !dir.join("dst/a/pw").exists());
        let mut deep = src.clone();
        for _ in 0..=THEME_IMPORT_MAX_DEPTH + 1 { deep = deep.join("d"); }
        fs::create_dir_all(&deep).unwrap();
        let mut budget = CopyBudget { entries: 0, bytes: 0 };
        assert!(copy_directory_recursive(&src, &dir.join("dst2"), 0, &mut budget).is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn corrupt_or_non_utf8_config_is_replaced_instead_of_blocking_startup() {
        let dir = temp_dir("config");
        let (path, value) = ensure_config_in(&dir).unwrap();
        assert_eq!(value["theme"], "mochi");
        for bad in [&b"{ not json"[..], b"[1,2]", b"\xff\xfe\x00garbage", b""] {
            fs::write(&path, bad).unwrap();
            let (_, value) = ensure_config_in(&dir).unwrap();
            assert_eq!(value["theme"], "mochi", "{bad:?}");
            assert!(dir.join("config.json.corrupt").exists());
        }
        fs::write(&path, br#"{"schemaVersion":1,"theme":"dark","settings":{}}"#).unwrap();
        assert_eq!(ensure_config_in(&dir).unwrap().1["theme"], "dark");
        let _ = fs::remove_dir_all(&dir);
    }
}
