use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    fs,
    path::{Component, Path, PathBuf},
};
use tauri::{AppHandle, Manager};

const CONFIG_FILE: &str = "config.json";
const MAX_THEME_ASSET_BYTES: usize = 10 * 1024 * 1024;
const THEMES_DIR: &str = "themes";

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

fn config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map_err(|error| format!("Unable to resolve Mochi config directory: {error}"))
}

fn themes_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let root = config_dir(app)?;
    let themes = root.join(THEMES_DIR);
    fs::create_dir_all(&themes)
        .map_err(|error| format!("Unable to create Mochi themes directory: {error}"))?;
    Ok(themes)
}

fn ensure_config(app: &AppHandle) -> Result<(PathBuf, Value), String> {
    let root = config_dir(app)?;
    fs::create_dir_all(&root)
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

    let raw = fs::read_to_string(&path)
        .map_err(|error| format!("Unable to read Mochi config: {error}"))?;
    let value = serde_json::from_str::<Value>(&raw)
        .map_err(|error| format!("Mochi config is invalid JSON: {error}"))?;
    Ok((path, value))
}

fn write_json_atomic(path: &Path, value: &Value) -> Result<(), String> {
    let temp = path.with_extension("json.tmp");
    let content = serde_json::to_string_pretty(value)
        .map_err(|error| format!("Unable to serialize Mochi config: {error}"))?;
    fs::write(&temp, format!("{content}\n"))
        .map_err(|error| format!("Unable to write Mochi config: {error}"))?;
    fs::rename(&temp, path)
        .map_err(|error| format!("Unable to replace Mochi config: {error}"))
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 80
        && id.chars().all(|character| character.is_ascii_alphanumeric() || character == '-' || character == '_')
}

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

    for (logical_name, relative_path) in &declared_assets {
        let relative = safe_relative_path(relative_path)?;
        let path = root.join(&relative);
        if !path.is_file() {
            return Err(format!("Theme asset '{relative_path}' was not found."));
        }
        let metadata = fs::metadata(&path)
            .map_err(|error| format!("Unable to inspect theme asset '{relative_path}': {error}"))?;
        if metadata.len() > MAX_THEME_ASSET_BYTES as u64 {
            return Err(format!("Theme asset '{relative_path}' exceeds the 10 MiB limit."));
        }
        let bytes = fs::read(&path)
            .map_err(|error| format!("Unable to read theme asset '{relative_path}': {error}"))?;
        let encoded = STANDARD.encode(bytes);
        result.insert(
            logical_name.clone(),
            format!("data:{};base64,{encoded}", mime_type(&path)),
        );
    }
    Ok(result)
}

fn read_manifest(path: &Path) -> Result<ThemeManifest, String> {
    let raw = fs::read_to_string(path)
        .map_err(|error| format!("Unable to read theme manifest '{}': {error}", path.display()))?;
    let manifest = serde_json::from_str::<ThemeManifest>(&raw)
        .map_err(|error| format!("Theme manifest '{}' is invalid JSON: {error}", path.display()))?;
    validate_manifest(&manifest)?;
    Ok(manifest)
}

fn copy_directory_recursive(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir_all(destination)
        .map_err(|error| format!("Unable to create theme directory: {error}"))?;

    for entry in fs::read_dir(source)
        .map_err(|error| format!("Unable to read theme directory: {error}"))?
    {
        let entry = entry.map_err(|error| format!("Unable to inspect theme entry: {error}"))?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        if source_path.is_dir() {
            copy_directory_recursive(&source_path, &destination_path)?;
        } else if source_path.is_file() {
            fs::copy(&source_path, &destination_path)
                .map_err(|error| format!("Unable to copy theme file: {error}"))?;
        }
    }
    Ok(())
}

#[tauri::command]
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

#[tauri::command]
pub fn set_mochi_theme(app: AppHandle, theme_id: String) -> Result<(), String> {
    if !valid_id(&theme_id) {
        return Err("Invalid theme ID.".into());
    }
    let (path, mut value) = ensure_config(&app)?;
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

#[tauri::command]
pub fn list_user_themes(app: AppHandle) -> Result<Vec<UserThemeDescriptor>, String> {
    let root = themes_dir(&app)?;
    let mut themes = Vec::new();

    for entry in fs::read_dir(root).map_err(|error| format!("Unable to scan themes: {error}"))? {
        let entry = entry.map_err(|error| format!("Unable to inspect theme: {error}"))?;
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

        match read_manifest(&manifest_path) {
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

    themes.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
    Ok(themes)
}

#[tauri::command]
pub fn load_user_theme(app: AppHandle, theme_id: String) -> Result<LoadedUserTheme, String> {
    if !valid_id(&theme_id) {
        return Err("Invalid theme ID.".into());
    }

    let root = themes_dir(&app)?;
    let folder = root.join(&theme_id);
    let file = root.join(format!("{theme_id}.json"));
    let (theme_root, manifest_path) = if folder.join("theme.json").is_file() {
        (folder, folder.join("theme.json"))
    } else if file.is_file() {
        (root.clone(), file)
    } else {
        return Err(format!("User theme '{theme_id}' was not found."));
    };

    let manifest = read_manifest(&manifest_path)?;
    if manifest.id != theme_id {
        return Err("Theme ID does not match its requested identifier.".into());
    }

    let css_path = if theme_root.is_dir() {
        theme_root.join("theme.css")
    } else {
        PathBuf::new()
    };
    let css = if css_path.is_file() {
        fs::read_to_string(&css_path)
            .map_err(|error| format!("Unable to read theme CSS: {error}"))?
    } else {
        String::new()
    };

    let assets = if theme_root.is_dir() {
        load_assets(&theme_root, &manifest)?
    } else {
        BTreeMap::new()
    };

    Ok(LoadedUserTheme { manifest, css, assets })
}

#[tauri::command]
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
        copy_directory_recursive(&source, &destination)?;
    } else {
        fs::copy(&source, &destination)
            .map_err(|error| format!("Unable to import theme: {error}"))?;
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
