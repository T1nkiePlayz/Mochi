//! macOS import sources: where each launcher keeps its data under `~/Library`, plus `.app`
//! bundles, Epic manifests and Whisky bottles. The parsers are platform-neutral so they are
//! unit-tested on Linux as well; only the roots below are macOS specific.
#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

use super::{classify, icons, make, make_launcher, scan_epic_manifests, sort_games, ImportedGame, SourceDef};
use crate::platform::command_exists;
use std::{
    fs,
    path::{Path, PathBuf},
};

pub fn source_defs() -> Vec<SourceDef> {
    vec![
        SourceDef { id: "steam", name: "Steam", description: "Games installed through Steam and its libraries." },
        SourceDef { id: "heroic", name: "Heroic Games Launcher", description: "Epic, GOG and Amazon games managed by Heroic." },
        SourceDef { id: "epic", name: "Epic Games Launcher", description: "Games installed with the Epic Games Launcher." },
        SourceDef { id: "itch", name: "itch.io", description: "Games installed with the itch desktop app." },
        SourceDef { id: "whisky", name: "Whisky", description: "Windows programs pinned in your Whisky bottles." },
        SourceDef { id: "apps", name: "Applications", description: "Games in your Applications folders." },
    ]
}

fn support(home: &Path) -> PathBuf { home.join("Library/Application Support") }

pub fn steam_roots(home: &Path) -> Vec<PathBuf> { vec![support(home).join("Steam")] }

pub fn heroic_roots(home: &Path) -> Vec<PathBuf> { vec![support(home).join("heroic")] }

pub fn itch_roots(home: &Path) -> Vec<PathBuf> { vec![support(home).join("itch"), home.join("Games"), home.join(".itch")] }

fn epic_manifests(home: &Path) -> PathBuf { support(home).join("Epic/EpicGamesLauncher/Data/Manifests") }

fn whisky_bottles(home: &Path) -> PathBuf { home.join("Library/Containers/com.isaacmarovitz.Whisky/Bottles") }

fn app_exists(name: &str, home: &Path) -> bool {
    Path::new("/Applications").join(name).exists() || home.join("Applications").join(name).exists()
}

pub fn is_installed(source: &str, home: &Path) -> bool {
    match source {
        "steam" => support(home).join("Steam").exists() || app_exists("Steam.app", home),
        "heroic" => support(home).join("heroic").exists() || app_exists("Heroic Games Launcher.app", home),
        "epic" => support(home).join("Epic/EpicGamesLauncher").exists() || app_exists("Epic Games Launcher.app", home),
        "itch" => support(home).join("itch").exists() || app_exists("itch.app", home) || command_exists("itch-setup"),
        "whisky" => whisky_bottles(home).exists() || app_exists("Whisky.app", home),
        _ => false,
    }
}

fn is_games_category(plist: &plist::Value) -> bool {
    plist.as_dictionary().and_then(|d| d.get("LSApplicationCategoryType")).and_then(plist::Value::as_string).is_some_and(|category| category.to_ascii_lowercase().contains("games"))
}

/// Programs CrossOver creates for installed Windows applications carry this bundle id prefix
/// (the CrossOver app itself is `com.codeweavers.CrossOver`, without the trailing dot).
fn is_crossover_program(bundle_id: Option<&str>) -> bool {
    bundle_id.is_some_and(|id| id.to_ascii_lowercase().starts_with("com.codeweavers.crossover."))
}

/// Classifies one `.app` bundle: Mochi itself and non-game apps yield `None`.
fn app_item(path: &Path, info: &plist::Value, own_exe: Option<&Path>) -> Option<ImportedGame> {
    let dict = info.as_dictionary();
    let text = |key: &str| dict.and_then(|d| d.get(key)).and_then(plist::Value::as_string).map(str::trim).filter(|value| !value.is_empty());
    let stem = path.file_stem()?.to_string_lossy().into_owned();
    let name = text("CFBundleDisplayName").or_else(|| text("CFBundleName")).map(str::to_owned).unwrap_or_else(|| stem.clone());
    let bundle_id = text("CFBundleIdentifier");
    let executable = text("CFBundleExecutable").map(|exe| path.join("Contents/MacOS").join(exe));
    if classify::is_mochi(&[&stem], &name, bundle_id, own_exe, executable.as_deref().and_then(Path::to_str)) { return None; }
    // Launch targets are stored as text; a path that is not valid UTF-8 would be corrupted.
    let location = path.to_str()?.to_owned();
    let icon = icons::bundle_icon(path, text("CFBundleIconFile")).and_then(|icon| icon.to_str().map(str::to_owned));
    if let Some(def) = classify::classify_launcher(&[&stem], &name, bundle_id) {
        if classify::SOURCE_OWNED_LAUNCHERS.contains(&def.id) { return None; }
        let mut item = make_launcher(format!("apps:{location}"), name, "apps", location.clone(), def.id);
        item.install_path = Some(location);
        item.icon_path = icon;
        return Some(item);
    }
    if !(is_games_category(info) || is_crossover_program(bundle_id)) || classify::is_non_game(&[&stem], &name) { return None; }
    let mut item = make(format!("apps:{location}"), name, "apps", location.clone(), Some(location));
    item.icon_path = icon;
    Some(item)
}

/// Looks for `.app` bundles in `dir` and (up to two levels) in plain sub-folders such as
/// `/Applications/Games` or `~/Applications/CrossOver/<bottle>`. A symlinked bundle (Homebrew
/// casks, `ln -s`) is followed; a symlinked plain folder is not, so scans cannot loop.
fn collect_apps(dir: &Path, depth: usize, own_exe: Option<&Path>, out: &mut Vec<ImportedGame>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()).is_some_and(|ext| ext.eq_ignore_ascii_case("app")) {
            if !path.is_dir() { continue; }
            let Ok(info) = plist::Value::from_file(path.join("Contents/Info.plist")) else { continue };
            if let Some(item) = app_item(&path, &info, own_exe) { out.push(item); }
        } else if depth < 2 && entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false) {
            collect_apps(&path, depth + 1, own_exe, out);
        }
    }
}

fn url_to_path(url: &str) -> Option<String> {
    let rest = url.strip_prefix("file://").unwrap_or(url);
    // `file://localhost/path` and `file:///path` both mean the local file system.
    let rest = rest.strip_prefix("localhost").unwrap_or(rest);
    let decoded = super::percent_decode(rest)?;
    decoded.starts_with('/').then_some(decoded)
}

/// Programs pinned in one Whisky bottle's `Metadata.plist` (`info.pins`, each with a name and a file URL).
fn whisky_pins(bottle: &str, metadata: &plist::Value) -> Vec<ImportedGame> {
    let Some(pins) = metadata.as_dictionary().and_then(|d| d.get("info")).and_then(plist::Value::as_dictionary)
        .and_then(|info| info.get("pins")).and_then(plist::Value::as_array) else { return Vec::new() };
    let mut out = Vec::new();
    for pin in pins.iter().filter_map(plist::Value::as_dictionary) {
        let Some(name) = pin.get("name").and_then(plist::Value::as_string).map(str::trim).filter(|name| !name.is_empty()) else { continue };
        // Foundation encodes a URL either as a plain string or as a `{relative: ...}` dictionary.
        let url = pin.get("url").and_then(|url| url.as_string().or_else(|| url.as_dictionary().and_then(|d| d.get("relative")).and_then(plist::Value::as_string)));
        let Some(path) = url.and_then(url_to_path) else { continue };
        if !Path::new(&path).is_file() { continue; }
        let install = Path::new(&path).parent().and_then(Path::to_str).map(str::to_owned);
        out.push(make(format!("whisky:{bottle}:{path}"), name.to_owned(), "whisky", path, install));
    }
    out
}

fn scan_whisky(bottles: &Path) -> Vec<ImportedGame> {
    let Ok(entries) = fs::read_dir(bottles) else { return Vec::new() };
    let mut out = Vec::new();
    for bottle in entries.flatten() {
        let Ok(metadata) = plist::Value::from_file(bottle.path().join("Metadata.plist")) else { continue };
        out.extend(whisky_pins(&bottle.file_name().to_string_lossy(), &metadata));
    }
    sort_games(out)
}

pub fn scan_extra(source: &str, home: &Path) -> Vec<ImportedGame> {
    match source {
        "apps" => {
            let mut out = Vec::new();
            let own_exe = std::env::current_exe().ok();
            let mut seen = std::collections::HashSet::new();
            for dir in [PathBuf::from("/Applications"), home.join("Applications")] { collect_apps(&dir, 0, own_exe.as_deref(), &mut out); }
            out.retain(|item| seen.insert(item.id.clone()));
            sort_games(out)
        }
        "epic" => scan_epic_manifests(&epic_manifests(home)),
        "whisky" => scan_whisky(&whisky_bottles(home)),
        _ => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sources::{testutil::temp_dir, ImportKind};

    fn info(extra: &str) -> plist::Value {
        let xml = format!(r#"<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>{extra}</dict></plist>"#);
        plist::Value::from_reader_xml(xml.as_bytes()).expect("fixture plist")
    }

    const GAME: &str = "<key>CFBundleName</key><string>Dead Cells</string><key>CFBundleIdentifier</key><string>com.motiontwin.deadcells</string><key>CFBundleExecutable</key><string>DeadCells</string><key>LSApplicationCategoryType</key><string>public.app-category.action-games</string>";

    #[test]
    fn game_category_bundles_are_games() {
        let item = app_item(Path::new("/Applications/Dead Cells.app"), &info(GAME), None).expect("game");
        assert_eq!((item.name.as_str(), item.kind), ("Dead Cells", ImportKind::Game));
        assert_eq!(item.launch_target, "/Applications/Dead Cells.app");
        let display = info("<key>CFBundleDisplayName</key><string>Cells!</string><key>CFBundleName</key><string>dc</string><key>LSApplicationCategoryType</key><string>public.app-category.games</string>");
        assert_eq!(app_item(Path::new("/Applications/dc.app"), &display, None).unwrap().name, "Cells!");
    }

    #[test]
    fn non_games_mochi_and_steam_are_skipped() {
        let editor = info("<key>CFBundleName</key><string>TextEdit</string><key>LSApplicationCategoryType</key><string>public.app-category.productivity</string>");
        assert!(app_item(Path::new("/Applications/TextEdit.app"), &editor, None).is_none());
        assert!(app_item(Path::new("/Applications/NoCategory.app"), &info("<key>CFBundleName</key><string>NoCategory</string>"), None).is_none());
        let mochi = info("<key>CFBundleName</key><string>Mochi</string><key>CFBundleIdentifier</key><string>dev.sidequestgames.Mochilauncher</string><key>LSApplicationCategoryType</key><string>public.app-category.games</string>");
        assert!(app_item(Path::new("/Applications/Mochi.app"), &mochi, None).is_none());
        let steam = info("<key>CFBundleName</key><string>Steam</string><key>CFBundleIdentifier</key><string>com.valvesoftware.steam</string>");
        assert!(app_item(Path::new("/Applications/Steam.app"), &steam, None).is_none());
    }

    #[test]
    fn launchers_and_crossover_programs_are_recognised() {
        let epic = info("<key>CFBundleName</key><string>Epic Games Launcher</string><key>CFBundleIdentifier</key><string>com.epicgames.EpicGamesLauncher</string>");
        let item = app_item(Path::new("/Applications/Epic Games Launcher.app"), &epic, None).expect("launcher");
        assert_eq!((item.kind, item.launcher_id.as_deref()), (ImportKind::Launcher, Some("epic")));
        let program = info("<key>CFBundleName</key><string>Skyrim</string><key>CFBundleIdentifier</key><string>com.codeweavers.CrossOver.Skyrim</string>");
        assert_eq!(app_item(Path::new("/Users/me/Applications/CrossOver/Steam/Skyrim.app"), &program, None).unwrap().kind, ImportKind::Game);
        let crossover = info("<key>CFBundleName</key><string>CrossOver</string><key>CFBundleIdentifier</key><string>com.codeweavers.CrossOver</string>");
        assert_eq!(app_item(Path::new("/Applications/CrossOver.app"), &crossover, None).unwrap().launcher_id.as_deref(), Some("crossover"));
    }

    #[test]
    fn scanning_finds_nested_and_symlinked_bundles_and_survives_junk() {
        let root = temp_dir("apps");
        let make_app = |dir: &Path, name: &str, plist: Option<&str>| {
            let contents = dir.join(format!("{name}.app/Contents"));
            fs::create_dir_all(&contents).unwrap();
            if let Some(text) = plist { fs::write(contents.join("Info.plist"), text).unwrap(); }
        };
        let xml = |name: &str| format!(r#"<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleName</key><string>{name}</string><key>LSApplicationCategoryType</key><string>public.app-category.games</string></dict></plist>"#);
        make_app(&root, "Top", Some(&xml("Top")));
        make_app(&root.join("Games/Indie"), "Deep", Some(&xml("Deep")));
        make_app(&root, "Broken", Some("not a plist"));
        make_app(&root, "NoPlist", None);
        // A bundle that lives elsewhere and is linked in, as Homebrew casks do.
        let elsewhere = temp_dir("apps-elsewhere");
        make_app(&elsewhere, "Linked", Some(&xml("Linked")));
        std::os::unix::fs::symlink(elsewhere.join("Linked.app"), root.join("Linked.app")).unwrap();
        // A symlinked folder that points back at the root must not loop.
        std::os::unix::fs::symlink(&root, root.join("Loop")).unwrap();
        // A dangling link is ignored.
        std::os::unix::fs::symlink(root.join("missing.app"), root.join("Gone.app")).unwrap();

        let mut found = Vec::new();
        collect_apps(&root, 0, None, &mut found);
        let mut names: Vec<_> = found.iter().map(|item| item.name.clone()).collect();
        names.sort();
        assert_eq!(names, ["Deep", "Linked", "Top"]);
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&elsewhere);
    }

    #[test]
    fn whisky_pins_are_listed_for_existing_programs_only() {
        let root = temp_dir("whisky");
        let exe = root.join("drive_c/Games/Hades.exe");
        fs::create_dir_all(exe.parent().unwrap()).unwrap();
        fs::write(&exe, b"MZ").unwrap();
        let encoded = exe.to_str().unwrap().replace(' ', "%20");
        let metadata = info(&format!("<key>info</key><dict><key>name</key><string>Games</string><key>pins</key><array><dict><key>name</key><string>Hades</string><key>url</key><string>file://{encoded}</string></dict><dict><key>name</key><string>Missing</string><key>url</key><string>file:///nope/missing.exe</string></dict><dict><key>name</key><string>No url</string></dict></array></dict>"));
        let games = whisky_pins("ABC", &metadata);
        assert_eq!(games.len(), 1);
        assert_eq!((games[0].name.as_str(), games[0].source.as_str()), ("Hades", "whisky"));
        assert_eq!(games[0].launch_target, exe.to_str().unwrap());
        // Round trip through a real bottle folder.
        let bottle = root.join("Bottles/ABC");
        fs::create_dir_all(&bottle).unwrap();
        metadata.to_file_xml(bottle.join("Metadata.plist")).unwrap();
        assert_eq!(scan_whisky(&root.join("Bottles")).len(), 1);
        assert!(scan_whisky(&root.join("nothing-here")).is_empty());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn url_forms_are_converted_to_paths() {
        assert_eq!(url_to_path("file:///Users/me/My%20Games/a.exe").as_deref(), Some("/Users/me/My Games/a.exe"));
        assert_eq!(url_to_path("file://localhost/Users/me/a.exe").as_deref(), Some("/Users/me/a.exe"));
        assert_eq!(url_to_path("/already/a/path").as_deref(), Some("/already/a/path"));
        assert_eq!(url_to_path("https://example.com/x"), None);
    }

    #[test]
    fn roots_follow_the_macos_layout() {
        let home = Path::new("/Users/me");
        assert_eq!(steam_roots(home), [PathBuf::from("/Users/me/Library/Application Support/Steam")]);
        assert_eq!(heroic_roots(home), [PathBuf::from("/Users/me/Library/Application Support/heroic")]);
        assert_eq!(epic_manifests(home), PathBuf::from("/Users/me/Library/Application Support/Epic/EpicGamesLauncher/Data/Manifests"));
        assert_eq!(whisky_bottles(home), PathBuf::from("/Users/me/Library/Containers/com.isaacmarovitz.Whisky/Bottles"));
    }
}
