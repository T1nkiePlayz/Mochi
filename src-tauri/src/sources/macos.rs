use super::{classify, make, make_launcher, sort_games, ImportedGame, SourceDef};
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

/// Classifies one `.app` bundle: Mochi itself and non-game apps yield `None`.
fn app_item(path: &Path, info: &plist::Value, own_exe: Option<&Path>) -> Option<ImportedGame> {
    let dict = info.as_dictionary();
    let text = |key: &str| dict.and_then(|d| d.get(key)).and_then(plist::Value::as_string);
    let stem = path.file_stem()?.to_string_lossy().into_owned();
    let name = text("CFBundleDisplayName").or_else(|| text("CFBundleName")).map(str::to_owned).unwrap_or_else(|| stem.clone());
    let bundle_id = text("CFBundleIdentifier");
    let executable = text("CFBundleExecutable").map(|exe| path.join("Contents/MacOS").join(exe));
    if classify::is_mochi(&[&stem], &name, bundle_id, own_exe, executable.as_deref().and_then(Path::to_str)) { return None; }
    let location = path.to_string_lossy().into_owned();
    if let Some(def) = classify::classify_launcher(&[&stem], &name, bundle_id) {
        if classify::SOURCE_OWNED_LAUNCHERS.contains(&def.id) { return None; }
        let mut item = make_launcher(format!("apps:{location}"), name, "apps", location.clone(), def.id);
        item.install_path = Some(location);
        return Some(item);
    }
    if !is_games_category(info) || classify::is_non_game(&[&stem], &name) { return None; }
    Some(make(format!("apps:{location}"), name, "apps", location.clone(), Some(location)))
}

fn collect_apps(dir: &Path, depth: usize, own_exe: Option<&Path>, out: &mut Vec<ImportedGame>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        let is_dir = entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false);
        if !is_dir { continue; }
        if path.extension().and_then(|e| e.to_str()) != Some("app") {
            if depth < 2 { collect_apps(&path, depth + 1, own_exe, out); }
            continue;
        }
        let Ok(info) = plist::Value::from_file(path.join("Contents/Info.plist")) else { continue };
        if let Some(item) = app_item(&path, &info, own_exe) { out.push(item); }
    }
}

pub fn scan_extra(source: &str, home: &Path) -> Vec<ImportedGame> {
    if source != "apps" { return Vec::new(); }
    let mut out = Vec::new();
    let own_exe = std::env::current_exe().ok();
    for dir in [PathBuf::from("/Applications"), home.join("Applications")] { collect_apps(&dir, 0, own_exe.as_deref(), &mut out); }
    sort_games(out)
}
