//! "Create desktop shortcut" and "Add to Steam" for a Piko. Every shortcut opens `mochi://launch/<id>`
//! (the scheme Mochi registers at start-up), so it keeps working when the AppImage is moved or
//! updated, and for packaged installs, where a hard-coded binary path would go stale.
//!
//! Linux: a `.desktop` entry (application menu and/or Desktop) running `xdg-open <url>`.
//! macOS: a tiny `.app` in `~/Applications` whose script runs `open <url>`.
//! Steam: an entry appended to `userdata/<id>/config/shortcuts.vdf` (see `docs/shortcuts.md`).

use crate::sources::vdf::{self, Value};
use image::{imageops::FilterType, DynamicImage, ImageFormat, RgbaImage};
use serde::Serialize;
use std::{
    collections::HashMap,
    fs,
    io::Cursor,
    path::{Path, PathBuf},
    process::Command,
    time::Duration,
};
use tauri::AppHandle;

const MOCHI_ICON: &[u8] = include_bytes!("../icons/icon.png");
/// SteamID64 of account number 0; `id64 - BASE` is the folder name under `userdata/`.
const STEAM_ID64_BASE: u64 = 76_561_197_960_265_728;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

fn percent_encode(value: &str) -> String {
    value.bytes().fold(String::new(), |mut out, b| {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') { out.push(b as char) } else { out.push_str(&format!("%{b:02X}")) }
        out
    })
}

pub fn launch_url(id: &str) -> String { format!("mochi://launch/{}", percent_encode(id)) }

fn safe_stem(value: &str) -> String {
    value.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '-' }).take(80).collect()
}

fn clean_name(name: &str) -> String {
    let name: String = name.chars().filter(|c| !c.is_control()).collect::<String>().trim().chars().take(120).collect();
    if name.is_empty() { "Game".into() } else { name }
}

fn valid_game_id(id: &str) -> bool { !id.trim().is_empty() && id.len() <= 200 && !id.chars().any(char::is_control) }

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

/// Fits `image` inside a transparent `size` x `size` square (covers are portrait; icons are square).
pub fn square_icon(image: &DynamicImage, size: u32) -> RgbaImage {
    let fitted = image.resize(size, size, FilterType::Lanczos3).to_rgba8();
    let mut canvas = RgbaImage::new(size, size);
    image::imageops::overlay(&mut canvas, &fitted, i64::from((size - fitted.width()) / 2), i64::from((size - fitted.height()) / 2));
    canvas
}

pub fn encode_png(image: &RgbaImage) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    image.write_to(&mut Cursor::new(&mut bytes), ImageFormat::Png).map_err(|error| format!("Unable to encode the icon: {error}"))?;
    Ok(bytes)
}

/// An Apple icon container holding PNG images (`ic07` 128, `ic08` 256, `ic09` 512 pixels).
pub fn build_icns(image: &DynamicImage) -> Result<Vec<u8>, String> {
    let mut body = Vec::new();
    for (tag, size) in [(b"ic07", 128u32), (b"ic08", 256), (b"ic09", 512)] {
        let png = encode_png(&square_icon(image, size))?;
        body.extend(tag);
        body.extend((png.len() as u32 + 8).to_be_bytes());
        body.extend(png);
    }
    let mut out = b"icns".to_vec();
    out.extend((body.len() as u32 + 8).to_be_bytes());
    out.extend(body);
    Ok(out)
}

/// The Piko's cached cover, or the Mochi icon when it has none.
fn icon_source(app: &AppHandle, cache_key: Option<&str>) -> DynamicImage {
    let cover = cache_key.filter(|key| !key.is_empty()).and_then(|key| crate::game_artwork::cache_path(app, key).ok()).and_then(|base| crate::game_artwork::find_cached(&base)).and_then(|path| fs::read(path).ok()).and_then(|bytes| crate::game_artwork::decode_image(&bytes).ok());
    cover.unwrap_or_else(|| image::load_from_memory(MOCHI_ICON).unwrap_or_else(|_| DynamicImage::new_rgba8(1, 1)))
}

/// Writes `<config>/shortcut-icons/<id>.png` (256 px) and returns its path.
fn save_icon(config: &Path, id: &str, image: &DynamicImage) -> Result<PathBuf, String> {
    let dir = config.join("shortcut-icons");
    fs::create_dir_all(&dir).map_err(|error| format!("Unable to create the icon folder: {error}"))?;
    let path = dir.join(format!("{}.png", safe_stem(id)));
    crate::util::fsio::write_atomic(&path, &encode_png(&square_icon(image, 256))?).map_err(|error| format!("Unable to save the icon: {error}"))?;
    Ok(path)
}

// ---------------------------------------------------------------------------
// Linux desktop entries
// ---------------------------------------------------------------------------

/// Desktop Entry "string" escaping: backslash, newline, tab and carriage return.
fn escape_value(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for c in value.chars() {
        match c { '\\' => out.push_str("\\\\"), '\n' => out.push_str("\\n"), '\t' => out.push_str("\\t"), '\r' => out.push_str("\\r"), c if c.is_control() => {} c => out.push(c) }
    }
    out
}

/// A `.desktop` file that opens the Piko's `mochi://launch/` link with `xdg-open`.
pub fn desktop_entry(name: &str, url: &str, icon: Option<&Path>) -> String {
    let name = escape_value(&clean_name(name));
    // In Exec a literal percent sign is written `%%`; the url only contains percent-encoded bytes.
    let exec_url = url.replace('%', "%%");
    let icon_line = icon.map(|path| format!("Icon={}\n", escape_value(&path.to_string_lossy()))).unwrap_or_default();
    format!("[Desktop Entry]\nType=Application\nName={name}\nComment=Launch {name} with Mochi\nExec=xdg-open {exec_url}\n{icon_line}Terminal=false\nStartupNotify=false\nCategories=Game;\n")
}

fn desktop_file_name(id: &str) -> String { format!("mochi-{}.desktop", safe_stem(id)) }

/// Writes the entry into `dir`; `executable` marks it launchable (needed on the Desktop folder).
pub fn write_desktop_entry(dir: &Path, id: &str, content: &str, executable: bool) -> Result<PathBuf, String> {
    fs::create_dir_all(dir).map_err(|error| format!("Unable to create {}: {error}", dir.display()))?;
    let path = dir.join(desktop_file_name(id));
    crate::util::fsio::write_atomic(&path, content.as_bytes()).map_err(|error| format!("Unable to write the shortcut: {error}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(if executable { 0o755 } else { 0o644 }));
    }
    Ok(path)
}

/// The Desktop folder from `xdg-user-dir DESKTOP` output; the home folder itself means "unset".
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub fn parse_xdg_user_dir(output: &str, home: &Path) -> Option<PathBuf> {
    let path = PathBuf::from(output.trim());
    (path.is_absolute() && path != home && path.is_dir()).then_some(path)
}

fn desktop_dir(home: &Path) -> Option<PathBuf> {
    #[cfg(target_os = "linux")]
    if crate::platform::command_exists("xdg-user-dir") {
        let mut command = Command::new("xdg-user-dir");
        command.arg("DESKTOP");
        if let Some(path) = crate::platform::run_capture(command, Duration::from_secs(2)).and_then(|out| parse_xdg_user_dir(&String::from_utf8_lossy(&out), home)) { return Some(path); }
    }
    Some(home.join("Desktop")).filter(|path| path.is_dir())
}

fn data_home(home: &Path) -> PathBuf {
    std::env::var_os("XDG_DATA_HOME").map(PathBuf::from).filter(|path| path.is_absolute()).unwrap_or_else(|| home.join(".local/share"))
}

// ---------------------------------------------------------------------------
// macOS app bundle
// ---------------------------------------------------------------------------

pub struct BundleFile {
    pub path: PathBuf,
    pub bytes: Vec<u8>,
    pub executable: bool,
}

pub fn bundle_identifier(id: &str) -> String { format!("app.mochi.shortcut.{}", safe_stem(id).replace('_', "-")) }

fn xml_escape(value: &str) -> String {
    value.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// The files of a shortcut `.app`, relative to the bundle folder: Info.plist, the launcher script
/// and (when given) the icon. No I/O, so the layout can be tested anywhere.
pub fn mac_bundle_files(id: &str, name: &str, url: &str, icns: Option<Vec<u8>>) -> Vec<BundleFile> {
    let name = xml_escape(&clean_name(name));
    let icon_key = if icns.is_some() { "\t<key>CFBundleIconFile</key>\n\t<string>icon</string>\n" } else { "" };
    let plist = format!("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n<plist version=\"1.0\">\n<dict>\n\t<key>CFBundleName</key>\n\t<string>{name}</string>\n\t<key>CFBundleDisplayName</key>\n\t<string>{name}</string>\n\t<key>CFBundleIdentifier</key>\n\t<string>{}</string>\n\t<key>CFBundleExecutable</key>\n\t<string>launch</string>\n\t<key>CFBundlePackageType</key>\n\t<string>APPL</string>\n\t<key>CFBundleVersion</key>\n\t<string>1</string>\n\t<key>CFBundleShortVersionString</key>\n\t<string>1.0</string>\n{icon_key}\t<key>LSUIElement</key>\n\t<true/>\n</dict>\n</plist>\n", bundle_identifier(id));
    let script = format!("#!/bin/sh\nexec /usr/bin/open \"{url}\"\n");
    let mut files = vec![
        BundleFile { path: PathBuf::from("Contents").join("Info.plist"), bytes: plist.into_bytes(), executable: false },
        BundleFile { path: PathBuf::from("Contents").join("MacOS").join("launch"), bytes: script.into_bytes(), executable: true },
    ];
    if let Some(bytes) = icns { files.push(BundleFile { path: PathBuf::from("Contents").join("Resources").join("icon.icns"), bytes, executable: false }); }
    files
}

/// `<Name>.app`, or `<Name> (<id>).app` when another Piko's shortcut already uses that name.
fn bundle_folder(apps: &Path, id: &str, name: &str) -> PathBuf {
    let base: String = clean_name(name).chars().map(|c| if matches!(c, '/' | ':' | '\\') { '-' } else { c }).collect::<String>().trim_start_matches('.').to_string();
    let base = if base.is_empty() { "Game".into() } else { base };
    let plain = apps.join(format!("{base}.app"));
    let owned = fs::read_to_string(plain.join("Contents").join("Info.plist")).map(|text| text.contains(&format!("<string>{}</string>", bundle_identifier(id)))).unwrap_or(false);
    if !plain.exists() || owned { plain } else { apps.join(format!("{base} ({}).app", safe_stem(id))) }
}

/// Builds the bundle next to its final place and swaps it in, so a half-written `.app` never shows up.
pub fn write_mac_bundle(apps: &Path, id: &str, name: &str, url: &str, icns: Option<Vec<u8>>) -> Result<PathBuf, String> {
    fs::create_dir_all(apps).map_err(|error| format!("Unable to create {}: {error}", apps.display()))?;
    let target = bundle_folder(apps, id, name);
    let stage = apps.join(format!(".mochi-shortcut-{}.tmp", safe_stem(id)));
    let _ = fs::remove_dir_all(&stage);
    let result = (|| -> Result<(), String> {
        for file in mac_bundle_files(id, name, url, icns) {
            let path = stage.join(&file.path);
            fs::create_dir_all(path.parent().ok_or("Invalid bundle path.")?).map_err(|error| error.to_string())?;
            fs::write(&path, &file.bytes).map_err(|error| error.to_string())?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&path, fs::Permissions::from_mode(if file.executable { 0o755 } else { 0o644 })).map_err(|error| error.to_string())?;
            }
        }
        if target.exists() { fs::remove_dir_all(&target).map_err(|error| error.to_string())?; }
        fs::rename(&stage, &target).map_err(|error| error.to_string())
    })();
    if let Err(error) = result { let _ = fs::remove_dir_all(&stage); return Err(format!("Unable to create the app shortcut: {error}")); }
    Ok(target)
}

// ---------------------------------------------------------------------------
// Steam non-Steam shortcuts
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SteamUser {
    pub id: String,
    pub name: String,
    pub path: String,
}

/// Steam install folders: native and Flatpak on Linux, Application Support on macOS.
pub fn steam_roots(home: &Path, macos: bool) -> Vec<PathBuf> {
    if macos { return vec![home.join("Library/Application Support/Steam")]; }
    vec![home.join(".local/share/Steam"), home.join(".steam/steam"), home.join(".var/app/com.valvesoftware.Steam/.local/share/Steam")]
}

/// Account number -> persona name from `config/loginusers.vdf` (keyed there by SteamID64).
pub fn persona_names(text: &str) -> HashMap<String, String> {
    let mut names = HashMap::new();
    let mut current: Option<String> = None;
    for line in text.lines() {
        let trimmed = line.trim();
        let key = trimmed.trim_matches('"');
        if trimmed.starts_with('"') && trimmed.ends_with('"') && key.len() >= 16 && key.bytes().all(|b| b.is_ascii_digit()) {
            current = key.parse::<u64>().ok().and_then(|id| id.checked_sub(STEAM_ID64_BASE)).map(|id| id.to_string());
        } else if let (Some(id), Some(name)) = (&current, vdf::quoted_value(trimmed, "PersonaName")) {
            names.insert(id.clone(), name);
        }
    }
    names
}

pub fn find_steam_users(home: &Path, macos: bool) -> Vec<SteamUser> {
    let mut seen: Vec<PathBuf> = Vec::new();
    let mut users = Vec::new();
    for root in steam_roots(home, macos) {
        let Ok(entries) = fs::read_dir(root.join("userdata")) else { continue };
        let personas = fs::read_to_string(root.join("config").join("loginusers.vdf")).map(|text| persona_names(&text)).unwrap_or_default();
        let mut found: Vec<(String, PathBuf)> = entries.flatten().filter_map(|entry| {
            let id = entry.file_name().to_str()?.to_string();
            (id != "0" && !id.is_empty() && id.bytes().all(|b| b.is_ascii_digit()) && entry.path().is_dir()).then(|| (id, entry.path()))
        }).collect();
        found.sort();
        for (id, path) in found {
            let canonical = fs::canonicalize(&path).unwrap_or_else(|_| path.clone());
            if seen.contains(&canonical) { continue; }
            seen.push(canonical);
            let name = personas.get(&id).cloned().unwrap_or_else(|| format!("Steam user {id}"));
            users.push(SteamUser { id, name, path: path.to_string_lossy().into_owned() });
        }
    }
    users
}

/// Whether any of these programs (argv[0]) is the Steam client; Steam rewrites `shortcuts.vdf` on exit.
pub fn steam_in_processes<'a>(programs: impl IntoIterator<Item = &'a str>) -> bool {
    programs.into_iter().any(|program| {
        let base = program.rsplit('/').next().unwrap_or(program).to_ascii_lowercase();
        base == "steam" || base == "steam_osx"
    })
}

fn steam_running() -> bool {
    let processes = crate::process::snapshot();
    steam_in_processes(processes.values().map(|process| process.argv0.as_str()))
}

pub struct SteamEntry {
    pub name: String,
    pub exe: String,
    pub start_dir: String,
    pub icon: String,
    pub launch_options: String,
}

fn string(key: &str, value: &str) -> (String, Value) { (key.into(), Value::Str(value.into())) }
fn int(key: &str, value: i32) -> (String, Value) { (key.into(), Value::Int(value)) }

fn entry_value(entry: &SteamEntry) -> Value {
    Value::Map(vec![
        int("appid", vdf::shortcut_app_id(&entry.exe, &entry.name) as i32),
        string("AppName", &entry.name), string("Exe", &entry.exe), string("StartDir", &entry.start_dir), string("icon", &entry.icon),
        string("ShortcutPath", ""), string("LaunchOptions", &entry.launch_options),
        int("IsHidden", 0), int("AllowDesktopConfig", 1), int("AllowOverlay", 1), int("OpenVR", 0), int("Devkit", 0),
        string("DevkitGameID", ""), int("DevkitOverrideAppID", 0), int("LastPlayTime", 0),
        ("tags".into(), Value::Map(Vec::new())),
    ])
}

#[derive(Debug, PartialEq)]
pub enum Added {
    /// New file contents.
    Written(Vec<u8>),
    /// An entry for this Piko is already there.
    Exists,
}

/// Appends `entry` to the shortcuts file contents (`None`/empty = no file yet). Refuses data it cannot
/// round-trip exactly rather than risk dropping the user's other shortcuts.
pub fn add_shortcut(existing: Option<&[u8]>, entry: &SteamEntry) -> Result<Added, String> {
    let mut tree = match existing.filter(|bytes| !bytes.is_empty()) {
        Some(bytes) => vdf::parse_tree(bytes).ok_or("shortcuts.vdf is in a format Mochi does not recognise, so it was left untouched.")?,
        None => Vec::new(),
    };
    let index = match tree.iter().position(|(key, _)| key.eq_ignore_ascii_case("shortcuts")) {
        Some(index) => index,
        None => { tree.push(("shortcuts".into(), Value::Map(Vec::new()))); tree.len() - 1 }
    };
    let Value::Map(shortcuts) = &mut tree[index].1 else { return Err("shortcuts.vdf has an unexpected layout, so it was left untouched.".into()) };
    let duplicate = shortcuts.iter().any(|(_, shortcut)| {
        let text = |key: &str| shortcut.get(key).and_then(Value::as_str);
        text("LaunchOptions") == Some(entry.launch_options.as_str()) || text("AppName") == Some(entry.name.as_str())
    });
    if duplicate { return Ok(Added::Exists); }
    let next = shortcuts.iter().filter_map(|(key, _)| key.parse::<u32>().ok()).max().map_or(0, |max| max + 1);
    shortcuts.push((next.to_string(), entry_value(entry)));
    Ok(Added::Written(vdf::write_tree(&tree)))
}

#[derive(Debug, PartialEq)]
pub enum SteamOutcome {
    Added { backup: Option<PathBuf> },
    Exists,
}

/// Reads the user's shortcuts file, backs it up, and writes the extended file atomically.
pub fn add_to_steam_user(user_dir: &Path, entry: &SteamEntry, now: u64) -> Result<SteamOutcome, String> {
    let config = user_dir.join("config");
    let file = config.join("shortcuts.vdf");
    let existing = match fs::read(&file) {
        Ok(bytes) => Some(bytes),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(format!("Unable to read shortcuts.vdf: {error}")),
    };
    let bytes = match add_shortcut(existing.as_deref(), entry)? { Added::Exists => return Ok(SteamOutcome::Exists), Added::Written(bytes) => bytes };
    let backup = if existing.is_some() {
        let backup = config.join(format!("shortcuts.vdf.mochi-backup-{now}"));
        fs::copy(&file, &backup).map_err(|error| format!("Unable to back up shortcuts.vdf (nothing was changed): {error}"))?;
        Some(backup)
    } else { None };
    fs::create_dir_all(&config).map_err(|error| format!("Unable to create {}: {error}", config.display()))?;
    crate::util::fsio::write_atomic_durable(&file, &bytes).map_err(|error| format!("Unable to write shortcuts.vdf: {error}"))?;
    Ok(SteamOutcome::Added { backup })
}

fn quoted(path: &str) -> String { format!("\"{path}\"") }

/// The program Steam starts: `open` on macOS, `xdg-open` elsewhere.
fn launcher_program(macos: bool) -> String {
    if macos { return "/usr/bin/open".into(); }
    crate::platform::command_path("xdg-open").map(|path| path.to_string_lossy().into_owned()).unwrap_or_else(|| "/usr/bin/xdg-open".into())
}

pub fn steam_entry(name: &str, url: &str, icon: &Path, macos: bool) -> SteamEntry {
    let program = launcher_program(macos);
    let dir = Path::new(&program).parent().map(|path| format!("{}/", path.to_string_lossy())).unwrap_or_else(|| "/".into());
    SteamEntry { name: clean_name(name), exe: quoted(&program), start_dir: quoted(&dir), icon: icon.to_string_lossy().into_owned(), launch_options: url.into() }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutLocation {
    /// "menu" | "desktop" | "applications"
    pub id: String,
    pub label: String,
    pub path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutTargets {
    pub locations: Vec<ShortcutLocation>,
    pub steam_users: Vec<SteamUser>,
    pub steam_running: bool,
}

fn location(id: &str, label: &str, path: PathBuf) -> ShortcutLocation { ShortcutLocation { id: id.into(), label: label.into(), path: path.to_string_lossy().into_owned() } }

fn targets(home: &Path, macos: bool) -> ShortcutTargets {
    let locations = if macos { vec![location("applications", "Applications folder", home.join("Applications"))] } else {
        let mut list = vec![location("menu", "Application menu", data_home(home).join("applications"))];
        if let Some(desktop) = desktop_dir(home) { list.push(location("desktop", "Desktop", desktop)); }
        list
    };
    ShortcutTargets { locations, steam_users: find_steam_users(home, macos), steam_running: steam_running() }
}

fn home() -> Result<PathBuf, String> { crate::platform::home_dir().ok_or_else(|| "Unable to find your home folder.".to_string()) }

#[tauri::command]
pub async fn get_shortcut_targets() -> Result<ShortcutTargets, String> {
    let home = home()?;
    crate::util::blocking(move || targets(&home, cfg!(target_os = "macos"))).await
}

#[tauri::command]
pub async fn create_piko_shortcut(app: AppHandle, game_id: String, name: String, artwork_cache_key: Option<String>, location: String) -> Result<String, String> {
    if !valid_game_id(&game_id) { return Err("Invalid game id.".into()); }
    let home = home()?;
    let config = crate::themes::config_dir(&app)?;
    let image = icon_source(&app, artwork_cache_key.as_deref());
    crate::util::blocking(move || {
        let url = launch_url(&game_id);
        let icon = save_icon(&config, &game_id, &image)?;
        if cfg!(target_os = "macos") {
            if location != "applications" { return Err("Unknown shortcut location.".to_string()); }
            let bundle = write_mac_bundle(&home.join("Applications"), &game_id, &name, &url, build_icns(&image).ok())?;
            return Ok(bundle.to_string_lossy().into_owned());
        }
        let content = desktop_entry(&name, &url, Some(&icon));
        match location.as_str() {
            "menu" => write_desktop_entry(&data_home(&home).join("applications"), &game_id, &content, false).map(|path| path.to_string_lossy().into_owned()),
            "desktop" => {
                let dir = desktop_dir(&home).ok_or("No Desktop folder was found.")?;
                let path = write_desktop_entry(&dir, &game_id, &content, true)?;
                // GNOME refuses to run a Desktop launcher until it is trusted; best effort.
                if crate::platform::command_exists("gio") {
                    let mut command = Command::new("gio");
                    command.args(["set"]).arg(&path).args(["metadata::trusted", "true"]);
                    let _ = crate::platform::run_capture(command, Duration::from_secs(3));
                }
                Ok(path.to_string_lossy().into_owned())
            }
            _ => Err("Unknown shortcut location.".to_string()),
        }
    }).await?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddToSteamResult {
    /// "added" | "exists" | "steam-running"
    pub status: String,
    pub backup: Option<String>,
}

#[tauri::command]
pub async fn add_piko_to_steam(app: AppHandle, game_id: String, name: String, artwork_cache_key: Option<String>, user_id: String, allow_running: bool) -> Result<AddToSteamResult, String> {
    if !valid_game_id(&game_id) { return Err("Invalid game id.".into()); }
    let home = home()?;
    let config = crate::themes::config_dir(&app)?;
    let image = icon_source(&app, artwork_cache_key.as_deref());
    crate::util::blocking(move || {
        let macos = cfg!(target_os = "macos");
        // Only a folder Mochi itself listed is accepted, never a path from the caller.
        let user = find_steam_users(&home, macos).into_iter().find(|user| user.id == user_id).ok_or("That Steam account was not found.")?;
        if !allow_running && steam_running() { return Ok(AddToSteamResult { status: "steam-running".into(), backup: None }); }
        let icon = save_icon(&config, &game_id, &image)?;
        let entry = steam_entry(&name, &launch_url(&game_id), &icon, macos);
        Ok(match add_to_steam_user(Path::new(&user.path), &entry, crate::util::now_secs())? {
            SteamOutcome::Exists => AddToSteamResult { status: "exists".into(), backup: None },
            SteamOutcome::Added { backup } => AddToSteamResult { status: "added".into(), backup: backup.map(|path| path.to_string_lossy().into_owned()) },
        })
    }).await?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mochi-shortcuts-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn entry() -> SteamEntry {
        SteamEntry { name: "Test Game".into(), exe: "\"/usr/bin/xdg-open\"".into(), start_dir: "\"/usr/bin/\"".into(), icon: "/icons/a.png".into(), launch_options: "mochi://launch/abc".into() }
    }

    #[test]
    fn launch_urls_are_percent_encoded() {
        assert_eq!(launch_url("abc-1_2"), "mochi://launch/abc-1_2");
        assert_eq!(launch_url("a b/ü"), "mochi://launch/a%20b%2F%C3%BC");
    }

    #[test]
    fn desktop_entry_escapes_names_and_exec_percent() {
        let text = desktop_entry("Back\\slash\nNew", "mochi://launch/a%20b", Some(Path::new("/i/a b.png")));
        assert!(text.contains("Name=Back\\\\slashNew\n"));
        assert_eq!(escape_value("a\\b\nc\td\re"), "a\\\\b\\nc\\td\\re");
        assert!(text.contains("Exec=xdg-open mochi://launch/a%%20b\n"));
        assert!(text.contains("Icon=/i/a b.png\n"));
        assert!(text.starts_with("[Desktop Entry]\nType=Application\n"));
        // A name can never start a new key.
        assert_eq!(text.lines().filter(|line| line.starts_with("Exec=")).count(), 1);
        assert!(desktop_entry("", "mochi://launch/x", None).contains("Name=Game\n"));
        assert!(!desktop_entry("x", "mochi://launch/x", None).contains("Icon="));
    }

    #[test]
    fn desktop_entry_files_get_modes() {
        use std::os::unix::fs::PermissionsExt;
        let dir = temp("desktop");
        let menu = write_desktop_entry(&dir.join("applications"), "a/b", "x", false).unwrap();
        assert_eq!(menu.file_name().unwrap(), "mochi-a-b.desktop");
        assert_eq!(fs::metadata(&menu).unwrap().permissions().mode() & 0o777, 0o644);
        let desk = write_desktop_entry(&dir.join("Desktop"), "a/b", "x", true).unwrap();
        assert_eq!(fs::metadata(&desk).unwrap().permissions().mode() & 0o777, 0o755);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn xdg_user_dir_output_is_validated() {
        let dir = temp("xdg");
        let home = dir.join("home");
        let desktop = dir.join("Escritorio");
        fs::create_dir_all(&desktop).unwrap();
        assert_eq!(parse_xdg_user_dir(&format!("{}\n", desktop.display()), &home), Some(desktop));
        assert_eq!(parse_xdg_user_dir(&home.to_string_lossy(), &home), None);
        assert_eq!(parse_xdg_user_dir("relative", &home), None);
        assert_eq!(parse_xdg_user_dir("/does/not/exist", &home), None);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn mac_bundle_layout_and_plist() {
        let files = mac_bundle_files("my_game", "Cool & <Game>", "mochi://launch/my_game", Some(vec![1, 2, 3]));
        let paths: Vec<String> = files.iter().map(|file| file.path.to_string_lossy().replace('\\', "/")).collect();
        assert_eq!(paths, ["Contents/Info.plist", "Contents/MacOS/launch", "Contents/Resources/icon.icns"]);
        let plist = String::from_utf8(files[0].bytes.clone()).unwrap();
        assert!(plist.contains("<string>app.mochi.shortcut.my-game</string>"));
        assert!(plist.contains("<string>Cool &amp; &lt;Game&gt;</string>"));
        assert!(plist.contains("<key>CFBundleIconFile</key>"));
        assert_eq!(String::from_utf8(files[1].bytes.clone()).unwrap(), "#!/bin/sh\nexec /usr/bin/open \"mochi://launch/my_game\"\n");
        assert!(files[1].executable && !files[0].executable);
        let without = mac_bundle_files("g", "G", "mochi://launch/g", None);
        assert_eq!(without.len(), 2);
        assert!(!String::from_utf8(without[0].bytes.clone()).unwrap().contains("CFBundleIconFile"));
    }

    #[test]
    fn mac_bundle_is_written_with_simulated_home_and_renamed_on_collision() {
        use std::os::unix::fs::PermissionsExt;
        let home = temp("macapps");
        let apps = home.join("Applications");
        let first = write_mac_bundle(&apps, "one", "Same: Name", "mochi://launch/one", None).unwrap();
        assert_eq!(first, apps.join("Same- Name.app"));
        assert_eq!(fs::metadata(first.join("Contents/MacOS/launch")).unwrap().permissions().mode() & 0o111, 0o111);
        // Rewriting the same Piko replaces its bundle; another Piko with the same name gets its own folder.
        assert_eq!(write_mac_bundle(&apps, "one", "Same: Name", "mochi://launch/one", None).unwrap(), first);
        assert_eq!(write_mac_bundle(&apps, "two", "Same: Name", "mochi://launch/two", None).unwrap(), apps.join("Same- Name (two).app"));
        assert_eq!(fs::read_dir(&apps).unwrap().count(), 2, "no staging folder is left behind");
        let _ = fs::remove_dir_all(home);
    }

    #[test]
    fn icons_are_square_and_icns_wraps_pngs() {
        let source = DynamicImage::ImageRgba8(RgbaImage::from_pixel(100, 200, image::Rgba([255, 0, 0, 255])));
        let icon = square_icon(&source, 64);
        assert_eq!((icon.width(), icon.height()), (64, 64));
        assert_eq!(icon.get_pixel(0, 32)[3], 0, "padding is transparent");
        assert_eq!(icon.get_pixel(32, 32)[0], 255);
        let icns = build_icns(&source).unwrap();
        assert_eq!(&icns[..4], b"icns");
        assert_eq!(u32::from_be_bytes(icns[4..8].try_into().unwrap()) as usize, icns.len());
        assert_eq!(&icns[8..12], b"ic07");
        assert!(crate::sources::icons::icns_largest_png(&icns).is_some());
    }

    #[test]
    fn steam_roots_cover_both_platforms() {
        let home = Path::new("/h");
        assert_eq!(steam_roots(home, true), vec![PathBuf::from("/h/Library/Application Support/Steam")]);
        assert!(steam_roots(home, false).contains(&PathBuf::from("/h/.var/app/com.valvesoftware.Steam/.local/share/Steam")));
    }

    #[test]
    fn steam_users_are_listed_with_persona_names_on_a_simulated_mac() {
        let home = temp("steamusers");
        let root = home.join("Library/Application Support/Steam");
        fs::create_dir_all(root.join("userdata/0")).unwrap();
        fs::create_dir_all(root.join("userdata/1234")).unwrap();
        fs::create_dir_all(root.join("userdata/99")).unwrap();
        fs::create_dir_all(root.join("userdata/anonymous")).unwrap();
        fs::create_dir_all(root.join("config")).unwrap();
        let id64 = STEAM_ID64_BASE + 1234;
        fs::write(root.join("config/loginusers.vdf"), format!("\"users\"\n{{\n\t\"{id64}\"\n\t{{\n\t\t\"AccountName\"\t\t\"x\"\n\t\t\"PersonaName\"\t\t\"Ashton\"\n\t}}\n}}\n")).unwrap();
        let users = find_steam_users(&home, true);
        assert_eq!(users.iter().map(|user| (user.id.as_str(), user.name.as_str())).collect::<Vec<_>>(), [("1234", "Ashton"), ("99", "Steam user 99")]);
        assert!(find_steam_users(&home, false).is_empty());
        let _ = fs::remove_dir_all(home);
    }

    #[test]
    fn steam_process_detection() {
        assert!(steam_in_processes(["/home/a/.local/share/Steam/ubuntu12_32/steam", "bash"]));
        assert!(steam_in_processes(["/Applications/Steam.app/Contents/MacOS/steam_osx"]));
        assert!(!steam_in_processes(["/usr/bin/steamcmd-helper", "mochi", "bash"]));
    }

    #[test]
    fn app_id_matches_steam_formula() {
        assert_eq!(vdf::shortcut_app_id("\"/usr/bin/xdg-open\"", "Test Game"), 0xD114_A57D);
    }

    /// Hand-assembled bytes of the exact file Steam would hold with one fresh entry.
    fn expected_new_file() -> Vec<u8> {
        let mut out = vec![0x00];
        out.extend(b"shortcuts\0");
        out.push(0x00);
        out.extend(b"0\0");
        let int = |out: &mut Vec<u8>, key: &str, value: i32| { out.push(2); out.extend(key.as_bytes()); out.push(0); out.extend(value.to_le_bytes()); };
        let string = |out: &mut Vec<u8>, key: &str, value: &str| { out.push(1); out.extend(key.as_bytes()); out.push(0); out.extend(value.as_bytes()); out.push(0); };
        int(&mut out, "appid", 0xD114_A57Du32 as i32);
        string(&mut out, "AppName", "Test Game");
        string(&mut out, "Exe", "\"/usr/bin/xdg-open\"");
        string(&mut out, "StartDir", "\"/usr/bin/\"");
        string(&mut out, "icon", "/icons/a.png");
        string(&mut out, "ShortcutPath", "");
        string(&mut out, "LaunchOptions", "mochi://launch/abc");
        for (key, value) in [("IsHidden", 0), ("AllowDesktopConfig", 1), ("AllowOverlay", 1), ("OpenVR", 0), ("Devkit", 0)] { int(&mut out, key, value); }
        string(&mut out, "DevkitGameID", "");
        int(&mut out, "DevkitOverrideAppID", 0);
        int(&mut out, "LastPlayTime", 0);
        out.push(0x00);
        out.extend(b"tags\0");
        out.extend([0x08, 0x08, 0x08, 0x08]);
        out
    }

    #[test]
    fn new_file_is_byte_exact() {
        assert_eq!(add_shortcut(None, &entry()).unwrap(), Added::Written(expected_new_file()));
        // An empty file behaves like a missing one.
        assert_eq!(add_shortcut(Some(&[]), &entry()).unwrap(), Added::Written(expected_new_file()));
    }

    #[test]
    fn appending_keeps_existing_entries_and_round_trips() {
        let Added::Written(first) = add_shortcut(None, &entry()).unwrap() else { panic!() };
        let mut second = entry();
        second.name = "Other".into();
        second.launch_options = "mochi://launch/def".into();
        let Added::Written(both) = add_shortcut(Some(&first), &second).unwrap() else { panic!() };
        let tree = vdf::parse_tree(&both).unwrap();
        assert_eq!(vdf::write_tree(&tree), both);
        let Value::Map(shortcuts) = &tree[0].1 else { panic!() };
        assert_eq!(shortcuts.iter().map(|(key, _)| key.as_str()).collect::<Vec<_>>(), ["0", "1"]);
        assert_eq!(shortcuts[0].1.get("AppName").and_then(Value::as_str), Some("Test Game"));
        assert_eq!(shortcuts[1].1.get("AppName").and_then(Value::as_str), Some("Other"));
        // The prefix (entry 0) is unchanged byte for byte.
        let parsed = vdf::parse_shortcuts(&both);
        assert_eq!(parsed.len(), 2);
    }

    #[test]
    fn duplicates_and_unknown_formats_are_not_written() {
        let Added::Written(first) = add_shortcut(None, &entry()).unwrap() else { panic!() };
        assert_eq!(add_shortcut(Some(&first), &entry()).unwrap(), Added::Exists);
        let mut renamed = entry();
        renamed.name = "Renamed".into();
        assert_eq!(add_shortcut(Some(&first), &renamed).unwrap(), Added::Exists, "same launch options");
        let mut other = entry();
        other.launch_options = "mochi://launch/zzz".into();
        assert_eq!(add_shortcut(Some(&first), &other).unwrap(), Added::Exists, "same name");
        assert!(add_shortcut(Some(b"garbage"), &entry()).is_err());
    }

    #[test]
    fn writing_backs_up_first_and_leaves_no_temp_files() {
        let user = temp("steamwrite");
        let config = user.join("config");
        fs::create_dir_all(&config).unwrap();
        let Added::Written(original) = add_shortcut(None, &entry()).unwrap() else { panic!() };
        fs::write(config.join("shortcuts.vdf"), &original).unwrap();
        let mut other = entry();
        other.name = "Other".into();
        other.launch_options = "mochi://launch/def".into();
        let outcome = add_to_steam_user(&user, &other, 1234).unwrap();
        let backup = config.join("shortcuts.vdf.mochi-backup-1234");
        assert_eq!(outcome, SteamOutcome::Added { backup: Some(backup.clone()) });
        assert_eq!(fs::read(&backup).unwrap(), original);
        assert_eq!(vdf::parse_shortcuts(&fs::read(config.join("shortcuts.vdf")).unwrap()).len(), 2);
        assert_eq!(add_to_steam_user(&user, &other, 1235).unwrap(), SteamOutcome::Exists);
        assert!(!config.join("shortcuts.vdf.mochi-backup-1235").exists(), "no backup when nothing changes");
        assert_eq!(fs::read_dir(&config).unwrap().count(), 2);
        let _ = fs::remove_dir_all(user);
    }

    #[test]
    fn missing_file_is_created_without_backup_and_bad_file_is_untouched() {
        let user = temp("steamnew");
        assert_eq!(add_to_steam_user(&user, &entry(), 1).unwrap(), SteamOutcome::Added { backup: None });
        assert_eq!(fs::read(user.join("config/shortcuts.vdf")).unwrap(), expected_new_file());
        let bad = temp("steambad");
        fs::create_dir_all(bad.join("config")).unwrap();
        fs::write(bad.join("config/shortcuts.vdf"), b"nope").unwrap();
        assert!(add_to_steam_user(&bad, &entry(), 1).is_err());
        assert_eq!(fs::read(bad.join("config/shortcuts.vdf")).unwrap(), b"nope");
        let _ = fs::remove_dir_all(user);
        let _ = fs::remove_dir_all(bad);
    }

    #[test]
    fn steam_entry_uses_the_platform_launcher() {
        let mac = steam_entry("  Game\n", "mochi://launch/x", Path::new("/i.png"), true);
        assert_eq!((mac.name.as_str(), mac.exe.as_str(), mac.start_dir.as_str()), ("Game", "\"/usr/bin/open\"", "\"/usr/bin/\""));
        assert!(steam_entry("G", "u", Path::new("/i.png"), false).exe.ends_with("xdg-open\""));
    }
}
