use super::{make, scan_bottles, scan_lutris, sort_games, ImportedGame, SourceDef};
use crate::platform::{command_exists, list_flatpaks};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

pub fn source_defs() -> Vec<SourceDef> {
    vec![
        SourceDef { id: "flatpak", name: "Flatpak", description: "Installed games delivered through Flatpak." },
        SourceDef { id: "steam", name: "Steam", description: "Games installed through Steam and its libraries." },
        SourceDef { id: "heroic", name: "Heroic Games Launcher", description: "Epic, GOG and Amazon games managed by Heroic." },
        SourceDef { id: "lutris", name: "Lutris", description: "Existing Lutris games and launch configurations." },
        SourceDef { id: "bottles", name: "Bottles", description: "Windows games and applications inside Bottles." },
        SourceDef { id: "itch", name: "itch.io", description: "Games installed with the itch desktop app." },
        SourceDef { id: "apps", name: "Desktop applications", description: "Games registered in your application menu." },
    ]
}

pub fn steam_roots(home: &Path) -> Vec<PathBuf> {
    vec![home.join(".steam/steam"), home.join(".steam/root"), home.join(".local/share/Steam"), home.join(".var/app/com.valvesoftware.Steam/.local/share/Steam")]
}

pub fn heroic_roots(home: &Path) -> Vec<PathBuf> {
    vec![home.join(".config/heroic"), home.join(".var/app/com.heroicgameslauncher.hgl/config/heroic")]
}

pub fn itch_roots(home: &Path) -> Vec<PathBuf> {
    vec![home.join(".config/itch"), home.join("Games"), home.join(".local/share/itch")]
}

fn flatpak_data(home: &Path, id: &str) -> bool { home.join(".var/app").join(id).is_dir() }

pub fn is_installed(source: &str, home: &Path) -> bool {
    match source {
        "flatpak" => command_exists("flatpak"),
        "steam" => command_exists("steam") || flatpak_data(home, "com.valvesoftware.Steam"),
        "heroic" => command_exists("heroic") || flatpak_data(home, "com.heroicgameslauncher.hgl"),
        "lutris" => command_exists("lutris") || flatpak_data(home, "net.lutris.Lutris"),
        "bottles" => command_exists("bottles-cli") || flatpak_data(home, "com.usebottles.bottles"),
        "itch" => command_exists("itch-setup") || home.join(".itch").exists(),
        _ => false,
    }
}

pub fn lutris_command() -> Option<Command> {
    if command_exists("lutris") { return Some(Command::new("lutris")); }
    if flatpak_data(&crate::platform::home_dir()?, "net.lutris.Lutris") && command_exists("flatpak") {
        let mut command = Command::new("flatpak");
        command.args(["run", "net.lutris.Lutris"]);
        return Some(command);
    }
    None
}

pub fn bottles_command(args: &[&str]) -> Option<Command> {
    let command = if command_exists("bottles-cli") {
        let mut command = Command::new("bottles-cli");
        command.args(args);
        command
    } else if flatpak_data(&crate::platform::home_dir()?, "com.usebottles.bottles") && command_exists("flatpak") {
        let mut command = Command::new("flatpak");
        command.args(["run", "--command=bottles-cli", "com.usebottles.bottles"]).args(args);
        command
    } else {
        return None;
    };
    Some(command)
}

/// Reads the unlocalised keys of a `.desktop` file's `[Desktop Entry]` group.
fn desktop_entry(text: &str) -> std::collections::HashMap<&str, &str> {
    let mut entry = std::collections::HashMap::new();
    let mut in_group = false;
    for line in text.lines().map(str::trim) {
        if line.starts_with('[') { in_group = line == "[Desktop Entry]"; continue; }
        if let (true, Some((key, value))) = (in_group, line.split_once('=')) { entry.entry(key.trim()).or_insert(value.trim()); }
    }
    entry
}

fn scan_desktop_apps(home: &Path) -> Vec<ImportedGame> {
    let mut dirs = vec![home.join(".local/share/applications"), PathBuf::from("/usr/share/applications"), PathBuf::from("/usr/local/share/applications")];
    if let Some(extra) = std::env::var_os("XDG_DATA_DIRS") {
        dirs.extend(std::env::split_paths(&extra).map(|dir| dir.join("applications")));
    }
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for dir in dirs {
        let Ok(entries) = fs::read_dir(&dir) else { continue };
        for file in entries.flatten().map(|e| e.path()).filter(|p| p.extension().and_then(|e| e.to_str()) == Some("desktop")) {
            let file_name = file.file_name().and_then(|n| n.to_str()).unwrap_or_default().to_owned();
            if file_name.starts_with("mochi") || !seen.insert(file_name.clone()) { continue; }
            let Ok(text) = fs::read_to_string(&file) else { continue };
            let entry = desktop_entry(&text);
            let is_game = entry.get("Categories").is_some_and(|c| c.split(';').any(|c| c.eq_ignore_ascii_case("Game")));
            let hidden = ["NoDisplay", "Hidden"].iter().any(|key| entry.get(key) == Some(&"true"));
            // Flatpak and Steam entries are covered by their own sources.
            let covered = entry.contains_key("X-Flatpak") || entry.get("Exec").is_some_and(|e| e.contains("steam://") || e.starts_with("flatpak run"));
            if entry.get("Type") != Some(&"Application") || !is_game || hidden || covered { continue; }
            let Some(name) = entry.get("Name").filter(|n| !n.is_empty()) else { continue };
            out.push(make(format!("apps:{file_name}"), (*name).to_owned(), "apps", file.to_string_lossy().into_owned(), entry.get("Path").map(|p| (*p).to_owned())));
        }
    }
    sort_games(out)
}

pub fn scan_extra(source: &str, home: &Path) -> Vec<ImportedGame> {
    match source {
        "flatpak" => list_flatpaks().unwrap_or_default().into_iter().filter(|app| app.category == "Games")
            .map(|app| make(format!("flatpak:{}", app.id), app.name, "flatpak", format!("flatpak://{}", app.id), None)).collect(),
        "lutris" => scan_lutris(),
        "bottles" => scan_bottles(),
        "apps" => scan_desktop_apps(home),
        _ => Vec::new(),
    }
}
