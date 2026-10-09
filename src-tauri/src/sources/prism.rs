//! Minecraft instances of Prism Launcher and the launchers it grew from (MultiMC, PolyMC, Fjord).
//! Each instance becomes a game whose default Tofu is that instance's `.minecraft` folder; launching
//! hands the instance id back to its launcher (`--launch <id>`).

use super::{encode, make, percent_decode, read, real_dir, sort_games, ImportedGame};
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
};

/// A MultiMC-family launcher: id used in launch targets, config file name and data-folder names.
pub struct InstanceLauncher {
    pub id: &'static str,
    pub name: &'static str,
    pub config: &'static str,
    /// Data folder name on Linux (`~/.local/share/<dir>`) and macOS (`~/Library/Application Support/<dir>`).
    pub dir: &'static str,
    pub flatpak: Option<&'static str>,
    /// Commands on Linux, in the order they are tried.
    pub commands: &'static [&'static str],
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    pub bundle: &'static str,
}

pub const INSTANCE_LAUNCHERS: [InstanceLauncher; 4] = [
    InstanceLauncher { id: "prism", name: "Prism Launcher", config: "prismlauncher.cfg", dir: "PrismLauncher", flatpak: Some("org.prismlauncher.PrismLauncher"), commands: &["prismlauncher"], bundle: "org.prismlauncher.PrismLauncher" },
    InstanceLauncher { id: "fjord", name: "Fjord Launcher", config: "fjordlauncher.cfg", dir: "FjordLauncher", flatpak: Some("io.github.unmojang.FjordLauncher"), commands: &["fjordlauncher"], bundle: "io.github.unmojang.FjordLauncher" },
    InstanceLauncher { id: "polymc", name: "PolyMC", config: "polymc.cfg", dir: "PolyMC", flatpak: Some("org.polymc.PolyMC"), commands: &["polymc"], bundle: "org.polymc.PolyMC" },
    InstanceLauncher { id: "multimc", name: "MultiMC", config: "multimc.cfg", dir: "multimc", flatpak: None, commands: &["multimc", "MultiMC"], bundle: "org.multimc.MultiMC" },
];

pub fn launcher(id: &str) -> Option<&'static InstanceLauncher> { INSTANCE_LAUNCHERS.iter().find(|launcher| launcher.id == id) }

const TARGET_SCHEME: &str = "mc-instance://";

/// `mc-instance://<launcher>/<percent-encoded instance id>`.
pub fn instance_target(launcher: &str, instance: &str) -> String { format!("{TARGET_SCHEME}{launcher}/{}", encode(instance)) }

/// The launcher and instance id of an instance launch target. The id is a folder name: never a path.
pub fn parse_instance_target(target: &str) -> Option<(&'static InstanceLauncher, String)> {
    let (launcher_id, encoded) = target.strip_prefix(TARGET_SCHEME)?.split_once('/')?;
    let id = percent_decode(encoded)?;
    let valid = !id.is_empty() && id.len() <= 255 && id != "." && id != ".." && !id.contains(['/', '\\', '\0']) && !id.starts_with('-');
    valid.then_some(())?;
    Some((launcher(launcher_id)?, id))
}

#[derive(Clone, Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MinecraftInstance {
    /// Minecraft version (`net.minecraft` component).
    pub version: Option<String>,
    /// `fabric`, `quilt`, `forge`, `neoforge` or `vanilla`.
    pub loader: String,
    /// The instance's game folder (holds `mods`, `resourcepacks`, `shaderpacks`).
    pub game_dir: String,
}

/// `key=value` lines of an INI-style file (sections ignored; the first occurrence wins).
fn ini_value(text: &str, key: &str) -> Option<String> {
    text.lines().find_map(|line| {
        let (name, value) = line.split_once('=')?;
        (name.trim() == key).then(|| value.trim().to_owned())
    }).filter(|value| !value.is_empty())
}

/// Version and loader from `mmc-pack.json` components.
fn pack_info(text: &str) -> (Option<String>, String) {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(text) else { return (None, "vanilla".into()) };
    let components = value.get("components").and_then(|c| c.as_array()).cloned().unwrap_or_default();
    let uid = |c: &serde_json::Value| c.get("uid").and_then(|u| u.as_str()).unwrap_or_default().to_owned();
    let version = components.iter().find(|c| uid(c) == "net.minecraft").and_then(|c| c.get("version").and_then(|v| v.as_str())).map(str::to_owned);
    let loader = components.iter().find_map(|c| match uid(c).as_str() {
        "net.fabricmc.fabric-loader" => Some("fabric"),
        "org.quiltmc.quilt-loader" => Some("quilt"),
        "net.neoforged" | "net.neoforged.neoforge" => Some("neoforge"),
        "net.minecraftforge" => Some("forge"),
        _ => None,
    }).unwrap_or("vanilla");
    (version, loader.into())
}

/// The instances folder: `InstanceDir` from the launcher's config (absolute or relative to its data folder).
fn instances_dir(root: &Path, launcher: &InstanceLauncher) -> PathBuf {
    let configured = read(&root.join(launcher.config)).and_then(|text| ini_value(&text, "InstanceDir"));
    match configured.map(PathBuf::from) {
        Some(path) if path.is_absolute() => path,
        Some(path) if !path.components().any(|part| matches!(part, std::path::Component::ParentDir)) => root.join(path),
        _ => root.join("instances"),
    }
}

/// One instance folder, or `None` when it is not an instance (no `instance.cfg`).
fn read_instance(root: &Path, dir: &Path, launcher: &InstanceLauncher) -> Option<ImportedGame> {
    let id = dir.file_name()?.to_str()?.to_owned();
    if id.starts_with('.') || id.starts_with('_') { return None; }
    let config = read(&dir.join("instance.cfg"))?;
    let name = ini_value(&config, "name").unwrap_or_else(|| id.clone());
    let game_dir = [".minecraft", "minecraft"].iter().map(|sub| dir.join(sub)).find(|path| path.is_dir()).unwrap_or_else(|| dir.join(".minecraft"));
    let (version, loader) = read(&dir.join("mmc-pack.json")).map(|text| pack_info(&text)).unwrap_or((None, "vanilla".into()));
    let mut item = make(format!("{}:{}", launcher.id, id), name, launcher.id, instance_target(launcher.id, &id), dir.to_str().map(str::to_owned));
    item.minecraft = Some(MinecraftInstance { version, loader, game_dir: game_dir.to_string_lossy().into_owned() });
    // Custom instance icons live in `<data>/icons/<iconKey>.png`; the built-in ones are not files.
    item.icon_path = ini_value(&config, "iconKey").filter(|key| crate::util::valid_id(key, 120))
        .and_then(|key| ["png", "svg", "jpg"].iter().map(|ext| root.join("icons").join(format!("{key}.{ext}"))).find(|path| super::icons::usable_icon(path)))
        .and_then(|path| path.to_str().map(str::to_owned));
    Some(item)
}

/// Every instance under the given launcher data folders.
pub fn scan_instances(roots: &[(PathBuf, &'static InstanceLauncher)]) -> Vec<ImportedGame> {
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for (root, launcher) in roots {
        let Ok(entries) = fs::read_dir(instances_dir(root, launcher)) else { continue };
        for entry in entries.flatten().filter(real_dir).take(500) {
            if let Some(item) = read_instance(root, &entry.path(), launcher) {
                if seen.insert(item.id.clone()) { out.push(item); }
            }
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
    fn instances_are_read_with_version_loader_and_icon() {
        let root = temp_dir("prism");
        let prism = launcher("prism").unwrap();
        write(&root.join("instances/Fabric 1.21/instance.cfg"), "[General]\nInstanceType=OneSix\nname=Fabric Fun\niconKey=custom_cat\n");
        write(&root.join("instances/Fabric 1.21/mmc-pack.json"), r#"{"components":[{"uid":"net.minecraft","version":"1.21.1"},{"uid":"net.fabricmc.fabric-loader","version":"0.16.5"}],"formatVersion":1}"#);
        fs::create_dir_all(root.join("instances/Fabric 1.21/minecraft/mods")).unwrap();
        write(&root.join("icons/custom_cat.png"), "png");
        write(&root.join("instances/Vanilla/instance.cfg"), "name=\n");
        write(&root.join("instances/NeoPack/instance.cfg"), "name=Neo\n");
        write(&root.join("instances/NeoPack/mmc-pack.json"), r#"{"components":[{"uid":"net.neoforged","version":"21.1"},{"uid":"net.minecraft","version":"1.21.1"}]}"#);
        write(&root.join("instances/.LAUNCHER_TEMP/instance.cfg"), "name=Temp\n");
        fs::create_dir_all(root.join("instances/not-an-instance")).unwrap();
        write(&root.join("instances/instgroups.json"), "{}");

        let games = scan_instances(&[(root.clone(), prism)]);
        let names: Vec<_> = games.iter().map(|game| game.name.as_str()).collect();
        assert_eq!(names, ["Fabric Fun", "Neo", "Vanilla"]);
        let fabric = &games[0];
        assert_eq!(fabric.launch_target, "mc-instance://prism/Fabric%201.21");
        assert_eq!(fabric.source, "prism");
        let info = fabric.minecraft.as_ref().unwrap();
        assert_eq!((info.version.as_deref(), info.loader.as_str()), (Some("1.21.1"), "fabric"));
        assert!(info.game_dir.ends_with("Fabric 1.21/minecraft"));
        assert!(fabric.icon_path.as_deref().unwrap().ends_with("icons/custom_cat.png"));
        assert_eq!(games[1].minecraft.as_ref().unwrap().loader, "neoforge");
        assert!(games[2].minecraft.as_ref().unwrap().game_dir.ends_with("Vanilla/.minecraft"));
        assert_eq!(games[2].minecraft.as_ref().unwrap().loader, "vanilla");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn custom_instance_folders_are_followed() {
        let root = temp_dir("prism-cfg");
        let elsewhere = temp_dir("prism-elsewhere");
        let prism = launcher("prism").unwrap();
        write(&root.join("prismlauncher.cfg"), &format!("[General]\nInstanceDir={}\n", elsewhere.display()));
        write(&elsewhere.join("A/instance.cfg"), "name=Moved\n");
        assert_eq!(scan_instances(&[(root.clone(), prism)])[0].name, "Moved");
        write(&root.join("prismlauncher.cfg"), "InstanceDir=../../etc\n");
        assert_eq!(instances_dir(&root, prism), root.join("instances"));
        write(&root.join("prismlauncher.cfg"), "InstanceDir=my-instances\n");
        assert_eq!(instances_dir(&root, prism), root.join("my-instances"));
        for dir in [root, elsewhere] { let _ = fs::remove_dir_all(dir); }
    }

    #[test]
    fn launch_targets_round_trip_and_reject_paths() {
        let target = instance_target("polymc", "My Pack (1.20)");
        let (launcher, id) = parse_instance_target(&target).unwrap();
        assert_eq!((launcher.id, id.as_str()), ("polymc", "My Pack (1.20)"));
        for bad in ["mc-instance://prism/..", "mc-instance://prism/a%2Fb", "mc-instance://prism/", "mc-instance://evil/x", "mc-instance://prism/--help", "steam://x", "mc-instance://prism/%zz"] {
            assert!(parse_instance_target(bad).is_none(), "{bad}");
        }
    }
}
