use super::{battlenet, classify, classify_item, gog, icons, prism, make, make_launcher, scan_bottles, scan_lutris, sort_games, ImportedGame, SourceDef};
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

pub fn is_installed(source: &str, home: &Path) -> bool {
    match source {
        "flatpak" => command_exists("flatpak"),
        "steam" => command_exists("steam") || flatpak_data(home, "com.valvesoftware.Steam"),
        "heroic" => command_exists("heroic") || flatpak_data(home, "com.heroicgameslauncher.hgl"),
        "lutris" => command_exists("lutris") || flatpak_data(home, "net.lutris.Lutris"),
        "bottles" => command_exists("bottles-cli") || flatpak_data(home, "com.usebottles.bottles"),
        "itch" => command_exists("itch-setup") || home.join(".itch").exists(),
        "prism" => instance_roots(home).iter().any(|(root, _)| root.is_dir()),
        "battlenet" => !wine_prefixes(home).is_empty(),
        "gog" => gog_dirs(home).iter().any(|dir| dir.is_dir()) || command_exists("minigalaxy") || flatpak_data(home, "io.github.sharkwouter.Minigalaxy"),
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
    if let Some(def) = launcher {
        // Steam is imported by its own source (with a proper client launch target).
        if classify::SOURCE_OWNED_LAUNCHERS.contains(&def.id) { return None; }
        let mut item = make_launcher(format!("apps:{file_name}"), (*name).to_owned(), "apps", file.to_string_lossy().into_owned(), def.id);
        item.install_path = entry.get("Path").map(|p| (*p).to_owned());
        item.icon_path = icon;
        return Some(item);
    }
    let is_game = entry.get("Categories").is_some_and(|c| c.split(';').any(|c| c.eq_ignore_ascii_case("Game")));
    // Flatpak and Steam entries are covered by their own sources.
    let covered = entry.contains_key("X-Flatpak") || exec.contains("steam://") || exec.starts_with("flatpak run");
    if !is_game || covered || classify::is_non_game(&ids, name) { return None; }
    let mut item = make(format!("apps:{file_name}"), (*name).to_owned(), "apps", file.to_string_lossy().into_owned(), entry.get("Path").map(|p| (*p).to_owned()));
    item.icon_path = icon;
    Some(item)
}

fn scan_desktop_apps(home: &Path) -> Vec<ImportedGame> {
    let mut dirs = vec![home.join(".local/share/applications"), PathBuf::from("/usr/share/applications"), PathBuf::from("/usr/local/share/applications")];
    if let Some(extra) = std::env::var_os("XDG_DATA_DIRS") {
        dirs.extend(std::env::split_paths(&extra).map(|dir| dir.join("applications")));
    }
    let own_exe = std::env::current_exe().ok();
    let icon_dirs = icons::data_dirs(home);
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for dir in dirs {
        let Ok(entries) = fs::read_dir(&dir) else { continue };
        for file in entries.flatten().map(|e| e.path()).filter(|p| p.extension().and_then(|e| e.to_str()) == Some("desktop")) {
            let file_name = file.file_name().and_then(|n| n.to_str()).unwrap_or_default().to_owned();
            if !seen.insert(file_name) { continue; }
            let Ok(text) = fs::read_to_string(&file) else { continue };
            if let Some(item) = parse_desktop_app(&file, &text, own_exe.as_deref(), &icon_dirs) { out.push(item); }
        }
    }
    sort_games(out)
}

pub fn scan_extra(source: &str, home: &Path) -> Vec<ImportedGame> {
    match source {
        "flatpak" => {
            let icon_dirs = icons::data_dirs(home);
            list_flatpaks().unwrap_or_default().into_iter().filter(|app| app.category == "Games")
                .filter(|app| !classify::is_mochi(&[&app.id], &app.name, None, None, None) && !classify::is_non_game(&[&app.id], &app.name))
                .map(|app| {
                    let id = app.id.clone();
                    let mut item = classify_item(make(format!("flatpak:{}", app.id), app.name, "flatpak", format!("flatpak://{}", app.id), None), &[&id]);
                    // Flatpak exports its icons under the application id.
                    item.icon_path = icons::resolve_icon(&id, &icon_dirs).and_then(|path| path.to_str().map(str::to_owned));
                    item
                }).collect()
        }
        "lutris" => scan_lutris(),
        "bottles" => scan_bottles(),
        "apps" => scan_desktop_apps(home),
        "battlenet" => battlenet::scan_prefixes(&wine_prefixes(home)),
        "gog" => gog::scan_linux_installs(&gog_dirs(home)),
        _ => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(file: &str, text: &str) -> Option<ImportedGame> { parse_desktop_app(Path::new(file), text, None, &[]) }

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
