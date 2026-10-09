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
    /// The modpack the launcher itself recorded (`ManagedPack*` keys in `instance.cfg`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pack: Option<ManagedPack>,
    /// Name and version from a pack manifest left in the instance (`modrinth.index.json`, CurseForge `manifest.json`); a hint, not an id.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub index: Option<PackIndex>,
}

/// A modpack project the launcher installed this instance from.
#[derive(Clone, Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ManagedPack {
    /// `modrinth` or `curseforge`.
    pub source: String,
    pub project_id: String,
    pub version_id: Option<String>,
    pub name: Option<String>,
    pub version_name: Option<String>,
}

#[derive(Clone, Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PackIndex {
    pub source: String,
    pub name: String,
    pub version: Option<String>,
}

/// `ManagedPack*` keys that Prism writes for packs installed from Modrinth or CurseForge (`flame`). Ids must look like ids.
pub(super) fn managed_pack(config: &str) -> Option<ManagedPack> {
    if ini_value(config, "ManagedPack")? != "true" { return None; }
    let source = match ini_value(config, "ManagedPackType")?.as_str() { "modrinth" => "modrinth", "flame" => "curseforge", _ => return None };
    let project_id = ini_value(config, "ManagedPackID")?;
    let valid = if source == "curseforge" { project_id.chars().all(|c| c.is_ascii_digit()) } else { crate::util::valid_id(&project_id, 40) };
    if !valid || project_id.len() > 40 { return None; }
    let version_id = ini_value(config, "ManagedPackVersionID").filter(|id| id.len() <= 40 && id.chars().all(|c| c.is_ascii_alphanumeric()));
    Some(ManagedPack { source: source.into(), project_id, version_id, name: ini_value(config, "ManagedPackName"), version_name: ini_value(config, "ManagedPackVersionName") })
}

/// Pack name and version from `modrinth.index.json` or a CurseForge `manifest.json` in the instance or its game folder.
pub(super) fn pack_index(instance: &Path, game_dir: &Path) -> Option<PackIndex> {
    for dir in [instance, game_dir] {
        if let Some(value) = read(&dir.join("modrinth.index.json")).and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok()) {
            let name = value.get("name").and_then(|n| n.as_str()).map(str::trim).filter(|n| !n.is_empty());
            if let Some(name) = name {
                let version = value.get("versionId").and_then(|v| v.as_str()).map(str::to_owned).filter(|v| !v.is_empty());
                return Some(PackIndex { source: "modrinth".into(), name: name.into(), version });
            }
        }
        if let Some(value) = read(&dir.join("manifest.json")).and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok()) {
            let name = value.get("name").and_then(|n| n.as_str()).map(str::trim).filter(|n| !n.is_empty());
            if let (Some("minecraftModpack"), Some(name)) = (value.get("manifestType").and_then(|t| t.as_str()), name) {
                let version = value.get("version").and_then(|v| v.as_str()).map(str::to_owned).filter(|v| !v.is_empty());
                return Some(PackIndex { source: "curseforge".into(), name: name.into(), version });
            }
        }
    }
    None
}

/// `key=value` lines of an INI-style file (sections ignored; the first occurrence wins).
pub(super) fn ini_value(text: &str, key: &str) -> Option<String> {
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
pub(super) fn instances_dir(root: &Path, launcher: &InstanceLauncher) -> PathBuf {
    let configured = read(&root.join(launcher.config)).and_then(|text| ini_value(&text, "InstanceDir"));
    match configured.map(PathBuf::from) {
        Some(path) if path.is_absolute() => path,
        Some(path) if !path.components().any(|part| matches!(part, std::path::Component::ParentDir)) => root.join(path),
        _ => root.join("instances"),
    }
}

/// One instance folder, or `None` when it is not an instance (no `instance.cfg`).
pub(super) fn read_instance(root: &Path, dir: &Path, launcher: &InstanceLauncher) -> Option<ImportedGame> {
    let id = dir.file_name()?.to_str()?.to_owned();
    if id.starts_with('.') || id.starts_with('_') { return None; }
    let config = read(&dir.join("instance.cfg"))?;
    let name = ini_value(&config, "name").unwrap_or_else(|| id.clone());
    let game_dir = [".minecraft", "minecraft"].iter().map(|sub| dir.join(sub)).find(|path| path.is_dir()).unwrap_or_else(|| dir.join(".minecraft"));
    let (version, loader) = read(&dir.join("mmc-pack.json")).map(|text| pack_info(&text)).unwrap_or((None, "vanilla".into()));
    let mut item = make(format!("{}:{}", launcher.id, id), name, "prism", instance_target(launcher.id, &id), dir.to_str().map(str::to_owned));
    item.minecraft = Some(MinecraftInstance { version, loader, game_dir: game_dir.to_string_lossy().into_owned(), pack: managed_pack(&config), index: pack_index(dir, &game_dir) });
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
    fn managed_pack_keys_and_manifests_are_read() {
        let root = temp_dir("prism-pack");
        let prism = launcher("prism").unwrap();
        write(&root.join("instances/Mr/instance.cfg"), "name=Fabulously Optimized\nManagedPack=true\nManagedPackID=1KVo5zza\nManagedPackName=Fabulously Optimized\nManagedPackType=modrinth\nManagedPackVersionID=abcDEF12\nManagedPackVersionName=5.0.0\n");
        write(&root.join("instances/Cf/instance.cfg"), "name=ATM9\nManagedPack=true\nManagedPackType=flame\nManagedPackID=715572\nManagedPackVersionID=5000001\n");
        write(&root.join("instances/Bad/instance.cfg"), "name=Bad\nManagedPack=true\nManagedPackType=flame\nManagedPackID=../x\n");
        write(&root.join("instances/Off/instance.cfg"), "name=Off\nManagedPack=false\nManagedPackType=modrinth\nManagedPackID=abc\n");
        write(&root.join("instances/Idx/instance.cfg"), "name=Idx\n");
        write(&root.join("instances/Idx/minecraft/modrinth.index.json"), r#"{"name":"Better MC [FABRIC] BMC4","versionId":"v34","files":[]}"#);
        let games = scan_instances(&[(root.clone(), prism)]);
        let by = |name: &str| games.iter().find(|game| game.name == name).unwrap().minecraft.clone().unwrap();
        let mr = by("Fabulously Optimized").pack.unwrap();
        assert_eq!((mr.source.as_str(), mr.project_id.as_str(), mr.version_id.as_deref(), mr.version_name.as_deref()), ("modrinth", "1KVo5zza", Some("abcDEF12"), Some("5.0.0")));
        let cf = by("ATM9").pack.unwrap();
        assert_eq!((cf.source.as_str(), cf.project_id.as_str(), cf.name), ("curseforge", "715572", None));
        assert!(by("Bad").pack.is_none() && by("Off").pack.is_none());
        let idx = by("Idx").index.unwrap();
        assert_eq!((idx.source.as_str(), idx.name.as_str(), idx.version.as_deref()), ("modrinth", "Better MC [FABRIC] BMC4", Some("v34")));
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
