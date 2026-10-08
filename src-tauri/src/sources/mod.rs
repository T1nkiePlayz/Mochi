//! Read-only discovery of games installed through other launchers.
//!
//! Shared scanners live here; `linux` and `macos` only say where each launcher
//! keeps its data and which extra sources exist on that platform.

use crate::platform::home_dir;
#[cfg(target_os = "linux")]
use crate::platform::run_capture;
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
};
#[cfg(target_os = "linux")]
use std::time::Duration;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "linux")]
use linux as os;
#[cfg(target_os = "macos")]
use macos as os;

mod vdf;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedImportSource {
    pub id: String,
    pub name: String,
    pub description: String,
    pub detected: bool,
    pub game_count: Option<u32>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedGame {
    pub id: String,
    pub name: String,
    pub source: String,
    pub launch_target: String,
    pub install_path: Option<String>,
}

pub struct SourceDef {
    pub id: &'static str,
    pub name: &'static str,
    pub description: &'static str,
}

#[cfg(target_os = "linux")]
const SCAN_TIMEOUT: Duration = Duration::from_secs(20);

fn make(id: String, name: String, source: &str, target: String, path: Option<String>) -> ImportedGame {
    ImportedGame { id, name, source: source.into(), launch_target: target, install_path: path }
}

fn sort_games(mut games: Vec<ImportedGame>) -> Vec<ImportedGame> {
    games.sort_by_key(|game| game.name.to_lowercase());
    games
}

fn read(path: &Path) -> Option<String> { fs::read_to_string(path).ok() }

fn json(path: &Path) -> Option<Value> { serde_json::from_str(&read(path)?).ok() }

fn string(value: &Value, keys: &[&str]) -> Option<String> {
    let object = value.as_object()?;
    keys.iter().find_map(|key| object.get(*key)).and_then(Value::as_str).map(str::to_owned)
}

fn encode(value: &str) -> String {
    value.bytes().fold(String::new(), |mut out, byte| {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') { out.push(byte as char) } else { out.push_str(&format!("%{byte:02X}")) }
        out
    })
}

/// A real directory (symlinks are not followed, so scans cannot loop or escape).
fn real_dir(entry: &fs::DirEntry) -> bool {
    entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false)
}

// ---------------------------------------------------------------------------
// Steam
// ---------------------------------------------------------------------------

/// Every `steamapps` directory belonging to the given Steam installs.
fn steam_libraries(steam_roots: &[PathBuf]) -> Vec<PathBuf> {
    let mut libraries: Vec<PathBuf> = Vec::new();
    for root in steam_roots {
        let apps = root.join("steamapps");
        if !apps.is_dir() { continue; }
        let mut candidates = vec![apps.clone()];
        if let Some(text) = read(&apps.join("libraryfolders.vdf")) {
            candidates.extend(text.lines().filter_map(|line| vdf::quoted_value(line, "path")).map(|path| PathBuf::from(path).join("steamapps")));
        }
        for candidate in candidates {
            let key = fs::canonicalize(&candidate).unwrap_or_else(|_| candidate.clone());
            if candidate.is_dir() && !libraries.iter().any(|existing| fs::canonicalize(existing).unwrap_or_else(|_| existing.clone()) == key) {
                libraries.push(candidate);
            }
        }
    }
    libraries
}

fn scan_steam_library(apps: &Path, seen: &mut HashSet<String>, out: &mut Vec<ImportedGame>) {
    let Ok(entries) = fs::read_dir(apps) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if !name.starts_with("appmanifest_") || path.extension().and_then(|e| e.to_str()) != Some("acf") { continue; }
        let Some(text) = read(&path) else { continue };
        let find = |key: &str| text.lines().find_map(|line| vdf::quoted_value(line, key));
        let (Some(id), Some(title), Some(dir)) = (find("appid"), find("name"), find("installdir")) else { continue };
        // Steam's own tooling (Proton, runtimes) is installed like a game but is not one.
        if !id.bytes().all(|b| b.is_ascii_digit()) || title.starts_with("Proton ") || title.starts_with("Steam Linux Runtime") || title.starts_with("Steamworks Common") { continue; }
        let install = apps.join("common").join(&dir);
        if !dir.contains("..") && install.is_dir() && seen.insert(id.clone()) {
            out.push(make(format!("steam:{id}"), title, "steam", format!("steam://rungameid/{id}"), Some(install.to_string_lossy().into())));
        }
    }
}

fn scan_steam_shortcuts(steam_roots: &[PathBuf]) -> Vec<ImportedGame> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for root in steam_roots {
        let Ok(users) = fs::read_dir(root.join("userdata")) else { continue };
        for user in users.flatten() {
            let Ok(data) = fs::read(user.path().join("config/shortcuts.vdf")) else { continue };
            for shortcut in vdf::parse_shortcuts(&data) {
                if !seen.insert(shortcut.app_id) { continue; }
                // Steam addresses non-Steam shortcuts by (appid << 32) | 0x02000000.
                let game_id = (u64::from(shortcut.app_id) << 32) | 0x0200_0000;
                let install = shortcut.exe.as_ref().map(PathBuf::from).filter(|p| p.is_file()).and_then(|p| p.parent().map(Path::to_path_buf))
                    .or_else(|| shortcut.start_dir.as_ref().map(PathBuf::from).filter(|p| p.is_dir()));
                out.push(make(format!("steam-shortcut:{}", shortcut.app_id), shortcut.name, "steam", format!("steam://rungameid/{game_id}"), install.map(|p| p.to_string_lossy().into())));
            }
        }
    }
    out
}

fn scan_steam(steam_roots: &[PathBuf]) -> Vec<ImportedGame> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for library in steam_libraries(steam_roots) { scan_steam_library(&library, &mut seen, &mut out); }
    out.extend(scan_steam_shortcuts(steam_roots));
    sort_games(out)
}

/// Manual scan: the path may be a Steam install, a library, or its `steamapps`.
fn scan_steam_path(path: &Path) -> Vec<ImportedGame> {
    let apps = if path.file_name().and_then(|n| n.to_str()) == Some("steamapps") { path.to_path_buf() } else { path.join("steamapps") };
    let mut out = Vec::new();
    scan_steam_library(&apps, &mut HashSet::new(), &mut out);
    sort_games(out)
}

// ---------------------------------------------------------------------------
// Heroic
// ---------------------------------------------------------------------------

fn heroic_walk(value: &Value, out: &mut Vec<ImportedGame>, seen: &mut HashSet<String>) {
    match value {
        Value::Array(items) => items.iter().for_each(|item| heroic_walk(item, out, seen)),
        Value::Object(object) => {
            let id = string(value, &["app_name", "appName", "appname", "app_id", "appId"]);
            let name = string(value, &["title", "name", "displayName"]);
            let path = string(value, &["install_path", "installPath", "install_location"]);
            let runner = string(value, &["runner"]).unwrap_or_else(|| "legendary".into());
            if let (Some(id), Some(name), Some(path)) = (id, name, path) {
                if Path::new(&path).is_dir() {
                    let key = format!("heroic:{runner}:{id}");
                    if seen.insert(key.clone()) {
                        out.push(make(key, name, "heroic", format!("heroic://launch?appName={}&runner={}", encode(&id), encode(&runner)), Some(path)));
                    }
                }
            }
            object.values().for_each(|item| heroic_walk(item, out, seen));
        }
        _ => {}
    }
}

fn scan_heroic(roots: &[PathBuf]) -> Vec<ImportedGame> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for root in roots.iter().filter(|root| root.is_dir()) {
        if let Some(value) = json(&root.join("legendaryConfig/legendary/installed.json")) { heroic_walk(&value, &mut out, &mut seen); }
        if let Ok(entries) = fs::read_dir(root.join("GamesConfig")) {
            for entry in entries.flatten().filter(|e| e.path().extension().and_then(|x| x.to_str()) == Some("json")) {
                if let Some(value) = json(&entry.path()) { heroic_walk(&value, &mut out, &mut seen); }
            }
        }
    }
    sort_games(out)
}

// ---------------------------------------------------------------------------
// itch.io
// ---------------------------------------------------------------------------

fn find_receipts(root: &Path, depth: usize, out: &mut Vec<PathBuf>) {
    if depth > 5 { return; }
    let Ok(entries) = fs::read_dir(root) else { return };
    for entry in entries.flatten() {
        if real_dir(&entry) {
            find_receipts(&entry.path(), depth + 1, out);
        } else if entry.file_name() == "receipt.json.gz" {
            out.push(entry.path());
        }
    }
}

fn read_receipt(path: &Path) -> Option<Value> {
    use std::io::Read;
    let file = fs::File::open(path).ok()?;
    let mut text = String::new();
    flate2::read::GzDecoder::new(file).take(2 * 1024 * 1024).read_to_string(&mut text).ok()?;
    serde_json::from_str(&text).ok()
}

fn scan_itch(roots: &[PathBuf]) -> Vec<ImportedGame> {
    let mut receipts = Vec::new();
    roots.iter().for_each(|root| find_receipts(root, 0, &mut receipts));
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for receipt in receipts {
        let Some(value) = read_receipt(&receipt) else { continue };
        let game = value.get("game");
        let id = value.get("game_id").or_else(|| value.get("gameId")).and_then(Value::as_i64).or_else(|| game.and_then(|g| g.get("id")).and_then(Value::as_i64));
        let Some(id) = id else { continue };
        if !seen.insert(id) { continue; }
        let name = game.and_then(|g| string(g, &["title", "name"])).or_else(|| string(&value, &["title", "name"])).unwrap_or_else(|| "itch.io game".into());
        out.push(make(format!("itch:{id}"), name, "itch", format!("itch://run-game/{id}"), receipt.parent().and_then(Path::parent).map(|p| p.to_string_lossy().into())));
    }
    sort_games(out)
}

// ---------------------------------------------------------------------------
// Command-line backed sources (Lutris, Bottles)
// ---------------------------------------------------------------------------

#[cfg(target_os = "linux")]
fn scan_lutris() -> Vec<ImportedGame> {
    let Some(mut command) = linux::lutris_command() else { return Vec::new() };
    command.args(["--list-games", "--json"]);
    let Some(output) = run_capture(command, SCAN_TIMEOUT) else { return Vec::new() };
    let text = String::from_utf8_lossy(&output);
    let Some(start) = text.find('[') else { return Vec::new() };
    let Ok(Value::Array(items)) = serde_json::from_str::<Value>(&text[start..]) else { return Vec::new() };
    let games = items.iter().filter_map(|item| {
        let id = item.get("id").and_then(Value::as_i64)?;
        let name = string(item, &["name", "title"])?;
        Some(make(format!("lutris:{id}"), name, "lutris", format!("lutris:rungameid/{id}"), string(item, &["directory", "path"])))
    }).collect();
    sort_games(games)
}

#[cfg(target_os = "linux")]
fn scan_bottles() -> Vec<ImportedGame> {
    let run = |args: &[&str]| linux::bottles_command(args).and_then(|command| run_capture(command, SCAN_TIMEOUT));
    let Some(list) = run(&["list", "bottles"]) else { return Vec::new() };
    let mut out = Vec::new();
    for line in String::from_utf8_lossy(&list).lines() {
        let bottle = line.trim().strip_prefix("- ").unwrap_or("").trim();
        if bottle.is_empty() { continue; }
        let Some(output) = run(&["--json", "programs", "-b", bottle]) else { continue };
        let Ok(value) = serde_json::from_slice::<Value>(&output) else { continue };
        let items = match value {
            Value::Array(items) => items,
            Value::Object(mut object) => object.remove("programs").and_then(|v| if let Value::Array(a) = v { Some(a) } else { None }).unwrap_or_default(),
            _ => Vec::new(),
        };
        for program in items {
            let Some(name) = string(&program, &["name", "title"]) else { continue };
            let executable = string(&program, &["executable", "name"]).unwrap_or_else(|| name.clone());
            out.push(make(format!("bottles:{bottle}:{executable}"), name, "bottles", format!("bottles:run/{}/{}", encode(bottle), encode(&executable)), string(&program, &["path"])));
        }
    }
    sort_games(out)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

fn scan(source: &str, home: &Path) -> Vec<ImportedGame> {
    match source {
        "steam" => scan_steam(&os::steam_roots(home)),
        "heroic" => scan_heroic(&os::heroic_roots(home)),
        "itch" => scan_itch(&os::itch_roots(home)),
        other => os::scan_extra(other, home),
    }
}

pub fn detect_import_sources() -> Vec<DetectedImportSource> {
    let Some(home) = home_dir() else { return Vec::new() };
    let defs = os::source_defs();
    // Launcher CLIs can be slow, so scan every source at once.
    let counts: Vec<usize> = std::thread::scope(|scope| {
        let handles: Vec<_> = defs.iter().map(|def| { let home = &home; scope.spawn(move || scan(def.id, home).len()) }).collect();
        handles.into_iter().map(|handle| handle.join().unwrap_or(0)).collect()
    });
    defs.iter().zip(counts).map(|(def, count)| DetectedImportSource {
        id: def.id.into(),
        name: def.name.into(),
        description: def.description.into(),
        detected: count > 0 || os::is_installed(def.id, &home),
        game_count: Some(count as u32),
    }).collect()
}

pub fn scan_import_games(source: &str, library_path: Option<String>) -> Vec<ImportedGame> {
    let Some(home) = home_dir() else { return Vec::new() };
    let manual = library_path.as_deref().map(str::trim).filter(|path| !path.is_empty()).map(PathBuf::from).filter(|path| path.is_absolute());
    match (source, manual) {
        ("steam", Some(path)) => scan_steam_path(&path),
        ("heroic", Some(path)) => scan_heroic(&[path]),
        ("itch", Some(path)) => scan_itch(&[path]),
        _ => scan(source, &home),
    }
}
