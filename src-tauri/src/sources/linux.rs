use super::{battlenet, classify, gog, icons, launchers::{self, DetectedLauncher, Env, Memo, Method}, prism, make, make_launcher, scan_bottles, scan_lutris, sort_games, ImportedGame, SourceDef};
use crate::platform::{command_exists, command_path, list_flatpaks, FlatpakApp};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::Arc,
};

pub fn source_defs() -> Vec<SourceDef> {
    vec![
        SourceDef { id: "flatpak", name: "Flatpak", description: "Installed games delivered through Flatpak." },
        SourceDef { id: "steam", name: "Steam", description: "Games installed through Steam and its libraries." },
        SourceDef { id: "heroic", name: "Heroic Games Launcher", description: "Epic, GOG and Amazon games managed by Heroic." },
        SourceDef { id: "lutris", name: "Lutris", description: "Existing Lutris games and launch configurations." },
        SourceDef { id: "bottles", name: "Bottles", description: "Windows games and applications inside Bottles." },
        SourceDef { id: "itch", name: "itch.io", description: "Games installed with the itch desktop app." },
        SourceDef { id: "prism", name: "Minecraft instances", description: "Instances from Prism Launcher, PolyMC, MultiMC and Fjord Launcher." },
        SourceDef { id: "battlenet", name: "Battle.net", description: "Blizzard games installed in Wine prefixes (Lutris, Bottles, Heroic)." },
        SourceDef { id: "gog", name: "GOG", description: "GOG games from the offline installers or Minigalaxy (~/GOG Games)." },
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

fn data_home(home: &Path) -> PathBuf {
    std::env::var_os("XDG_DATA_HOME").map(PathBuf::from).filter(|dir| dir.is_absolute()).unwrap_or_else(|| home.join(".local/share"))
}

/// Data folders of the MultiMC-family launchers (native and Flatpak).
pub fn instance_roots(home: &Path) -> Vec<(PathBuf, &'static prism::InstanceLauncher)> {
    let data = data_home(home);
    prism::INSTANCE_LAUNCHERS.iter().flat_map(|launcher| {
        let mut roots = vec![(data.join(launcher.dir), launcher)];
        if let Some(flatpak) = launcher.flatpak { roots.push((home.join(".var/app").join(flatpak).join("data").join(launcher.dir), launcher)); }
        roots
    }).collect()
}

/// Wine prefixes where Battle.net is commonly installed: Lutris (`~/Games/<name>`), Heroic,
/// Bottles (native and Flatpak) and the default `~/.wine`.
pub fn wine_prefixes(home: &Path) -> Vec<PathBuf> {
    let mut prefixes = vec![home.join(".wine")];
    let children = |dir: PathBuf| fs::read_dir(dir).into_iter().flatten().flatten().filter(super::real_dir).map(|entry| entry.path()).take(200).collect::<Vec<_>>();
    for parent in [home.join("Games"), home.join("Games/Heroic/Prefixes/default"), data_home(home).join("bottles/bottles"), home.join(".var/app/com.usebottles.bottles/data/bottles/bottles")] {
        prefixes.extend(children(parent));
    }
    prefixes.retain(|prefix| prefix.join(battlenet::PREFIX_PRODUCT_DB).is_file());
    prefixes
}

fn gog_dirs(home: &Path) -> Vec<PathBuf> { vec![home.join("GOG Games"), home.join("Games/GOG Games")] }

/// Everything one pass over the desktop entries, Flatpaks and launcher detectors finds. The
/// "apps" and "flatpak" sources and `is_installed` share it, so a launcher installed several
/// ways is reported once and the slow lookups run once.
struct Snapshot {
    games: Vec<ImportedGame>,
    launchers: Vec<DetectedLauncher>,
    flatpaks: Vec<FlatpakApp>,
}

struct RealEnv {
    home: PathBuf,
    flatpaks: Vec<(String, String)>,
    scanned: Vec<(Method, ImportedGame)>,
}

impl Env for RealEnv {
    fn home(&self) -> PathBuf { self.home.clone() }
    fn binary(&self, name: &str) -> Option<PathBuf> { command_path(name) }
    fn exists(&self, path: &Path) -> bool { path.exists() }
    fn flatpaks(&self) -> &[(String, String)] { &self.flatpaks }
    fn scanned(&self) -> &[(Method, ImportedGame)] { &self.scanned }
}

fn snapshot(home: &Path) -> Arc<Snapshot> {
    static MEMO: Memo<Snapshot> = Memo::new();
    MEMO.get(|| {
        let (games, scanned) = scan_desktop_apps(home);
        let flatpaks = list_flatpaks().unwrap_or_default();
        let env = RealEnv { home: home.to_path_buf(), flatpaks: flatpaks.iter().map(|app| (app.id.clone(), app.name.clone())).collect(), scanned };
        Snapshot { games, launchers: launchers::detect_launchers(&env), flatpaks }
    })
}

fn launcher_installed(home: &Path, id: &str) -> bool { snapshot(home).launchers.iter().any(|launcher| launcher.def_id == id) }

pub fn is_installed(source: &str, home: &Path) -> bool {
    match source {
        "flatpak" => command_exists("flatpak"),
        "steam" => launcher_installed(home, "steam") || flatpak_data(home, "com.valvesoftware.Steam"),
        "heroic" => launcher_installed(home, "heroic") || flatpak_data(home, "com.heroicgameslauncher.hgl"),
        "lutris" => launcher_installed(home, "lutris") || flatpak_data(home, "net.lutris.Lutris"),
        "bottles" => launcher_installed(home, "bottles") || command_exists("bottles-cli") || flatpak_data(home, "com.usebottles.bottles"),
        "itch" => launcher_installed(home, "itch") || home.join(".itch").exists(),
        "prism" => instance_roots(home).iter().any(|(root, _)| root.is_dir()),
        "battlenet" => !wine_prefixes(home).is_empty(),
        "gog" => gog_dirs(home).iter().any(|dir| dir.is_dir()) || launcher_installed(home, "minigalaxy") || flatpak_data(home, "io.github.sharkwouter.Minigalaxy"),
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

/// Turns one `.desktop` file into an importable item, or `None` when it is Mochi,
/// hidden, a system tool, covered by another source, or neither a game nor a known launcher.
fn parse_desktop_app(file: &Path, text: &str, own_exe: Option<&Path>, icon_dirs: &[PathBuf]) -> Option<ImportedGame> {
    let file_name = file.file_name()?.to_str()?.to_owned();
    let stem = file_name.trim_end_matches(".desktop");
    let entry = desktop_entry(text);
    let name = entry.get("Name").filter(|n| !n.is_empty())?;
    let exec = entry.get("Exec").copied().unwrap_or_default();
    let program = classify::exec_program(exec);
    let mut ids = vec![stem];
    ids.extend(program.as_deref());
    let exec_path = exec.split_whitespace().next().map(|t| t.trim_matches('"'));
    let hidden = ["NoDisplay", "Hidden"].iter().any(|key| entry.get(key) == Some(&"true"));
    if entry.get("Type") != Some(&"Application") || hidden || classify::is_mochi(&ids, name, None, own_exe, exec_path) { return None; }

    let icon = entry.get("Icon").and_then(|value| icons::resolve_icon(value, icon_dirs)).and_then(|path| path.to_str().map(str::to_owned));
    let launcher = classify::classify_launcher(&ids, name, None);
    // Flatpak and Steam entries are covered by their own sources.
    let covered = entry.contains_key("X-Flatpak") || exec.contains("steam://") || exec.starts_with("flatpak run");
    if let Some(def) = launcher {
        // Steam is imported by its own source (with a proper client launch target); Flatpak launchers by the Flatpak source.
        if classify::SOURCE_OWNED_LAUNCHERS.contains(&def.id) || covered { return None; }
        let mut item = make_launcher(format!("apps:{file_name}"), (*name).to_owned(), "apps", file.to_string_lossy().into_owned(), def.id);
        item.install_path = entry.get("Path").map(|p| (*p).to_owned());
        item.icon_path = icon;
        return Some(item);
    }
    let is_game = entry.get("Categories").is_some_and(|c| c.split(';').any(|c| c.eq_ignore_ascii_case("Game")));
    if !is_game || covered || classify::is_non_game(&ids, name) { return None; }
    let mut item = make(format!("apps:{file_name}"), (*name).to_owned(), "apps", file.to_string_lossy().into_owned(), entry.get("Path").map(|p| (*p).to_owned()));
    item.icon_path = icon;
    Some(item)
}

/// Desktop entries as (games, launcher entries with the method that found them). Snap exports its
/// entries to `/var/lib/snapd/desktop/applications`.
fn scan_desktop_apps(home: &Path) -> (Vec<ImportedGame>, Vec<(Method, ImportedGame)>) {
    let mut dirs = vec![home.join(".local/share/applications"), PathBuf::from("/usr/share/applications"), PathBuf::from("/usr/local/share/applications"), PathBuf::from(SNAP_APPLICATIONS)];
    if let Some(extra) = std::env::var_os("XDG_DATA_DIRS") {
        dirs.extend(std::env::split_paths(&extra).map(|dir| dir.join("applications")));
    }
    let own_exe = std::env::current_exe().ok();
    let icon_dirs = icons::data_dirs(home);
    let mut seen = std::collections::HashSet::new();
    let (mut games, mut launchers) = (Vec::new(), Vec::new());
    for dir in dirs {
        let Ok(entries) = fs::read_dir(&dir) else { continue };
        let method = if dir.starts_with("/var/lib/snapd") { Method::Snap } else { Method::Desktop };
        for file in entries.flatten().map(|e| e.path()).filter(|p| p.extension().and_then(|e| e.to_str()) == Some("desktop")) {
            let file_name = file.file_name().and_then(|n| n.to_str()).unwrap_or_default().to_owned();
            if !seen.insert(file_name) { continue; }
            let Ok(text) = fs::read_to_string(&file) else { continue };
            match parse_desktop_app(&file, &text, own_exe.as_deref(), &icon_dirs) {
                Some(item) if item.kind == super::ImportKind::Launcher => launchers.push((method, item)),
                Some(item) => games.push(item),
                None => {}
            }
        }
    }
    (sort_games(games), launchers)
}

const SNAP_APPLICATIONS: &str = "/var/lib/snapd/desktop/applications";

/// The Flatpak source lists games; launchers (Heroic, Sober, ...) come from the launcher detectors.
fn flatpak_items(snapshot: &Snapshot, home: &Path) -> Vec<ImportedGame> {
    let icon_dirs = icons::data_dirs(home);
    // Flatpak exports its icons under the application id.
    let icon = |id: &str| icons::resolve_icon(id, &icon_dirs).and_then(|path| path.to_str().map(str::to_owned));
    let games = snapshot.flatpaks.iter().filter(|app| app.category == "Games" && classify::classify_launcher(&[&app.id], &app.name, None).is_none())
        .filter(|app| !classify::is_mochi(&[&app.id], &app.name, None, None, None) && !classify::is_non_game(&[&app.id], &app.name))
        .map(|app| { let mut item = make(format!("flatpak:{}", app.id), app.name.clone(), "flatpak", format!("flatpak://{}", app.id), None); item.icon_path = icon(&app.id); item });
    let launchers = snapshot.launchers.iter().filter(|l| l.method == Method::Flatpak && launchers::emittable(l)).map(|l| {
        let mut item = l.to_item("flatpak");
        item.icon_path = l.launch_target.strip_prefix("flatpak://").and_then(icon);
        item
    });
    games.chain(launchers).collect()
}

/// Desktop-entry games plus every detected launcher whose best install method is not Flatpak.
fn app_items(snapshot: &Snapshot) -> Vec<ImportedGame> {
    let launchers = snapshot.launchers.iter().filter(|l| l.method != Method::Flatpak && launchers::emittable(l)).map(|l| l.to_item("apps"));
    sort_games(snapshot.games.iter().cloned().chain(launchers).collect())
}

pub fn scan_extra(source: &str, home: &Path) -> Vec<ImportedGame> {
    match source {
        "flatpak" => flatpak_items(&snapshot(home), home),
        "lutris" => scan_lutris(),
        "bottles" => scan_bottles(),
        "apps" => app_items(&snapshot(home)),
        "battlenet" => battlenet::scan_prefixes(&wine_prefixes(home)),
        "gog" => gog::scan_linux_installs(&gog_dirs(home)),
        _ => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(file: &str, text: &str) -> Option<ImportedGame> { parse_desktop_app(Path::new(file), text, None, &[]) }

    fn flatpak(id: &str, name: &str, category: &str) -> FlatpakApp { FlatpakApp { id: id.into(), name: name.into(), category: category.into() } }

    struct Fake(Vec<(String, String)>);
    impl Env for Fake {
        fn home(&self) -> PathBuf { PathBuf::from("/home/u") }
        fn binary(&self, _: &str) -> Option<PathBuf> { None }
        fn exists(&self, _: &Path) -> bool { false }
        fn flatpaks(&self) -> &[(String, String)] { &self.0 }
        fn scanned(&self) -> &[(Method, ImportedGame)] { &[] }
    }

    #[test]
    fn flatpak_source_lists_games_and_detected_launchers_once() {
        let flatpaks = vec![flatpak("org.vinegarhq.Sober", "Sober", "Other"), flatpak("com.valvesoftware.Steam", "Steam", "Games"), flatpak("com.heroicgameslauncher.hgl", "Heroic Games Launcher", "Games"),
            flatpak("org.supertuxproject.SuperTux", "SuperTux", "Games"), flatpak("org.gnome.Calculator", "Calculator", "Other")];
        let env = Fake(flatpaks.iter().map(|app| (app.id.clone(), app.name.clone())).collect());
        let snapshot = Snapshot { games: Vec::new(), launchers: launchers::detect_launchers(&env), flatpaks };
        let items = flatpak_items(&snapshot, Path::new("/home/u"));
        let ids: Vec<_> = items.iter().map(|item| item.id.as_str()).collect();
        assert_eq!(ids, ["flatpak:org.supertuxproject.SuperTux", "flatpak:com.heroicgameslauncher.hgl", "flatpak:org.vinegarhq.Sober"]);
        // Steam belongs to the Steam source, so it is not listed as a launcher here either.
        assert!(!ids.iter().any(|id| id.contains("Steam")));
        assert!(items.iter().filter(|item| item.kind == super::super::ImportKind::Launcher).count() == 2);
    }

    #[test]
    fn launchers_found_natively_are_not_repeated_for_flatpak() {
        let env = Fake(vec![("net.lutris.Lutris".into(), "Lutris".into())]);
        let native = make_launcher("apps:lutris.desktop".into(), "Lutris".into(), "apps", "/usr/share/applications/net.lutris.Lutris.desktop".into(), "lutris");
        struct Both(Fake, Vec<(Method, ImportedGame)>);
        impl Env for Both {
            fn home(&self) -> PathBuf { self.0.home() }
            fn binary(&self, _: &str) -> Option<PathBuf> { None }
            fn exists(&self, _: &Path) -> bool { false }
            fn flatpaks(&self) -> &[(String, String)] { self.0.flatpaks() }
            fn scanned(&self) -> &[(Method, ImportedGame)] { &self.1 }
        }
        let snapshot = Snapshot { games: Vec::new(), launchers: launchers::detect_launchers(&Both(env, vec![(Method::Desktop, native)])), flatpaks: Vec::new() };
        assert!(flatpak_items(&snapshot, Path::new("/home/u")).is_empty());
        let apps = app_items(&snapshot);
        assert_eq!((apps.len(), apps[0].id.as_str()), (1, "apps:lutris.desktop"));
    }

    #[test]
    fn flatpak_exported_launcher_entries_are_left_to_the_flatpak_source() {
        let entry = "[Desktop Entry]\nType=Application\nName=Sober\nExec=/usr/bin/flatpak run --branch=stable org.vinegarhq.Sober\nX-Flatpak=org.vinegarhq.Sober\n";
        assert!(parse("/var/lib/flatpak/exports/share/applications/org.vinegarhq.Sober.desktop", entry).is_none());
        let native = "[Desktop Entry]\nType=Application\nName=Lutris\nExec=lutris\n";
        assert!(parse("/usr/share/applications/net.lutris.Lutris.desktop", native).is_some());
    }

    #[test]
    fn mochi_desktop_entries_are_excluded() {
        let entry = "[Desktop Entry]\nType=Application\nName=Mochi\nExec=mochi %U\nCategories=Game;\n";
        assert!(parse("/usr/share/applications/mochi.desktop", entry).is_none());
        assert!(parse("/usr/share/applications/dev.sidequestgames.Mochilauncher.desktop", entry).is_none());
        // Renamed entry that still runs the Mochi binary.
        let renamed = "[Desktop Entry]\nType=Application\nName=Games\nExec=/opt/mochi/mochi\nCategories=Game;\n";
        let own = Path::new("/opt/mochi/mochi");
        assert!(parse_desktop_app(Path::new("/x/games.desktop"), renamed, Some(own), &[]).is_none());
    }

    #[test]
    fn games_and_launchers_are_classified() {
        let game = "[Desktop Entry]\nType=Application\nName=SuperTux\nExec=supertux2\nCategories=Game;ArcadeGame;\n";
        let item = parse("/usr/share/applications/supertux.desktop", game).expect("game");
        assert!(item.kind == super::super::ImportKind::Game);

        let prism = "[Desktop Entry]\nType=Application\nName=Prism Launcher\nExec=prismlauncher\nCategories=Game;\n";
        let item = parse("/usr/share/applications/org.prismlauncher.PrismLauncher.desktop", prism).expect("launcher");
        assert!(item.kind == super::super::ImportKind::Launcher);
        assert_eq!(item.launcher_id.as_deref(), Some("prism"));

        // Launchers need no Game category.
        let bottles = "[Desktop Entry]\nType=Application\nName=Bottles\nExec=bottles\nCategories=Utility;\n";
        assert_eq!(parse("/x/com.usebottles.bottles.desktop", bottles).and_then(|i| i.launcher_id).as_deref(), Some("bottles"));
    }

    #[test]
    fn desktop_entry_icons_are_resolved() {
        let root = crate::sources::testutil::temp_dir("desktop-icons");
        let icon = root.join("icons/hicolor/256x256/apps/supertux.png");
        fs::create_dir_all(icon.parent().unwrap()).unwrap();
        fs::write(&icon, b"\x89PNG").unwrap();
        let entry = "[Desktop Entry]\nType=Application\nName=SuperTux\nExec=supertux2\nIcon=supertux\nCategories=Game;\n";
        let item = parse_desktop_app(Path::new("/x/supertux.desktop"), entry, None, std::slice::from_ref(&root)).expect("game");
        assert_eq!(item.icon_path.as_deref(), icon.to_str());
        let missing = entry.replace("Icon=supertux", "Icon=not-installed");
        assert_eq!(parse_desktop_app(Path::new("/x/supertux.desktop"), &missing, None, std::slice::from_ref(&root)).unwrap().icon_path, None);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn steam_hidden_tools_and_non_games_are_dropped() {
        let steam = "[Desktop Entry]\nType=Application\nName=Steam\nExec=/usr/bin/steam %U\nCategories=Game;\n";
        assert!(parse("/usr/share/applications/steam.desktop", steam).is_none());
        let hidden = "[Desktop Entry]\nType=Application\nName=Hidden Game\nExec=g\nCategories=Game;\nNoDisplay=true\n";
        assert!(parse("/x/hidden.desktop", hidden).is_none());
        let tool = "[Desktop Entry]\nType=Application\nName=Protontricks\nExec=protontricks --gui\nCategories=Game;Utility;\n";
        assert!(parse("/x/protontricks.desktop", tool).is_none());
        let utility = "[Desktop Entry]\nType=Application\nName=Calculator\nExec=calc\nCategories=Utility;\n";
        assert!(parse("/x/calc.desktop", utility).is_none());
    }
}
