//! Read-only discovery of games installed through other launchers.
//!
//! Shared scanners live here; `linux` and `macos` only say where each launcher
//! keeps its data and which extra sources exist on that platform.

use crate::platform::home_dir;
#[cfg(target_os = "linux")]
use crate::platform::run_capture;
use serde::Serialize;
use serde_json::Value;
use crate::util::MutexExt;
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

#[cfg(target_os = "linux")]
mod linux;
#[cfg(any(target_os = "macos", test))]
mod macos;
#[cfg(target_os = "linux")]
use linux as os;
#[cfg(target_os = "macos")]
use macos as os;

pub mod classify;
mod vdf;

/// Steam install folders for this OS (used to find the signed-in account).
pub fn steam_install_roots(home: &Path) -> Vec<PathBuf> { os::steam_roots(home) }
/// `"key"  "value"` from one VDF line.
pub fn quoted_vdf_value(line: &str, key: &str) -> Option<String> { vdf::quoted_value(line, key) }

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedImportSource {
    pub id: String,
    pub name: String,
    pub description: String,
    /// True when the source has at least one importable item.
    pub detected: bool,
    /// The launcher itself is installed (it may still have nothing to import).
    pub installed: bool,
    pub game_count: Option<u32>,
    pub launcher_count: Option<u32>,
}

#[derive(Clone, Copy, PartialEq, Eq, Serialize, Debug)]
#[serde(rename_all = "lowercase")]
pub enum ImportKind {
    Game,
    Launcher,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedGame {
    pub id: String,
    pub name: String,
    pub source: String,
    pub launch_target: String,
    pub install_path: Option<String>,
    pub kind: ImportKind,
    /// Which known launcher this is (see `classify::LAUNCHERS`), for launcher entries.
    pub launcher_id: Option<String>,
}

pub struct SourceDef {
    pub id: &'static str,
    pub name: &'static str,
    pub description: &'static str,
}

#[cfg(target_os = "linux")]
const SCAN_TIMEOUT: Duration = Duration::from_secs(20);

fn make(id: String, name: String, source: &str, target: String, path: Option<String>) -> ImportedGame {
    ImportedGame { id, name, source: source.into(), launch_target: target, install_path: path, kind: ImportKind::Game, launcher_id: None }
}

fn make_launcher(id: String, name: String, source: &str, target: String, launcher: &str) -> ImportedGame {
    ImportedGame { id, name, source: source.into(), launch_target: target, install_path: None, kind: ImportKind::Launcher, launcher_id: Some(launcher.into()) }
}

/// Re-labels an item as a launcher when its ids or name match a known launcher.
fn classify_item(mut game: ImportedGame, ids: &[&str]) -> ImportedGame {
    if let Some(def) = classify::classify_launcher(ids, &game.name, None) {
        game.kind = ImportKind::Launcher;
        game.launcher_id = Some(def.id.into());
    }
    game
}

fn sort_games(mut games: Vec<ImportedGame>) -> Vec<ImportedGame> {
    games.sort_by_key(|game| (game.kind == ImportKind::Launcher, game.name.to_lowercase()));
    games
}

/// Largest launcher metadata file Mochi will read (library caches can be big, but never this big).
const MAX_METADATA_BYTES: u64 = 16 * 1024 * 1024;

/// Reads a text file, tolerating invalid UTF-8 (launchers write names in whatever encoding the game used).
fn read(path: &Path) -> Option<String> {
    use std::io::Read;
    let mut bytes = Vec::new();
    fs::File::open(path).ok()?.take(MAX_METADATA_BYTES).read_to_end(&mut bytes).ok()?;
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

fn json(path: &Path) -> Option<Value> { serde_json::from_str(&read(path)?).ok() }

fn string(value: &Value, keys: &[&str]) -> Option<String> {
    let object = value.as_object()?;
    keys.iter().find_map(|key| object.get(*key)).and_then(Value::as_str).map(str::to_owned)
}

/// Decodes `%XX` escapes; `None` when the result is not valid UTF-8.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn percent_decode(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let hex = value.get(index + 1..index + 3)?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            index += 3;
        } else {
            out.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(out).ok()
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
            candidates.extend(vdf::library_paths(&text).into_iter().map(|path| PathBuf::from(path).join("steamapps")));
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

/// The Steam client itself; opening it is `steam://open/main` on every platform.
fn steam_launcher() -> ImportedGame {
    make_launcher("launcher:steam".into(), "Steam".into(), "steam", "steam://open/main".into(), "steam")
}

fn scan_steam(steam_roots: &[PathBuf], client_installed: bool) -> Vec<ImportedGame> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for library in steam_libraries(steam_roots) { scan_steam_library(&library, &mut seen, &mut out); }
    out.extend(scan_steam_shortcuts(steam_roots));
    if client_installed || !out.is_empty() { out.push(steam_launcher()); }
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

/// One installed game as Heroic records it, before names are resolved.
#[derive(Debug, PartialEq, Eq)]
struct HeroicInstall {
    id: String,
    title: Option<String>,
    path: String,
    runner: String,
}

const HEROIC_ID_KEYS: [&str; 5] = ["app_name", "appName", "appname", "app_id", "appId"];
const HEROIC_TITLE_KEYS: [&str; 3] = ["title", "name", "displayName"];

/// Finds installed games in any of Heroic's `installed.json` shapes (an object keyed by app name,
/// `{"installed": [...]}`, or a bare array). `loose` also accepts the short `id` / `path` keys
/// that Amazon (nile) installs use; it is only enabled for files known to hold installs.
fn heroic_installs(value: &Value, default_runner: &str, loose: bool, depth: usize, out: &mut Vec<HeroicInstall>) {
    if depth > 8 { return; }
    match value {
        Value::Array(items) => items.iter().for_each(|item| heroic_installs(item, default_runner, loose, depth + 1, out)),
        Value::Object(object) => {
            let id = string(value, &HEROIC_ID_KEYS).or_else(|| loose.then(|| string(value, &["id"])).flatten());
            let mut path_keys = vec!["install_path", "installPath", "install_location", "folder_name"];
            if loose { path_keys.push("path"); }
            let path = string(value, &path_keys);
            let installed = object.get("is_installed").and_then(Value::as_bool) != Some(false) && object.get("is_dlc").and_then(Value::as_bool) != Some(true);
            if let (Some(id), Some(path), true) = (id, path, installed) {
                let runner = string(value, &["runner"]).unwrap_or_else(|| default_runner.to_owned());
                out.push(HeroicInstall { id, title: string(value, &HEROIC_TITLE_KEYS), path, runner });
            }
            object.values().for_each(|item| heroic_installs(item, default_runner, loose, depth + 1, out));
        }
        _ => {}
    }
}

/// Collects `app name -> title` pairs from Heroic's library caches.
fn heroic_titles(value: &Value, depth: usize, out: &mut std::collections::HashMap<String, String>) {
    if depth > 8 { return; }
    match value {
        Value::Array(items) => items.iter().for_each(|item| heroic_titles(item, depth + 1, out)),
        Value::Object(object) => {
            if let (Some(id), Some(title)) = (string(value, &HEROIC_ID_KEYS), string(value, &["title"])) { out.entry(id).or_insert(title); }
            object.values().for_each(|item| heroic_titles(item, depth + 1, out));
        }
        _ => {}
    }
}

/// Files under a Heroic config folder that list installed games: (path, default runner, loose keys).
const HEROIC_INSTALL_FILES: [(&str, &str, bool); 4] = [
    ("legendaryConfig/legendary/installed.json", "legendary", false),
    ("gog_store/installed.json", "gog", true),
    ("nile_config/nile/installed.json", "nile", true),
    ("sideload_apps/library.json", "sideload", false),
];
const HEROIC_LIBRARY_FILES: [&str; 5] = [
    "store_cache/legendary_library.json", "gog_store/library.json", "store_cache/gog_library.json", "store_cache/nile_library.json", "sideload_apps/library.json",
];

fn scan_heroic(roots: &[PathBuf]) -> Vec<ImportedGame> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for root in roots.iter().filter(|root| root.is_dir()) {
        let mut titles = std::collections::HashMap::new();
        for file in HEROIC_LIBRARY_FILES { if let Some(value) = json(&root.join(file)) { heroic_titles(&value, 0, &mut titles); } }
        let mut installs = Vec::new();
        for (file, runner, loose) in HEROIC_INSTALL_FILES {
            if let Some(value) = json(&root.join(file)) { heroic_installs(&value, runner, loose, 0, &mut installs); }
        }
        if let Ok(entries) = fs::read_dir(root.join("GamesConfig")) {
            for entry in entries.flatten().filter(|e| e.path().extension().and_then(|x| x.to_str()) == Some("json")) {
                if let Some(value) = json(&entry.path()) { heroic_installs(&value, "legendary", false, 0, &mut installs); }
            }
        }
        for install in installs {
            // Heroic keeps an entry for games whose folder is gone; those cannot be launched.
            if !Path::new(&install.path).is_dir() { continue; }
            let title = install.title.or_else(|| titles.get(&install.id).cloned())
                .or_else(|| Path::new(&install.path).file_name().map(|name| name.to_string_lossy().into_owned()))
                .unwrap_or_else(|| install.id.clone());
            let key = format!("heroic:{}:{}", install.runner, install.id);
            if seen.insert(key.clone()) {
                out.push(make(key, title, "heroic", format!("heroic://launch?appName={}&runner={}", encode(&install.id), encode(&install.runner)), Some(install.path)));
            }
        }
    }
    sort_games(out)
}

// ---------------------------------------------------------------------------
// Epic Games Launcher (macOS keeps one `.item` manifest per installed game)
// ---------------------------------------------------------------------------

/// Reads one Epic manifest. DLC and add-ons (`AppName` differs from `MainGameAppName`), unfinished
/// installs and entries whose folder is gone are skipped.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn parse_epic_manifest(text: &str) -> Option<ImportedGame> {
    let value: Value = serde_json::from_str(text).ok()?;
    let app_name = string(&value, &["AppName"])?;
    let name = string(&value, &["DisplayName"]).filter(|name| !name.trim().is_empty())?;
    let location = string(&value, &["InstallLocation"])?;
    if string(&value, &["MainGameAppName"]).is_some_and(|main| main != app_name) { return None; }
    if value.get("bIsIncompleteInstall").and_then(Value::as_bool) == Some(true) || !Path::new(&location).is_dir() { return None; }
    if !app_name.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.')) { return None; }
    Some(make(format!("epic:{app_name}"), name, "epic", format!("com.epicgames.launcher://apps/{app_name}?action=launch&silent=true"), Some(location)))
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn scan_epic_manifests(dir: &Path) -> Vec<ImportedGame> {
    let Ok(entries) = fs::read_dir(dir) else { return Vec::new() };
    let mut seen = HashSet::new();
    let games = entries.flatten()
        .filter(|entry| entry.path().extension().and_then(|ext| ext.to_str()) == Some("item"))
        .filter_map(|entry| read(&entry.path()).and_then(|text| parse_epic_manifest(&text)))
        .filter(|game| seen.insert(game.id.clone()))
        .collect();
    sort_games(games)
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

/// The single `.app` bundle directly inside an itch game folder, which is what macOS launches.
fn itch_bundle(game_dir: &Path) -> Option<PathBuf> {
    let mut bundles = fs::read_dir(game_dir).ok()?.flatten().map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|ext| ext.to_str()) == Some("app") && path.is_dir());
    let first = bundles.next()?;
    bundles.next().is_none().then_some(first).filter(|path| path.to_str().is_some())
}

fn scan_itch(roots: &[PathBuf]) -> Vec<ImportedGame> {
    scan_itch_with(roots, cfg!(target_os = "macos"))
}

/// `prefer_bundles`: launch a game's own `.app` directly (macOS). Otherwise, and for games
/// without a unique bundle, ask the itch app to launch it.
fn scan_itch_with(roots: &[PathBuf], prefer_bundles: bool) -> Vec<ImportedGame> {
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
        let install = receipt.parent().and_then(Path::parent);
        let bundle = if prefer_bundles { install.and_then(itch_bundle) } else { None };
        let target = match bundle {
            Some(bundle) => bundle.to_string_lossy().into_owned(),
            None if prefer_bundles => format!("itch://games/{id}"),
            None => format!("itch://run-game/{id}"),
        };
        out.push(make(format!("itch:{id}"), name, "itch", target, install.map(|p| p.to_string_lossy().into())));
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
        "steam" => scan_steam(&os::steam_roots(home), os::is_installed("steam", home)),
        "heroic" => scan_heroic(&os::heroic_roots(home)),
        "itch" => scan_itch(&os::itch_roots(home)),
        other => os::scan_extra(other, home),
    }
}

/// (games, launchers) in a scan result.
fn count_kinds(items: &[ImportedGame]) -> (usize, usize) {
    let launchers = items.iter().filter(|item| item.kind == ImportKind::Launcher).count();
    (items.len() - launchers, launchers)
}

pub fn detect_import_sources() -> Vec<DetectedImportSource> {
    let Some(home) = home_dir() else { return Vec::new() };
    let defs = os::source_defs();
    // Launcher CLIs can be slow, so scan every source at once.
    let scans: Vec<Vec<ImportedGame>> = std::thread::scope(|scope| {
        let handles: Vec<_> = defs.iter().map(|def| { let home = &home; scope.spawn(move || scan(def.id, home)) }).collect();
        handles.into_iter().map(|handle| handle.join().unwrap_or_default()).collect()
    });
    let counts: Vec<(usize, usize)> = scans.iter().map(|games| count_kinds(games)).collect();
    // The import dialog lists sources and then scans the one the user picks: hand that scan the result
    // we already have instead of walking the same folders and running the same launcher CLIs again.
    {
        let mut prescan = prescan().lock_recover();
        prescan.clear();
        let now = Instant::now();
        for (def, games) in defs.iter().zip(scans) { prescan.insert(def.id, (now, games)); }
    }
    defs.iter().zip(counts).map(|(def, (games, launchers))| DetectedImportSource {
        id: def.id.into(),
        name: def.name.into(),
        description: def.description.into(),
        detected: games + launchers > 0,
        installed: games + launchers > 0 || os::is_installed(def.id, &home),
        game_count: Some(games as u32),
        launcher_count: Some(launchers as u32),
    }).collect()
}

/// Scans from the last `detect_import_sources`, each usable once and only briefly, so pressing
/// "rescan" always looks at the disk again.
type Prescan = HashMap<&'static str, (Instant, Vec<ImportedGame>)>;
const PRESCAN_TTL: Duration = Duration::from_secs(15);

fn prescan() -> &'static Mutex<Prescan> {
    static CACHE: OnceLock<Mutex<Prescan>> = OnceLock::new();
    CACHE.get_or_init(Default::default)
}

fn take_prescan(source: &str) -> Option<Vec<ImportedGame>> {
    let mut cache = prescan().lock_recover();
    let (at, games) = cache.remove(source)?;
    (at.elapsed() < PRESCAN_TTL).then_some(games)
}

pub fn scan_import_games(source: &str, library_path: Option<String>) -> Vec<ImportedGame> {
    let Some(home) = home_dir() else { return Vec::new() };
    let manual = library_path.as_deref().map(str::trim).filter(|path| !path.is_empty()).map(PathBuf::from).filter(|path| path.is_absolute());
    match (source, manual) {
        ("steam", Some(path)) => scan_steam_path(&path),
        ("heroic", Some(path)) => scan_heroic(&[path]),
        ("itch", Some(path)) => scan_itch(&[path]),
        _ => take_prescan(source).unwrap_or_else(|| scan(source, &home)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use super::testutil::temp_dir;

    fn write(path: &Path, text: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }

    #[test]
    fn steam_libraries_are_read_in_both_vdf_formats() {
        let root = temp_dir("steam");
        let extra = temp_dir("steam-extra");
        let old = temp_dir("steam-old");
        write(&root.join("steamapps/libraryfolders.vdf"), &format!("\"libraryfolders\"\n{{\n\t\"0\"\n\t{{\n\t\t\"path\"\t\t\"{}\"\n\t\t\"label\"\t\"\"\n\t}}\n\t\"1\"\t\t\"{}\"\n\t\"2\"\t\t\"/Volumes/Unplugged/Steam\"\n}}\n", extra.display(), old.display()));
        for (library, id, name, dir) in [(&root, "10", "Counter-Strike", "Counter-Strike"), (&extra, "620", "Portal 2", "Portal 2"), (&old, "440", "Team Fortress 2", "tf2")] {
            write(&library.join(format!("steamapps/appmanifest_{id}.acf")), &format!("\"AppState\"\n{{\n\t\"appid\"\t\t\"{id}\"\n\t\"name\"\t\t\"{name}\"\n\t\"installdir\"\t\t\"{dir}\"\n}}\n"));
            fs::create_dir_all(library.join("steamapps/common").join(dir)).unwrap();
        }
        // Proton, a broken manifest and a path-traversal install dir are not games.
        write(&root.join("steamapps/appmanifest_1.acf"), "\"AppState\"\n{\n\"appid\" \"1\"\n\"name\" \"Proton 9.0\"\n\"installdir\" \"Proton 9.0\"\n}");
        fs::create_dir_all(root.join("steamapps/common/Proton 9.0")).unwrap();
        write(&root.join("steamapps/appmanifest_2.acf"), "garbage \u{0} \"appid\"");
        write(&root.join("steamapps/appmanifest_3.acf"), "\"AppState\"\n{\n\"appid\" \"3\"\n\"name\" \"Evil\"\n\"installdir\" \"../../etc\"\n}");
        let games = scan_steam(std::slice::from_ref(&root), true);
        let names: Vec<_> = games.iter().map(|game| game.name.as_str()).collect();
        assert_eq!(names, ["Counter-Strike", "Portal 2", "Team Fortress 2", "Steam"]);
        assert_eq!(games[1].launch_target, "steam://rungameid/620");
        for dir in [root, extra, old] { let _ = fs::remove_dir_all(dir); }
    }

    #[test]
    fn heroic_reads_legendary_gog_nile_and_sideloaded_installs() {
        let root = temp_dir("heroic");
        let games = temp_dir("heroic-games");
        for dir in ["Celeste", "Witcher", "Prime", "Side"] { fs::create_dir_all(games.join(dir)).unwrap(); }
        let p = |dir: &str| games.join(dir).display().to_string();
        write(&root.join("legendaryConfig/legendary/installed.json"), &format!(r#"{{"Sugar":{{"app_name":"Sugar","title":"Celeste","install_path":"{}","platform":"Mac"}},"Ghost":{{"app_name":"Ghost","title":"Gone","install_path":"/does/not/exist"}}}}"#, p("Celeste")));
        write(&root.join("gog_store/installed.json"), &format!(r#"{{"installed":[{{"appName":"1207","install_path":"{}","platform":"osx"}},{{"appName":"9","install_path":"{}","is_dlc":true}}]}}"#, p("Witcher"), p("Witcher")));
        write(&root.join("gog_store/library.json"), r#"{"games":[{"app_name":"1207","title":"The Witcher"}]}"#);
        write(&root.join("nile_config/nile/installed.json"), &format!(r#"[{{"id":"amzn1.adg.product.X","path":"{}"}}]"#, p("Prime")));
        write(&root.join("sideload_apps/library.json"), &format!(r#"{{"games":[{{"app_name":"side1","title":"My Side Game","runner":"sideload","folder_name":"{}","is_installed":true}},{{"app_name":"side2","title":"Not Installed","folder_name":"{}","is_installed":false}}]}}"#, p("Side"), p("Side")));
        write(&root.join("GamesConfig/Sugar.json"), r#"{"Sugar":{"wineVersion":{"bin":"/x/wine"}}}"#);
        write(&root.join("GamesConfig/corrupt.json"), "{ not json");
        let found = scan_heroic(&[root.clone(), PathBuf::from("/no/such/heroic")]);
        let summary: Vec<_> = found.iter().map(|game| (game.name.as_str(), game.id.as_str())).collect();
        assert_eq!(summary, [("Celeste", "heroic:legendary:Sugar"), ("My Side Game", "heroic:sideload:side1"), ("Prime", "heroic:nile:amzn1.adg.product.X"), ("The Witcher", "heroic:gog:1207")]);
        let witcher = found.iter().find(|game| game.name == "The Witcher").unwrap();
        assert_eq!(witcher.launch_target, "heroic://launch?appName=1207&runner=gog");
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&games);
    }

    #[test]
    fn epic_manifests_skip_dlc_unfinished_and_missing_installs() {
        let dir = temp_dir("epic");
        let game = temp_dir("epic-game");
        let item = |app: &str, main: &str, name: &str, location: &Path, incomplete: bool| format!(r#"{{"FormatVersion":0,"bIsIncompleteInstall":{incomplete},"AppName":"{app}","MainGameAppName":"{main}","DisplayName":"{name}","InstallLocation":"{}","LaunchExecutable":"G.app/Contents/MacOS/G"}}"#, location.display());
        write(&dir.join("A.item"), &item("Fortnite", "Fortnite", "Fortnite", &game, false));
        write(&dir.join("B.item"), &item("FortniteDLC", "Fortnite", "Fortnite DLC", &game, false));
        write(&dir.join("C.item"), &item("Half", "Half", "Half Installed", &game, true));
        write(&dir.join("D.item"), &item("Gone", "Gone", "Gone", Path::new("/not/here"), false));
        write(&dir.join("E.item"), &item("Bad Name!", "Bad Name!", "Bad", &game, false));
        write(&dir.join("F.item"), "{ nope");
        write(&dir.join("ignored.txt"), "x");
        let games = scan_epic_manifests(&dir);
        assert_eq!(games.len(), 1);
        assert_eq!(games[0].launch_target, "com.epicgames.launcher://apps/Fortnite?action=launch&silent=true");
        assert!(scan_epic_manifests(Path::new("/no/manifests")).is_empty());
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::remove_dir_all(&game);
    }

    #[test]
    fn itch_games_launch_their_own_bundle_on_macos() {
        use std::io::Write;
        let root = temp_dir("itch");
        let receipt = |name: &str, id: i64, bundles: &[&str]| {
            let dir = root.join("apps").join(name);
            for bundle in bundles { fs::create_dir_all(dir.join(bundle)).unwrap(); }
            fs::create_dir_all(dir.join(".itch")).unwrap();
            let mut encoder = flate2::write::GzEncoder::new(fs::File::create(dir.join(".itch/receipt.json.gz")).unwrap(), flate2::Compression::fast());
            write!(encoder, r#"{{"game":{{"id":{id},"title":"{name}"}}}}"#).unwrap();
            encoder.finish().unwrap();
        };
        receipt("One Bundle", 1, &["One.app"]);
        receipt("No Bundle", 2, &[]);
        receipt("Two Bundles", 3, &["A.app", "B.app"]);
        let on_mac = scan_itch_with(std::slice::from_ref(&root), true);
        let target = |games: &[ImportedGame], name: &str| games.iter().find(|game| game.name == name).unwrap().launch_target.clone();
        assert!(target(&on_mac, "One Bundle").ends_with("One Bundle/One.app"));
        assert_eq!(target(&on_mac, "No Bundle"), "itch://games/2");
        assert_eq!(target(&on_mac, "Two Bundles"), "itch://games/3");
        assert_eq!(target(&scan_itch_with(std::slice::from_ref(&root), false), "One Bundle"), "itch://run-game/1");
        // A corrupt receipt is skipped.
        fs::write(root.join("apps/No Bundle/.itch/receipt.json.gz"), b"not gzip").unwrap();
        assert_eq!(scan_itch_with(std::slice::from_ref(&root), true).len(), 2);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn percent_escapes_are_decoded_strictly() {
        assert_eq!(percent_decode("a%20b%2Fc").as_deref(), Some("a b/c"));
        assert_eq!(percent_decode("100%"), None);
        assert_eq!(percent_decode("%zz"), None);
        assert_eq!(percent_decode("%FF"), None);
    }

    #[test]
    fn oversized_or_binary_metadata_is_read_safely() {
        let dir = temp_dir("read");
        write(&dir.join("latin1.acf"), "x");
        fs::write(dir.join("latin1.acf"), [b'"', 0xE9, b'"']).unwrap();
        assert_eq!(read(&dir.join("latin1.acf")).as_deref(), Some("\"\u{FFFD}\""));
        assert!(read(&dir.join("missing")).is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn steam_launcher_targets_the_client() {
        let launcher = steam_launcher();
        assert_eq!(launcher.launch_target, "steam://open/main");
        assert!(launcher.kind == ImportKind::Launcher);
        assert_eq!(launcher.launcher_id.as_deref(), Some("steam"));
    }

    #[test]
    fn classify_item_flags_launchers_and_leaves_games() {
        let game = make("flatpak:org.supertuxproject.SuperTux".into(), "SuperTux".into(), "flatpak", "flatpak://org.supertuxproject.SuperTux".into(), None);
        assert!(classify_item(game, &["org.supertuxproject.SuperTux"]).kind == ImportKind::Game);
        let heroic = make("flatpak:com.heroicgameslauncher.hgl".into(), "Heroic Games Launcher".into(), "flatpak", "flatpak://com.heroicgameslauncher.hgl".into(), None);
        let heroic = classify_item(heroic, &["com.heroicgameslauncher.hgl"]);
        assert!(heroic.kind == ImportKind::Launcher);
        assert_eq!(heroic.launcher_id.as_deref(), Some("heroic"));
    }

    #[test]
    fn launchers_sort_after_games_and_are_counted() {
        let items = sort_games(vec![
            steam_launcher(),
            make("a".into(), "Zelda".into(), "steam", "x".into(), None),
            make("b".into(), "Abe".into(), "steam", "y".into(), None),
        ]);
        assert_eq!(items.iter().map(|i| i.name.as_str()).collect::<Vec<_>>(), ["Abe", "Zelda", "Steam"]);
        assert_eq!(count_kinds(&items), (2, 1));
    }
}

#[cfg(test)]
pub(crate) mod testutil {
    use std::{
        path::PathBuf,
        sync::atomic::{AtomicU32, Ordering},
    };

    /// A fresh empty directory under the system temp folder (callers remove it when done).
    pub fn temp_dir(tag: &str) -> PathBuf {
        static NEXT: AtomicU32 = AtomicU32::new(0);
        let dir = std::env::temp_dir().join(format!("mochi-test-{}-{}-{tag}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("temp dir");
        dir
    }
}
