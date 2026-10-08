use super::{DetectedImportSource, ImportedGame};
use serde_json::Value;
use std::{collections::HashSet, env, fs, path::{Path, PathBuf}, process::Command};

fn home() -> PathBuf { env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(".")) }
fn app_support() -> PathBuf { home().join("Library/Application Support") }
fn command_exists(command: &str) -> bool { Command::new("sh").args(["-c", &format!("command -v {command}")]).output().map(|o| o.status.success()).unwrap_or(false) }
fn read(path: &Path) -> Option<String> { fs::read_to_string(path).ok() }
fn json(path: &Path) -> Option<Value> { serde_json::from_str(&read(path)?).ok() }
fn field<'a>(value: &'a Value, keys: &[&str]) -> Option<&'a Value> { value.as_object().and_then(|object| keys.iter().find_map(|key| object.get(*key))) }
fn string(value: &Value, keys: &[&str]) -> Option<String> { field(value, keys).and_then(Value::as_str).map(str::to_owned) }
fn enc(value: &str) -> String { value.bytes().fold(String::new(), |mut out, byte| { if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') { out.push(byte as char) } else { out.push_str(&format!("%{byte:02X}")) } out }) }
fn make(id: String, name: String, source: &str, target: String, path: Option<String>) -> ImportedGame { ImportedGame { id, name, source: source.into(), launch_target: target, install_path: path } }
fn quote_value(line: &str, key: &str) -> Option<String> { let marker = format!("\"{key}\""); let remainder = line.split_once(&marker)?.1.trim().strip_prefix('"')?; Some(remainder[..remainder.find('"')?].replace("\\\\", "\\")) }

fn steam_libraries() -> Vec<PathBuf> {
    let primary = app_support().join("Steam/steamapps");
    let mut libraries = Vec::new();
    if primary.is_dir() { libraries.push(primary.clone()); }
    if let Some(vdf) = read(&primary.join("libraryfolders.vdf")) {
        for line in vdf.lines() {
            if let Some(path) = quote_value(line, "path") {
                let steamapps = PathBuf::from(path).join("steamapps");
                if steamapps.is_dir() && !libraries.contains(&steamapps) { libraries.push(steamapps); }
            }
        }
    }
    libraries
}

fn scan_steam(path_override: Option<&Path>) -> Vec<ImportedGame> {
    let roots = path_override.map(|path| vec![if path.file_name().and_then(|v| v.to_str()) == Some("steamapps") { path.to_path_buf() } else { path.join("steamapps") }]).unwrap_or_else(steam_libraries);
    let mut games = Vec::new();
    let mut seen = HashSet::new();
    for root in roots {
        let Ok(entries) = fs::read_dir(&root) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            let filename = path.file_name().and_then(|v| v.to_str()).unwrap_or("");
            if !filename.starts_with("appmanifest_") || path.extension().and_then(|v| v.to_str()) != Some("acf") { continue; }
            let Some(contents) = read(&path) else { continue };
            let id = contents.lines().find_map(|line| quote_value(line, "appid"));
            let title = contents.lines().find_map(|line| quote_value(line, "name"));
            let install_dir = contents.lines().find_map(|line| quote_value(line, "installdir"));
            let (Some(id), Some(title), Some(install_dir)) = (id, title, install_dir) else { continue };
            let install = root.join("common").join(install_dir);
            if install.is_dir() && seen.insert(id.clone()) { games.push(make(format!("steam:{id}"), title, "steam", format!("steam://rungameid/{id}"), Some(install.to_string_lossy().into()))); }
        }
    }
    games.sort_by_key(|game| game.name.to_lowercase());
    games
}

fn heroic_walk(value: &Value, games: &mut Vec<ImportedGame>, seen: &mut HashSet<String>) {
    match value {
        Value::Array(items) => for item in items { heroic_walk(item, games, seen); },
        Value::Object(object) => {
            let id = string(value, &["app_name", "appName", "appname", "app_id", "appId"]);
            let name = string(value, &["title", "name", "displayName"]);
            let path = string(value, &["install_path", "installPath", "install_location"]);
            let runner = string(value, &["runner"]).unwrap_or_else(|| "legendary".into());
            if let (Some(id), Some(name), Some(path)) = (id, name, path) {
                if Path::new(&path).is_dir() {
                    let key = format!("heroic:{runner}:{id}");
                    if seen.insert(key.clone()) { games.push(make(key, name, "heroic", format!("heroic://launch?appName={}&runner={}", enc(&id), enc(&runner)), Some(path))); }
                }
            }
            for item in object.values() { heroic_walk(item, games, seen); }
        }
        _ => {}
    }
}

fn scan_heroic(path_override: Option<&Path>) -> Vec<ImportedGame> {
    let root = path_override.map(Path::to_path_buf).unwrap_or_else(|| app_support().join("heroic"));
    let mut games = Vec::new();
    let mut seen = HashSet::new();
    if let Some(value) = json(&root.join("legendaryConfig/legendary/installed.json")) { heroic_walk(&value, &mut games, &mut seen); }
    let config_dir = root.join("GamesConfig");
    if let Ok(entries) = fs::read_dir(config_dir) {
        for entry in entries.flatten() {
            if entry.path().extension().and_then(|v| v.to_str()) == Some("json") {
                if let Some(value) = json(&entry.path()) { heroic_walk(&value, &mut games, &mut seen); }
            }
        }
    }
    games.sort_by_key(|game| game.name.to_lowercase());
    games
}

fn scan_lutris() -> Vec<ImportedGame> {
    if !command_exists("lutris") { return Vec::new(); }
    let Ok(output) = Command::new("lutris").args(["--list-games", "--json"]).output() else { return Vec::new() };
    if !output.status.success() { return Vec::new() }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let Some(start) = stdout.find('[') else { return Vec::new() };
    let Ok(Value::Array(items)) = serde_json::from_str::<Value>(&stdout[start..]) else { return Vec::new() };
    let mut games = Vec::new();
    for value in items {
        let Some(id) = field(&value, &["id"]).and_then(Value::as_i64) else { continue };
        let Some(name) = string(&value, &["name", "title"]) else { continue };
        games.push(make(format!("lutris:{id}"), name, "lutris", format!("lutris:rungameid/{id}"), string(&value, &["directory", "path"])));
    }
    games.sort_by_key(|game| game.name.to_lowercase());
    games
}

fn bottles_command(args: &[&str]) -> Option<Command> {
    if !command_exists("bottles-cli") { return None; }
    let mut command = Command::new("bottles-cli");
    command.args(args);
    Some(command)
}

fn scan_bottles() -> Vec<ImportedGame> {
    let Some(mut command) = bottles_command(&["list", "bottles"]) else { return Vec::new() };
    let Ok(output) = command.output() else { return Vec::new() };
    if !output.status.success() { return Vec::new() }
    let mut games = Vec::new();
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let bottle = line.trim().strip_prefix("- ").unwrap_or("").trim();
        if bottle.is_empty() { continue }
        let Some(mut programs) = bottles_command(&["--json", "programs", "-b", bottle]) else { continue };
        let Ok(output) = programs.output() else { continue };
        let Ok(value) = serde_json::from_slice::<Value>(&output.stdout) else { continue };
        let items = match value { Value::Array(items) => items, Value::Object(object) => object.get("programs").and_then(Value::as_array).cloned().unwrap_or_default(), _ => Vec::new() };
        for program in items {
            let Some(name) = string(&program, &["name", "title"]) else { continue };
            let executable = string(&program, &["name", "executable"]).unwrap_or_else(|| name.clone());
            games.push(make(format!("bottles:{bottle}:{executable}"), name, "bottles", format!("bottles:run/{}/{}", enc(bottle), enc(&executable)), string(&program, &["path"])));
        }
    }
    games.sort_by_key(|game| game.name.to_lowercase());
    games
}

fn receipts(root: &Path, depth: usize, output: &mut Vec<PathBuf>) {
    if depth > 5 || !root.is_dir() { return }
    let Ok(entries) = fs::read_dir(root) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() { receipts(&path, depth + 1, output); }
        else if path.file_name().and_then(|v| v.to_str()) == Some("receipt.json.gz") { output.push(path); }
    }
}

fn scan_itch(path_override: Option<&Path>) -> Vec<ImportedGame> {
    let home = home();
    let roots = path_override.map(|path| vec![path.to_path_buf()]).unwrap_or_else(|| vec![app_support().join("itch"), home.join("Games"), home.join(".itch")]);
    let mut receipts_found = Vec::new();
    for root in roots { receipts(&root, 0, &mut receipts_found); }
    let mut games = Vec::new();
    let mut seen = HashSet::new();
    for receipt in receipts_found {
        let Ok(output) = Command::new("gzip").arg("-cd").arg(&receipt).output() else { continue };
        let Ok(value) = serde_json::from_slice::<Value>(&output.stdout) else { continue };
        let id = field(&value, &["game_id", "gameId"]).and_then(Value::as_i64).or_else(|| field(&value, &["game"]).and_then(|game| field(game, &["id"]).and_then(Value::as_i64)));
        let Some(id) = id else { continue };
        let id = id.to_string();
        if !seen.insert(id.clone()) { continue }
        let name = field(&value, &["game"]).and_then(|game| string(game, &["title", "name"])).or_else(|| string(&value, &["title", "name"])).unwrap_or_else(|| "itch.io game".into());
        games.push(make(format!("itch:{id}"), name, "itch", format!("itch://run-game/{id}"), receipt.parent().and_then(Path::parent).map(|p| p.to_string_lossy().into())));
    }
    games.sort_by_key(|game| game.name.to_lowercase());
    games
}

pub fn detect_import_sources() -> Vec<DetectedImportSource> {
    let support = app_support();
    let steam_games = scan_steam(None);
    let heroic_games = scan_heroic(None);
    let lutris_games = scan_lutris();
    let bottles_games = scan_bottles();
    let itch_games = scan_itch(None);
    vec![
        DetectedImportSource { id: "steam".into(), name: "Steam".into(), description: "Games installed through Steam and its libraries.".into(), detected: support.join("Steam").exists() || command_exists("steam") || !steam_games.is_empty(), game_count: Some(steam_games.len() as u32) },
        DetectedImportSource { id: "heroic".into(), name: "Heroic Games Launcher".into(), description: "Epic, GOG and Amazon games managed by Heroic.".into(), detected: support.join("heroic").exists() || command_exists("heroic") || !heroic_games.is_empty(), game_count: Some(heroic_games.len() as u32) },
        DetectedImportSource { id: "lutris".into(), name: "Lutris".into(), description: "Existing Lutris games and launch configurations.".into(), detected: command_exists("lutris") || !lutris_games.is_empty(), game_count: Some(lutris_games.len() as u32) },
        DetectedImportSource { id: "bottles".into(), name: "Bottles".into(), description: "Windows games and applications inside Bottles.".into(), detected: command_exists("bottles-cli") || !bottles_games.is_empty(), game_count: Some(bottles_games.len() as u32) },
        DetectedImportSource { id: "itch".into(), name: "itch.io".into(), description: "Games installed with the itch desktop app.".into(), detected: support.join("itch").exists() || home().join(".itch").exists() || !itch_games.is_empty(), game_count: Some(itch_games.len() as u32) },
    ]
}

pub fn scan_import_games(source: &str, library_path: Option<String>) -> Vec<ImportedGame> {
    let override_path = library_path.as_deref().map(Path::new);
    match source {
        "steam" => scan_steam(override_path),
        "heroic" => scan_heroic(override_path),
        "lutris" => scan_lutris(),
        "bottles" => scan_bottles(),
        "itch" => scan_itch(override_path),
        _ => Vec::new(),
    }
}
