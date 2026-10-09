//! Finds the folders a game loads mods from: Minecraft instances of every common launcher (Linux, Flatpak, macOS),
//! and a per-game table for other games (BepInEx plugins, `Mods`, `Data`, tModLoader, ...).
//! Detection only reads folder names and a few small instance files; it never writes anything.
use serde::Serialize;
use serde_json::Value;
use std::{
    fs,
    path::{Path, PathBuf},
};

use crate::platform::Os;

const MAX_INSTANCES: usize = 300;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModLocation {
    /// Stable per path, usable as a list key.
    pub id: String,
    pub label: String,
    /// "Minecraft Launcher", "Prism Launcher", "Steam", ...
    pub launcher: String,
    pub instance: Option<String>,
    /// The folder the game loads mods from.
    pub mods_dir: String,
    /// Minecraft only: the game folder holding `resourcepacks`, `shaderpacks` and `saves`.
    pub content_root: Option<String>,
    pub exists: bool,
    /// Minecraft only, from the instance's own files: "vanilla", "fabric", "quilt", "forge" or "neoforge".
    pub loader: Option<String>,
    pub game_version: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum Layout {
    /// The folder is one game folder (`mods` inside).
    Single,
    /// The folder holds one sub-folder per instance, each with a `.minecraft` / `minecraft` / direct game folder.
    Instances,
}

#[derive(Debug, Clone)]
struct Root { launcher: &'static str, path: PathBuf, layout: Layout }

/// Every place a Minecraft launcher keeps game folders on `os`. `home` is injected so tests can use a fake one.
fn minecraft_roots(os: Os, home: &Path, env: &dyn Fn(&str) -> Option<std::ffi::OsString>) -> Vec<Root> {
    let mut roots = Vec::new();
    let mut add = |launcher: &'static str, path: PathBuf, layout: Layout| roots.push(Root { launcher, path, layout });
    match os {
        Os::MacOs => {
            let support = home.join("Library/Application Support");
            add("Minecraft Launcher", support.join("minecraft"), Layout::Single);
            add("Prism Launcher", support.join("PrismLauncher/instances"), Layout::Instances);
            add("PolyMC", support.join("PolyMC/instances"), Layout::Instances);
            add("MultiMC", support.join("MultiMC/instances"), Layout::Instances);
            add("ATLauncher", support.join("ATLauncher/instances"), Layout::Instances);
            add("CurseForge app", home.join("Documents/curseforge/minecraft/Instances"), Layout::Instances);
            add("Modrinth app", support.join("ModrinthApp/profiles"), Layout::Instances);
            add("GDLauncher", support.join("gdlauncher_carbon/data/instances"), Layout::Instances);
        }
        Os::Linux => {
            let data = env("XDG_DATA_HOME").map(PathBuf::from).filter(|p| p.is_absolute()).unwrap_or_else(|| home.join(".local/share"));
            let flatpak = home.join(".var/app");
            add("Minecraft Launcher", home.join(".minecraft"), Layout::Single);
            add("Minecraft Launcher (Flatpak)", flatpak.join("com.mojang.Minecraft/.minecraft"), Layout::Single);
            add("Prism Launcher", data.join("PrismLauncher/instances"), Layout::Instances);
            add("Prism Launcher (Flatpak)", flatpak.join("org.prismlauncher.PrismLauncher/data/PrismLauncher/instances"), Layout::Instances);
            add("PolyMC", data.join("polymc/instances"), Layout::Instances);
            add("MultiMC", data.join("multimc/instances"), Layout::Instances);
            add("MultiMC", home.join(".multimc/instances"), Layout::Instances);
            add("ATLauncher", data.join("ATLauncher/instances"), Layout::Instances);
            add("ATLauncher", home.join("ATLauncher/instances"), Layout::Instances);
            add("CurseForge app", home.join("curseforge/minecraft/Instances"), Layout::Instances);
            add("CurseForge app", home.join("Documents/curseforge/minecraft/Instances"), Layout::Instances);
            add("Modrinth app", data.join("ModrinthApp/profiles"), Layout::Instances);
            add("Modrinth app (Flatpak)", flatpak.join("com.modrinth.ModrinthApp/data/ModrinthApp/profiles"), Layout::Instances);
            add("GDLauncher", data.join("gdlauncher_carbon/data/instances"), Layout::Instances);
        }
    }
    roots
}

fn read_json(path: &Path) -> Option<Value> {
    let meta = fs::metadata(path).ok()?;
    if meta.len() > 2 * 1024 * 1024 { return None; }
    serde_json::from_slice(&fs::read(path).ok()?).ok()
}

/// The folder of a Prism/MultiMC style instance that actually holds the game's files.
fn game_folder(instance: &Path) -> PathBuf {
    for name in [".minecraft", "minecraft"] {
        let candidate = instance.join(name);
        if candidate.is_dir() { return candidate; }
    }
    instance.to_path_buf()
}

/// Loader and game version for a `net.minecraft` / loader component list (Prism and MultiMC `mmc-pack.json`).
pub(crate) fn parse_mmc_pack(pack: &Value) -> (Option<String>, Option<String>) {
    let mut version = None;
    let mut loader = None;
    for component in pack.get("components").and_then(Value::as_array).into_iter().flatten() {
        let uid = component.get("uid").and_then(Value::as_str).unwrap_or_default();
        let ver = component.get("version").and_then(Value::as_str).map(str::to_string);
        match uid {
            "net.minecraft" => version = ver,
            "net.fabricmc.fabric-loader" => loader = Some("fabric".to_string()),
            "org.quiltmc.quilt-loader" => loader = Some("quilt".to_string()),
            "net.neoforged" => loader = Some("neoforge".to_string()),
            "net.minecraftforge" => loader = Some("forge".to_string()),
            _ => {}
        }
    }
    (loader, version)
}

/// `IntendedVersion=1.20.1` from an `instance.cfg` (older MultiMC without `mmc-pack.json`).
pub(crate) fn parse_instance_cfg(text: &str) -> Option<String> {
    text.lines().find_map(|line| line.strip_prefix("IntendedVersion=")).map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

/// Loader and Minecraft version from a launcher profile / version id such as `fabric-loader-0.15.7-1.20.1`,
/// `1.20.1-forge-47.2.0`, `neoforge-21.1.5` or `1.20.1`.
pub fn parse_version_id(id: &str) -> (Option<String>, Option<String>) {
    let id = id.trim();
    let is_mc = |s: &str| { let mut parts = s.split('.'); parts.next() == Some("1") && parts.next().is_some_and(|m| !m.is_empty() && m.chars().all(|c| c.is_ascii_digit())) && s.chars().all(|c| c.is_ascii_digit() || c == '.') };
    if let Some(rest) = id.strip_prefix("fabric-loader-") { return (Some("fabric".into()), rest.rsplit('-').next().filter(|v| is_mc(v)).map(str::to_string)); }
    if let Some(rest) = id.strip_prefix("quilt-loader-") { return (Some("quilt".into()), rest.rsplit('-').next().filter(|v| is_mc(v)).map(str::to_string)); }
    if let Some(rest) = id.strip_prefix("neoforge-") {
        // NeoForge 21.1.x targets Minecraft 1.21.1.
        let mut parts = rest.split('.');
        let version = match (parts.next().and_then(|m| m.parse::<u32>().ok()), parts.next().and_then(|m| m.parse::<u32>().ok())) {
            (Some(major), Some(minor)) => Some(if minor == 0 { format!("1.{major}") } else { format!("1.{major}.{minor}") }),
            _ => None,
        };
        return (Some("neoforge".into()), version);
    }
    if let Some((mc, _)) = id.split_once("-forge-") { return (Some("forge".into()), Some(mc.to_string()).filter(|v| is_mc(v))); }
    if let Some((mc, _)) = id.split_once("-neoforge-") { return (Some("neoforge".into()), Some(mc.to_string()).filter(|v| is_mc(v))); }
    if is_mc(id) { return (Some("vanilla".into()), Some(id.to_string())); }
    (None, None)
}

/// Loader and version of the profile the official launcher used last (`launcher_profiles.json`).
fn official_launcher_meta(root: &Path) -> (Option<String>, Option<String>) {
    let Some(json) = read_json(&root.join("launcher_profiles.json")) else { return (None, None) };
    let latest = json.get("profiles").and_then(Value::as_object).into_iter().flat_map(|profiles| profiles.values())
        .filter_map(|profile| Some((profile.get("lastUsed").and_then(Value::as_str).unwrap_or_default().to_string(), profile.get("lastVersionId").and_then(Value::as_str)?.to_string())))
        .filter(|(_, id)| !id.starts_with("latest-"))
        .max_by(|a, b| a.0.cmp(&b.0));
    latest.map(|(_, id)| parse_version_id(&id)).unwrap_or((None, None))
}

/// Everything an instance's own files say about its loader and game version.
pub fn minecraft_meta(instance: &Path, game_dir: &Path) -> (Option<String>, Option<String>) {
    if let Some(pack) = read_json(&instance.join("mmc-pack.json")) {
        let (loader, version) = parse_mmc_pack(&pack);
        if version.is_some() { return (loader.or(Some("vanilla".into())), version); }
    }
    if let Some(version) = fs::read_to_string(instance.join("instance.cfg")).ok().and_then(|text| parse_instance_cfg(&text)) { return (Some("vanilla".into()), Some(version)); }
    // CurseForge app instances.
    if let Some(json) = read_json(&instance.join("minecraftinstance.json")) {
        let version = json.get("gameVersion").and_then(Value::as_str).map(str::to_string);
        let loader = json.pointer("/baseModLoader/name").and_then(Value::as_str).map(|name| {
            let lower = name.to_ascii_lowercase();
            ["neoforge", "fabric", "quilt", "forge"].iter().find(|l| lower.starts_with(**l)).map(|l| l.to_string()).unwrap_or_else(|| "vanilla".into())
        }).or(Some("vanilla".into()));
        if version.is_some() { return (loader, version); }
    }
    let official = official_launcher_meta(game_dir);
    if official.1.is_some() { return official; }
    (None, None)
}

fn location(launcher: &str, instance: Option<&str>, game_dir: &Path, meta_dir: &Path) -> ModLocation {
    let mods = game_dir.join("mods");
    let (loader, game_version) = minecraft_meta(meta_dir, game_dir);
    let label = match instance { Some(name) => format!("{launcher}: {name}"), None => launcher.to_string() };
    ModLocation {
        id: mods.to_string_lossy().into_owned(), label, launcher: launcher.to_string(), instance: instance.map(str::to_string), exists: game_dir.is_dir(),
        mods_dir: mods.to_string_lossy().into_owned(), content_root: Some(game_dir.to_string_lossy().into_owned()), loader, game_version,
    }
}

/// All Minecraft game folders found under `roots`, best first (existing ones, in launcher order).
fn scan_minecraft(roots: &[Root]) -> Vec<ModLocation> {
    let mut found = Vec::new();
    for root in roots {
        match root.layout {
            Layout::Single => if root.path.is_dir() { found.push(location(root.launcher, None, &root.path, &root.path)); },
            Layout::Instances => {
                let Ok(read) = fs::read_dir(&root.path) else { continue };
                let mut dirs: Vec<PathBuf> = read.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect();
                dirs.sort();
                for dir in dirs {
                    let name = dir.file_name().and_then(|n| n.to_str()).unwrap_or_default().to_string();
                    // Prism keeps helper folders next to the instances.
                    if name.starts_with('.') || name.starts_with('_') || name == "instgroups.json" { continue; }
                    if found.len() >= MAX_INSTANCES { return found; }
                    found.push(location(root.launcher, Some(&name), &game_folder(&dir), &dir));
                }
            }
        }
    }
    found
}

// ---------------------------------------------------------------------------
// Other games
// ---------------------------------------------------------------------------

/// A game in the table: matched by normalised name prefix. `rel` paths are inside the install folder, `user` ones
/// are relative to the home folder (Linux / macOS variants).
struct GameRule { names: &'static [&'static str], rel: &'static [&'static str], linux_user: &'static [&'static str], mac_user: &'static [&'static str], label: &'static str }

const GAME_RULES: &[GameRule] = &[
    GameRule { names: &["terraria", "tmodloader"], rel: &[], linux_user: &[".local/share/Terraria/ModLoader/Mods", ".local/share/tModLoader/Mods"], mac_user: &["Library/Application Support/Terraria/ModLoader/Mods"], label: "tModLoader" },
    GameRule { names: &["stardew valley"], rel: &["Mods"], linux_user: &[], mac_user: &[], label: "SMAPI" },
    GameRule { names: &["valheim", "subnautica", "lethal company", "risk of rain 2", "content warning", "among us", "hollow knight", "ultrakill", "core keeper", "against the storm", "bepinex"], rel: &["BepInEx/plugins"], linux_user: &[], mac_user: &[], label: "BepInEx" },
    GameRule { names: &["skyrim", "fallout", "oblivion", "morrowind", "starfield", "enderal"], rel: &["Data"], linux_user: &[], mac_user: &[], label: "Data folder" },
    GameRule { names: &["rimworld"], rel: &["Mods"], linux_user: &[], mac_user: &[], label: "Mods" },
    GameRule { names: &["factorio"], rel: &["mods"], linux_user: &[".factorio/mods"], mac_user: &["Library/Application Support/factorio/mods"], label: "Factorio mods" },
    GameRule { names: &["project zomboid"], rel: &["mods"], linux_user: &["Zomboid/mods"], mac_user: &["Zomboid/mods"], label: "Zomboid mods" },
    GameRule { names: &["don't starve together", "dont starve together", "starbound"], rel: &["mods"], linux_user: &[], mac_user: &[], label: "mods" },
    GameRule { names: &["kerbal space program"], rel: &["GameData"], linux_user: &[], mac_user: &[], label: "GameData" },
    GameRule { names: &["garry's mod", "garrys mod"], rel: &["garrysmod/addons"], linux_user: &[], mac_user: &[], label: "addons" },
    GameRule { names: &["satisfactory"], rel: &["FactoryGame/Mods"], linux_user: &[], mac_user: &[], label: "Mods" },
    GameRule { names: &["cities: skylines", "cities skylines"], rel: &["Files/Mods"], linux_user: &[".local/share/Colossal Order/Cities_Skylines/Addons/Mods"], mac_user: &["Library/Application Support/Colossal Order/Cities_Skylines/Addons/Mods"], label: "Mods" },
];

/// Folder names worth trying for any game that is not in the table, in order.
const GENERIC_REL: &[&str] = &["BepInEx/plugins", "Mods", "mods", "Plugins", "plugins", "Data", "addons", "Addons"];

fn normalise(name: &str) -> String {
    name.to_lowercase().replace(['\u{2019}', '\u{2018}'], "'").chars().map(|c| if c.is_alphanumeric() || c == '\'' || c == ':' { c } else { ' ' }).collect::<String>().split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Where Steam keeps `steamapps/common` on this OS (native and Flatpak).
fn steam_common_dirs(os: Os, home: &Path) -> Vec<PathBuf> {
    match os {
        Os::MacOs => vec![home.join("Library/Application Support/Steam/steamapps/common")],
        Os::Linux => vec![home.join(".local/share/Steam/steamapps/common"), home.join(".steam/steam/steamapps/common"), home.join(".var/app/com.valvesoftware.Steam/.local/share/Steam/steamapps/common")],
    }
}

fn game_location(label: &str, launcher: &str, dir: PathBuf) -> ModLocation {
    ModLocation { id: dir.to_string_lossy().into_owned(), label: label.to_string(), launcher: launcher.to_string(), instance: None, exists: dir.is_dir(), mods_dir: dir.to_string_lossy().into_owned(), content_root: None, loader: None, game_version: None }
}

fn game_candidates(os: Os, home: &Path, game_name: &str, install_paths: &[PathBuf]) -> Vec<ModLocation> {
    let key = normalise(game_name);
    let mut installs: Vec<PathBuf> = install_paths.iter().filter(|p| p.is_dir()).cloned().collect();
    if installs.is_empty() {
        // The game may be a Steam title the library knows only by name.
        let wanted = key.clone();
        for common in steam_common_dirs(os, home) {
            let Ok(read) = fs::read_dir(&common) else { continue };
            for entry in read.flatten() {
                if normalise(&entry.file_name().to_string_lossy()) == wanted { installs.push(entry.path()); }
            }
        }
    }
    let mut out: Vec<ModLocation> = Vec::new();
    let rule = GAME_RULES.iter().find(|rule| rule.names.iter().any(|name| key == *name || key.starts_with(&format!("{name} "))));
    if let Some(rule) = rule {
        for install in &installs { for rel in rule.rel { out.push(game_location(&format!("{}: {}", rule.label, rel), "Game folder", install.join(rel))); } }
        let user = if os == Os::MacOs { rule.mac_user } else { rule.linux_user };
        for rel in user { out.push(game_location(&format!("{}: ~/{}", rule.label, rel), "User data", home.join(rel))); }
    }
    for install in &installs {
        for rel in GENERIC_REL {
            let dir = install.join(rel);
            // The generic guesses only count when the folder is really there; the table above may offer one that is not yet.
            if dir.is_dir() && !out.iter().any(|existing| existing.mods_dir == dir.to_string_lossy()) { out.push(game_location(&format!("{rel} folder"), "Game folder", dir)); }
        }
    }
    // Existing folders first, keeping the table order inside each group.
    out.sort_by_key(|location| !location.exists);
    out
}

pub fn detect(os: Os, home: &Path, env: &dyn Fn(&str) -> Option<std::ffi::OsString>, game_name: &str, install_paths: &[PathBuf], minecraft: bool) -> Vec<ModLocation> {
    let mut found = if minecraft { scan_minecraft(&minecraft_roots(os, home, env)) } else { game_candidates(os, home, game_name, install_paths) };
    found.sort_by_key(|location| !location.exists);
    found.dedup_by(|a, b| a.mods_dir == b.mods_dir);
    found
}

#[tauri::command(async)]
pub fn detect_mod_locations(game_name: String, install_path: Option<String>, executable_path: Option<String>, minecraft: bool) -> Vec<ModLocation> {
    let Some(home) = crate::platform::home_dir() else { return Vec::new() };
    let mut installs: Vec<PathBuf> = Vec::new();
    for path in [install_path, executable_path].into_iter().flatten() {
        let path = PathBuf::from(path.trim());
        if !path.is_absolute() { continue; }
        // An executable's folder is the install folder.
        let dir = if path.is_file() { path.parent().map(Path::to_path_buf).unwrap_or(path) } else { path };
        if !installs.contains(&dir) { installs.push(dir); }
    }
    detect(crate::platform::CURRENT_OS, &home, &|name| std::env::var_os(name), &game_name, &installs, minecraft)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mochi-locs-{name}-{}-{}", std::process::id(), crate::util::now_ms()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn no_env(_: &str) -> Option<std::ffi::OsString> { None }

    #[test]
    fn version_ids_name_loader_and_version() {
        assert_eq!(parse_version_id("fabric-loader-0.15.7-1.20.1"), (Some("fabric".into()), Some("1.20.1".into())));
        assert_eq!(parse_version_id("quilt-loader-0.26.0-1.21"), (Some("quilt".into()), Some("1.21".into())));
        assert_eq!(parse_version_id("1.20.1-forge-47.2.0"), (Some("forge".into()), Some("1.20.1".into())));
        assert_eq!(parse_version_id("neoforge-21.1.5"), (Some("neoforge".into()), Some("1.21.1".into())));
        assert_eq!(parse_version_id("neoforge-21.0.4"), (Some("neoforge".into()), Some("1.21".into())));
        assert_eq!(parse_version_id("1.19.4"), (Some("vanilla".into()), Some("1.19.4".into())));
        assert_eq!(parse_version_id("latest-release"), (None, None));
    }

    #[test]
    fn prism_instances_are_found_with_loader_and_version() {
        let home = temp("prism");
        let instance = home.join(".local/share/PrismLauncher/instances/Fabric Pack");
        fs::create_dir_all(instance.join(".minecraft/mods")).unwrap();
        fs::write(instance.join("mmc-pack.json"), r#"{"components":[{"uid":"net.minecraft","version":"1.20.1"},{"uid":"net.fabricmc.fabric-loader","version":"0.15.7"}]}"#).unwrap();
        fs::create_dir_all(home.join(".local/share/PrismLauncher/instances/.tmp")).unwrap();
        let found = detect(Os::Linux, &home, &no_env, "Minecraft", &[], true);
        assert_eq!(found.len(), 1);
        let location = &found[0];
        assert!(location.mods_dir.ends_with("Fabric Pack/.minecraft/mods"));
        assert_eq!((location.loader.as_deref(), location.game_version.as_deref()), (Some("fabric"), Some("1.20.1")));
        assert_eq!(location.launcher, "Prism Launcher");
        assert!(location.exists);
        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn official_launcher_and_curseforge_app_are_read() {
        let home = temp("official");
        fs::create_dir_all(home.join(".minecraft")).unwrap();
        fs::write(home.join(".minecraft/launcher_profiles.json"), r#"{"profiles":{"a":{"lastUsed":"2024-01-01T00:00:00Z","lastVersionId":"1.19.4"},"b":{"lastUsed":"2025-01-01T00:00:00Z","lastVersionId":"fabric-loader-0.16.0-1.21.1"},"c":{"lastUsed":"2026-01-01T00:00:00Z","lastVersionId":"latest-release"}}}"#).unwrap();
        let cf = home.join("curseforge/minecraft/Instances/Pack");
        fs::create_dir_all(cf.join("mods")).unwrap();
        fs::write(cf.join("minecraftinstance.json"), r#"{"gameVersion":"1.20.1","baseModLoader":{"name":"forge-47.2.0"}}"#).unwrap();
        let found = detect(Os::Linux, &home, &no_env, "Minecraft", &[], true);
        let official = found.iter().find(|l| l.launcher == "Minecraft Launcher").unwrap();
        assert_eq!((official.loader.as_deref(), official.game_version.as_deref()), (Some("fabric"), Some("1.21.1")));
        let curse = found.iter().find(|l| l.launcher == "CurseForge app").unwrap();
        assert_eq!((curse.loader.as_deref(), curse.game_version.as_deref()), (Some("forge"), Some("1.20.1")));
        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn macos_roots_use_application_support() {
        let roots = minecraft_roots(Os::MacOs, Path::new("/Users/a"), &no_env);
        assert!(roots.iter().any(|r| r.path == Path::new("/Users/a/Library/Application Support/minecraft")));
        assert!(roots.iter().any(|r| r.path == Path::new("/Users/a/Library/Application Support/PrismLauncher/instances")));
        assert!(roots.iter().all(|r| r.path.starts_with("/Users/a")));
    }

    #[test]
    fn flatpak_prism_and_xdg_data_home_are_honoured() {
        let env = |name: &str| (name == "XDG_DATA_HOME").then(|| std::ffi::OsString::from("/data"));
        let roots = minecraft_roots(Os::Linux, Path::new("/home/a"), &env);
        assert!(roots.iter().any(|r| r.path == Path::new("/data/PrismLauncher/instances")));
        assert!(roots.iter().any(|r| r.path == Path::new("/home/a/.var/app/org.prismlauncher.PrismLauncher/data/PrismLauncher/instances")));
        assert!(roots.iter().any(|r| r.path == Path::new("/home/a/.var/app/com.modrinth.ModrinthApp/data/ModrinthApp/profiles")));
    }

    #[test]
    fn other_games_use_the_table_and_generic_folders() {
        let home = temp("games");
        let valheim = home.join("games/Valheim");
        fs::create_dir_all(valheim.join("BepInEx/plugins")).unwrap();
        let found = detect(Os::Linux, &home, &no_env, "Valheim", std::slice::from_ref(&valheim), false);
        assert!(found[0].exists && found[0].mods_dir.ends_with("BepInEx/plugins"));
        // Unknown game: only folders that exist are offered.
        let unknown = home.join("games/Unknown");
        fs::create_dir_all(unknown.join("Mods")).unwrap();
        let found = detect(Os::Linux, &home, &no_env, "Some Indie Game", &[unknown], false);
        assert_eq!(found.len(), 1);
        assert!(found[0].mods_dir.ends_with("Unknown/Mods"));
        // Terraria offers the tModLoader folder even before it exists.
        let terraria = detect(Os::Linux, &home, &no_env, "Terraria", &[], false);
        assert!(terraria.iter().any(|l| l.mods_dir.ends_with(".local/share/Terraria/ModLoader/Mods") && !l.exists));
        let mac = detect(Os::MacOs, &home, &no_env, "Terraria", &[], false);
        assert!(mac.iter().any(|l| l.mods_dir.contains("Library/Application Support/Terraria/ModLoader/Mods")));
        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn steam_games_are_found_by_name() {
        let home = temp("steam");
        fs::create_dir_all(home.join(".local/share/Steam/steamapps/common/Stardew Valley/Mods")).unwrap();
        let found = detect(Os::Linux, &home, &no_env, "Stardew Valley", &[], false);
        assert!(found.iter().any(|l| l.exists && l.mods_dir.ends_with("Stardew Valley/Mods")));
        let _ = fs::remove_dir_all(&home);
    }
}
