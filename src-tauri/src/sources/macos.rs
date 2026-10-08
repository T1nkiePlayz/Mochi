use super::{make, sort_games, ImportedGame, SourceDef};
use crate::platform::command_exists;
use std::{
    fs,
    path::{Path, PathBuf},
};

pub fn source_defs() -> Vec<SourceDef> {
    vec![
        SourceDef { id: "steam", name: "Steam", description: "Games installed through Steam and its libraries." },
        SourceDef { id: "heroic", name: "Heroic Games Launcher", description: "Epic, GOG and Amazon games managed by Heroic." },
        SourceDef { id: "itch", name: "itch.io", description: "Games installed with the itch desktop app." },
        SourceDef { id: "apps", name: "Applications", description: "Games in your Applications folders." },
    ]
}

fn support(home: &Path) -> PathBuf { home.join("Library/Application Support") }

pub fn steam_roots(home: &Path) -> Vec<PathBuf> { vec![support(home).join("Steam")] }

pub fn heroic_roots(home: &Path) -> Vec<PathBuf> { vec![support(home).join("heroic")] }

pub fn itch_roots(home: &Path) -> Vec<PathBuf> { vec![support(home).join("itch"), home.join("Games"), home.join(".itch")] }

pub fn is_installed(source: &str, home: &Path) -> bool {
    match source {
        "steam" => support(home).join("Steam").exists() || Path::new("/Applications/Steam.app").exists(),
        "heroic" => support(home).join("heroic").exists() || Path::new("/Applications/Heroic Games Launcher.app").exists(),
        "itch" => support(home).join("itch").exists() || Path::new("/Applications/itch.app").exists() || command_exists("itch-setup"),
        _ => false,
    }
}

fn is_games_category(plist: &plist::Value) -> bool {
    plist.as_dictionary().and_then(|d| d.get("LSApplicationCategoryType")).and_then(plist::Value::as_string).is_some_and(|category| category.to_ascii_lowercase().contains("games"))
}

fn collect_apps(dir: &Path, depth: usize, out: &mut Vec<ImportedGame>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        let is_dir = entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false);
        if !is_dir { continue; }
        if path.extension().and_then(|e| e.to_str()) != Some("app") {
            if depth < 2 { collect_apps(&path, depth + 1, out); }
            continue;
        }
        let Ok(info) = plist::Value::from_file(path.join("Contents/Info.plist")) else { continue };
        if !is_games_category(&info) { continue; }
        let dict = info.as_dictionary();
        let name = ["CFBundleDisplayName", "CFBundleName"].iter().find_map(|key| dict.and_then(|d| d.get(key)).and_then(plist::Value::as_string))
            .map(str::to_owned).or_else(|| path.file_stem().map(|s| s.to_string_lossy().into_owned()));
        if let Some(name) = name {
            out.push(make(format!("apps:{}", path.display()), name, "apps", path.to_string_lossy().into_owned(), Some(path.to_string_lossy().into_owned())));
        }
    }
}

pub fn scan_extra(source: &str, home: &Path) -> Vec<ImportedGame> {
    if source != "apps" { return Vec::new(); }
    let mut out = Vec::new();
    for dir in [PathBuf::from("/Applications"), home.join("Applications")] { collect_apps(&dir, 0, &mut out); }
    sort_games(out)
}
