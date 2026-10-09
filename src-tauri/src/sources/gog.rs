//! GOG games without a database: every GOG install carries a `goggame-<id>.info` JSON file.
//! macOS: GOG Galaxy installs `.app` bundles (in /Applications or its configured library folder).
//! Linux: offline installers and Minigalaxy put games in `~/GOG Games/<Game>` with a `start.sh`.
//! (GOG games managed by Heroic are imported by the Heroic source.)

use super::{json, make, read, real_dir, sort_games, string, ImportedGame};
use serde_json::Value;
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
};

/// GOG Galaxy's configuration on macOS (shared by every user of the Mac).
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub const GALAXY_CONFIG: &str = "/Users/Shared/GOG.com/Galaxy/Configuration/config.json";

/// `(game id, name)` from a `goggame-*.info` in `dir`; DLC (whose root game differs) yields `None`.
fn info_in(dir: &Path) -> Option<(String, String)> {
    let entries = fs::read_dir(dir).ok()?;
    entries.flatten().map(|entry| entry.path())
        .filter(|path| path.file_name().and_then(|n| n.to_str()).is_some_and(|name| name.starts_with("goggame-") && name.ends_with(".info")))
        .filter_map(|path| json(&path))
        .find_map(|value| {
            let id = string(&value, &["gameId"]).or_else(|| value.get("gameId").and_then(Value::as_u64).map(|id| id.to_string()))?;
            let root = string(&value, &["rootGameId"]).or_else(|| value.get("rootGameId").and_then(Value::as_u64).map(|id| id.to_string()));
            if root.is_some_and(|root| root != id) || !id.bytes().all(|b| b.is_ascii_digit()) { return None; }
            Some((id, string(&value, &["name"]).filter(|name| !name.trim().is_empty())?))
        })
}

/// Library folders from Galaxy's `config.json` (several key spellings have been used over the years).
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn galaxy_library_dirs(config: &Path) -> Vec<PathBuf> {
    let Some(value) = json(config) else { return Vec::new() };
    let mut dirs = Vec::new();
    for key in ["libraryPath", "installationPath", "installationPaths", "storagePath"] {
        match value.get(key) {
            Some(Value::String(path)) => dirs.push(PathBuf::from(path)),
            Some(Value::Array(items)) => dirs.extend(items.iter().filter_map(Value::as_str).map(PathBuf::from)),
            _ => {}
        }
    }
    dirs.retain(|dir| dir.is_absolute());
    dirs
}

/// macOS: `.app` bundles (directly in a folder or one level down) carrying GOG metadata.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn scan_bundles(dirs: &[PathBuf]) -> Vec<ImportedGame> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    let mut visit = |bundle: &Path| {
        let Some((id, name)) = info_in(&bundle.join("Contents/Resources")) else { return };
        let Some(location) = bundle.to_str() else { return };
        if seen.insert(id.clone()) { out.push(make(format!("gog:{id}"), name, "gog", location.to_owned(), Some(location.to_owned()))); }
    };
    let is_app = |path: &Path| path.extension().and_then(|ext| ext.to_str()).is_some_and(|ext| ext.eq_ignore_ascii_case("app"));
    for dir in dirs {
        let Ok(entries) = fs::read_dir(dir) else { continue };
        for entry in entries.flatten().take(2000) {
            let path = entry.path();
            if is_app(&path) && path.is_dir() { visit(&path); continue; }
            if !real_dir(&entry) { continue; }
            let Ok(inner) = fs::read_dir(&path) else { continue };
            for nested in inner.flatten().map(|e| e.path()).filter(|p| is_app(p) && p.is_dir()).take(20) { visit(&nested); }
        }
    }
    sort_games(out)
}

/// Linux: `~/GOG Games/<Game>/start.sh` installs. The name comes from `goggame-*.info` or the
/// first line of the installer's `gameinfo` file, else the folder name.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub fn scan_linux_installs(dirs: &[PathBuf]) -> Vec<ImportedGame> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for dir in dirs {
        let Ok(entries) = fs::read_dir(dir) else { continue };
        for entry in entries.flatten().filter(real_dir).take(2000) {
            let game = entry.path();
            let start = game.join("start.sh");
            if !start.is_file() { continue; }
            let info = info_in(&game.join("game")).or_else(|| info_in(&game));
            let name = info.as_ref().map(|(_, name)| name.clone())
                .or_else(|| read(&game.join("gameinfo")).and_then(|text| text.lines().next().map(str::trim).filter(|line| !line.is_empty()).map(str::to_owned)))
                .unwrap_or_else(|| entry.file_name().to_string_lossy().into_owned());
            let key = info.map(|(id, _)| format!("gog:{id}")).unwrap_or_else(|| format!("gog:{}", game.display()));
            let (Some(target), Some(install)) = (start.to_str(), game.to_str()) else { continue };
            if seen.insert(key.clone()) { out.push(make(key, name, "gog", target.to_owned(), Some(install.to_owned()))); }
        }
    }
    sort_games(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sources::testutil::temp_dir;

    fn write(path: &Path, text: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }

    #[test]
    fn galaxy_bundles_are_found_and_dlc_skipped() {
        let apps = temp_dir("gog-apps");
        write(&apps.join("Stardew Valley.app/Contents/Resources/goggame-1453375253.info"), r#"{"gameId":"1453375253","rootGameId":"1453375253","name":"Stardew Valley","playTasks":[]}"#);
        write(&apps.join("GOG Games/Witcher.app/Contents/Resources/goggame-1207658924.info"), r#"{"gameId":1207658924,"name":"The Witcher"}"#);
        write(&apps.join("DLC.app/Contents/Resources/goggame-2.info"), r#"{"gameId":"2","rootGameId":"1","name":"Some DLC"}"#);
        write(&apps.join("Other.app/Contents/Info.plist"), "x");
        write(&apps.join("Broken.app/Contents/Resources/goggame-3.info"), "{ nope");
        let games = scan_bundles(std::slice::from_ref(&apps));
        let summary: Vec<_> = games.iter().map(|game| (game.name.as_str(), game.id.as_str())).collect();
        assert_eq!(summary, [("Stardew Valley", "gog:1453375253"), ("The Witcher", "gog:1207658924")]);
        assert!(games[0].launch_target.ends_with("Stardew Valley.app"));
        let _ = fs::remove_dir_all(apps);
    }

    #[test]
    fn galaxy_config_library_folders_are_read() {
        let dir = temp_dir("gog-config");
        write(&dir.join("config.json"), r#"{"libraryPath":"/Volumes/Games/GOG","installationPaths":["/Applications","relative"],"other":1}"#);
        assert_eq!(galaxy_library_dirs(&dir.join("config.json")), [PathBuf::from("/Volumes/Games/GOG"), PathBuf::from("/Applications")]);
        assert!(galaxy_library_dirs(&dir.join("missing.json")).is_empty());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn linux_installs_use_info_gameinfo_or_folder_names() {
        let root = temp_dir("gog-linux");
        write(&root.join("Celeste/start.sh"), "#!/bin/sh");
        write(&root.join("Celeste/game/goggame-1428938380.info"), r#"{"gameId":"1428938380","name":"Celeste"}"#);
        write(&root.join("FTL/start.sh"), "#!/bin/sh");
        write(&root.join("FTL/gameinfo"), "FTL: Advanced Edition\n1.6.9\n");
        write(&root.join("Plain/start.sh"), "#!/bin/sh");
        write(&root.join("NoStart/gameinfo"), "Nope");
        let games = scan_linux_installs(std::slice::from_ref(&root));
        let names: Vec<_> = games.iter().map(|game| game.name.as_str()).collect();
        assert_eq!(names, ["Celeste", "FTL: Advanced Edition", "Plain"]);
        assert_eq!(games[0].id, "gog:1428938380");
        assert!(games[1].launch_target.ends_with("FTL/start.sh"));
        let _ = fs::remove_dir_all(root);
    }
}
