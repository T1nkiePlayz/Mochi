//! Manager for a game's private Wine/Proton prefix (the folder Mochi creates at first launch): what is in it, a
//! reset that keeps the old copy, and the few maintenance tools people reach for (winecfg, wineboot, regedit and a
//! short allow-list of winetricks components). Everything is an argv, never a shell, and the prefix is always the one
//! Mochi itself created under `<app data>/prefixes`, so a bad request cannot touch any other folder.
use crate::platform::{self, RuntimeInfo};
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::atomic::{AtomicBool, Ordering},
};
use tauri::Emitter;

/// winetricks components Mochi will install: the ones games most often ask for. Anything else is refused.
pub const VERBS: &[(&str, &str)] = &[
    ("vcrun2022", "Visual C++ 2015-2022 runtime"),
    ("vcrun2019", "Visual C++ 2015-2019 runtime"),
    ("vcrun2013", "Visual C++ 2013 runtime"),
    ("vcrun2010", "Visual C++ 2010 runtime"),
    ("dotnet48", ".NET Framework 4.8"),
    ("dotnet40", ".NET Framework 4.0"),
    ("d3dx9", "DirectX 9 (d3dx9)"),
    ("d3dx11_43", "DirectX 11 (d3dx11)"),
    ("d3dcompiler_47", "D3D shader compiler"),
    ("xact", "XAudio / XACT"),
    ("physx", "NVIDIA PhysX"),
    ("corefonts", "Microsoft core fonts"),
    ("msxml6", "MSXML 6"),
    ("gdiplus", "GDI+"),
];

/// Only one long maintenance job at a time (winetricks keeps its own lock files and fails when run twice).
static BUSY: AtomicBool = AtomicBool::new(false);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Verb { id: &'static str, label: &'static str }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrefixInfo {
    pub path: String,
    pub exists: bool,
    /// "none" (not created yet), "wine", "proton" or "unknown".
    pub kind: &'static str,
    pub has_backup: bool,
    /// Prefix tools exist on Linux only; macOS wrappers (CrossOver, Whisky) manage their own bottles.
    pub supported: bool,
    pub has_winetricks: bool,
    pub busy: bool,
    pub verbs: Vec<Verb>,
}

pub fn detect_kind(prefix: &Path) -> &'static str {
    if !prefix.is_dir() { return "none"; }
    if prefix.join("pfx").is_dir() || prefix.join("pfx.lock").exists() || prefix.join("config_info").exists() { return "proton"; }
    if prefix.join("system.reg").is_file() { return "wine"; }
    "unknown"
}

fn backup_path(prefix: &Path) -> PathBuf {
    let name = prefix.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
    prefix.with_file_name(format!("{name}.old"))
}

/// Refuses any path that is not a direct child of a folder called `prefixes` (the one Mochi creates).
fn checked(prefix: &Path) -> Result<(), String> {
    let ok = prefix.is_absolute() && prefix.parent().and_then(Path::file_name).is_some_and(|name| name == "prefixes") && prefix.file_name().is_some();
    if ok { Ok(()) } else { Err("That is not one of Mochi's game prefixes.".into()) }
}

pub fn info(prefix: &Path) -> PrefixInfo {
    let supported = cfg!(target_os = "linux");
    PrefixInfo {
        path: prefix.to_string_lossy().into_owned(),
        exists: prefix.is_dir(),
        kind: detect_kind(prefix),
        has_backup: backup_path(prefix).is_dir(),
        supported,
        has_winetricks: supported && platform::command_exists("winetricks"),
        busy: BUSY.load(Ordering::SeqCst),
        verbs: VERBS.iter().map(|(id, label)| Verb { id, label }).collect(),
    }
}

/// Moves the prefix aside as `<name>.old` (replacing an older copy). Nothing is deleted from the game itself.
pub fn reset(prefix: &Path) -> Result<(), String> {
    checked(prefix)?;
    if !prefix.is_dir() { return Err("This game has no prefix yet.".into()); }
    let backup = backup_path(prefix);
    if backup.exists() { fs::remove_dir_all(&backup).map_err(|error| format!("Could not replace the old copy: {error}"))?; }
    fs::rename(prefix, &backup).map_err(|error| format!("Could not reset the prefix: {error}"))
}

/// Deletes the `<name>.old` copy a reset left behind.
pub fn delete_backup(prefix: &Path) -> Result<(), String> {
    checked(prefix)?;
    let backup = backup_path(prefix);
    if !backup.is_dir() { return Err("There is no old copy to delete.".into()); }
    fs::remove_dir_all(&backup).map_err(|error| format!("Could not delete the old copy: {error}"))
}

/// Puts the `<name>.old` copy back, keeping the current prefix as the new `.old` copy.
pub fn restore_backup(prefix: &Path) -> Result<(), String> {
    checked(prefix)?;
    let backup = backup_path(prefix);
    if !backup.is_dir() { return Err("There is no old copy to restore.".into()); }
    let parked = prefix.with_file_name(format!("{}.swap", prefix.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()));
    if parked.exists() { fs::remove_dir_all(&parked).map_err(|error| error.to_string())?; }
    let had_current = prefix.is_dir();
    if had_current { fs::rename(prefix, &parked).map_err(|error| format!("Could not set the current prefix aside: {error}"))?; }
    if let Err(error) = fs::rename(&backup, prefix) {
        if had_current { let _ = fs::rename(&parked, prefix); }
        return Err(format!("Could not restore the old copy: {error}"));
    }
    if had_current { fs::rename(&parked, &backup).map_err(|error| format!("Restored, but could not keep the replaced prefix: {error}"))?; }
    Ok(())
}

/// What to run for one tool.
#[derive(Debug, PartialEq, Eq)]
pub struct ToolPlan {
    pub argv: Vec<String>,
    pub env: Vec<(String, String)>,
    /// Runs to completion and reports back (wineboot, winetricks); the others are windows the user closes.
    pub waits: bool,
}

fn text(path: &Path) -> String { path.to_string_lossy().into_owned() }

/// The wine binary inside a Proton folder (`files/bin` for GE and Valve's newer builds, `dist/bin` for older ones).
fn proton_wine(proton_script: &Path, exists: &dyn Fn(&Path) -> bool) -> Option<PathBuf> {
    let dir = proton_script.parent()?;
    ["files/bin/wine", "dist/bin/wine"].iter().map(|relative| dir.join(relative)).find(|path| exists(path))
}

pub fn plan_tool(
    tool: &str,
    verb: Option<&str>,
    runtime: &RuntimeInfo,
    prefix: &Path,
    steam_root: Option<&Path>,
    which: &dyn Fn(&str) -> Option<PathBuf>,
    exists: &dyn Fn(&Path) -> bool,
) -> Result<ToolPlan, String> {
    if runtime.kind != "compat" { return Err("Pick a Wine or Proton runtime first.".into()); }
    let proton = runtime.id != "wine";
    let kind = detect_kind(prefix);
    if kind == "wine" && proton { return Err("This prefix was made by Wine. Choose Wine as the runtime to maintain it, or reset the prefix.".into()); }
    if kind == "proton" && !proton { return Err("This prefix was made by Proton. Choose a Proton runtime to maintain it, or reset the prefix.".into()); }
    let runner = Path::new(&runtime.path);
    let mut env: Vec<(String, String)> = Vec::new();
    let mut argv: Vec<String> = Vec::new();
    let program = |argv: &mut Vec<String>, args: &[&str]| {
        argv.push(text(runner));
        if proton { argv.push("run".into()); }
        argv.extend(args.iter().map(|arg| (*arg).to_owned()));
    };
    if proton {
        let client = steam_root.ok_or("Proton needs a Steam installation.")?;
        env.push(("STEAM_COMPAT_DATA_PATH".into(), text(prefix)));
        env.push(("STEAM_COMPAT_CLIENT_INSTALL_PATH".into(), text(client)));
    } else {
        env.push(("WINEPREFIX".into(), text(prefix)));
    }
    let waits = match tool {
        "winecfg" => { program(&mut argv, &["winecfg"]); false }
        "regedit" => { program(&mut argv, &["regedit"]); false }
        "wineboot" => { program(&mut argv, &["wineboot", "-u"]); true }
        "winetricks" => {
            let verb = verb.ok_or("Choose a component to install.")?;
            if !VERBS.iter().any(|(id, _)| *id == verb) { return Err(format!("\"{verb}\" is not one of the components Mochi installs.")); }
            let winetricks = which("winetricks").ok_or("winetricks is not installed. Install it with your package manager.")?;
            if proton {
                let wine = proton_wine(runner, exists).ok_or("This Proton build has no wine binary Mochi can hand to winetricks. Try a GE-Proton build, or use Wine.")?;
                env.retain(|(key, _)| key == "STEAM_COMPAT_DATA_PATH" || key == "STEAM_COMPAT_CLIENT_INSTALL_PATH");
                env.push(("WINEPREFIX".into(), text(&prefix.join("pfx"))));
                env.push(("WINE".into(), text(&wine)));
            } else {
                env.push(("WINE".into(), text(runner)));
            }
            argv = vec![text(&winetricks), "-q".into(), verb.to_owned()];
            true
        }
        other => return Err(format!("Unknown prefix tool \"{other}\".")),
    };
    Ok(ToolPlan { argv, env, waits })
}

fn resolve_runtime(id: Option<&str>) -> Result<RuntimeInfo, String> {
    let known = platform::list_runtimes();
    let wanted = id.filter(|id| !id.is_empty()).unwrap_or("wine");
    known.into_iter().find(|runtime| runtime.kind == "compat" && runtime.id == wanted).ok_or_else(|| "That runtime is no longer installed.".to_owned())
}

fn prefix_for(app: &tauri::AppHandle, game_id: &str, tofu_id: Option<&str>) -> Result<PathBuf, String> {
    crate::prefix_dir(app, game_id, tofu_id).ok_or_else(|| "Could not find Mochi's data folder.".to_owned())
}

fn ensure_not_running(game_id: &str) -> Result<(), String> {
    if crate::playtime::active().unwrap_or_default().iter().any(|session| session.game_id == game_id) {
        return Err("Close the game first.".into());
    }
    Ok(())
}

#[tauri::command(async)]
pub fn get_prefix_info(app: tauri::AppHandle, game_id: String, tofu_id: Option<String>) -> Result<PrefixInfo, String> {
    Ok(info(&prefix_for(&app, &game_id, tofu_id.as_deref())?))
}

#[tauri::command(async)]
pub fn reset_game_prefix(app: tauri::AppHandle, game_id: String, tofu_id: Option<String>) -> Result<(), String> {
    ensure_not_running(&game_id)?;
    if BUSY.load(Ordering::SeqCst) { return Err("A prefix job is still running.".into()); }
    reset(&prefix_for(&app, &game_id, tofu_id.as_deref())?)
}

#[tauri::command(async)]
pub fn restore_game_prefix(app: tauri::AppHandle, game_id: String, tofu_id: Option<String>) -> Result<(), String> {
    ensure_not_running(&game_id)?;
    if BUSY.load(Ordering::SeqCst) { return Err("A prefix job is still running.".into()); }
    restore_backup(&prefix_for(&app, &game_id, tofu_id.as_deref())?)
}

#[tauri::command(async)]
pub fn delete_game_prefix_backup(app: tauri::AppHandle, game_id: String, tofu_id: Option<String>) -> Result<(), String> {
    delete_backup(&prefix_for(&app, &game_id, tofu_id.as_deref())?)
}

/// Starts a prefix tool. winecfg and regedit open a window and return at once; wineboot and winetricks run in the
/// background and finish with a `prefix-tool-done` event.
#[tauri::command(async)]
pub fn run_prefix_tool(app: tauri::AppHandle, game_id: String, tofu_id: Option<String>, runtime: Option<String>, tool: String, verb: Option<String>) -> Result<(), String> {
    if !cfg!(target_os = "linux") { return Err("Prefix tools are available on Linux only.".into()); }
    ensure_not_running(&game_id)?;
    let prefix = prefix_for(&app, &game_id, tofu_id.as_deref())?;
    checked(&prefix)?;
    let runtime = resolve_runtime(runtime.as_deref())?;
    let plan = plan_tool(&tool, verb.as_deref(), &runtime, &prefix, platform::with_system_tools(|tools| (tools.steam_root)()).as_deref(), &platform::command_path, &|path| path.exists())?;
    let mut command = Command::new(&plan.argv[0]);
    command.args(&plan.argv[1..]).envs(plan.env.iter().map(|(key, value)| (key, value))).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    if runtime.id != "wine" {
        // Proton wants its data folder to exist; a Wine prefix is created by wine itself.
        fs::create_dir_all(&prefix).map_err(|error| format!("Could not create the prefix folder: {error}"))?;
    }
    if !plan.waits {
        command.spawn().map_err(|error| format!("Could not start {tool}: {error}"))?;
        return Ok(());
    }
    if BUSY.swap(true, Ordering::SeqCst) { return Err("A prefix job is still running.".into()); }
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => { BUSY.store(false, Ordering::SeqCst); return Err(format!("Could not start {tool}: {error}")); }
    };
    let label = verb.clone().unwrap_or_else(|| tool.clone());
    std::thread::spawn(move || {
        let status = child.wait();
        BUSY.store(false, Ordering::SeqCst);
        let ok = status.as_ref().is_ok_and(|status| status.success());
        let message = match status { Ok(status) if status.success() => format!("{label} finished."), Ok(status) => format!("{label} stopped with {status}."), Err(error) => format!("{label} failed: {error}") };
        let _ = app.emit("prefix-tool-done", serde_json::json!({ "gameId": game_id, "tool": tool, "ok": ok, "message": message }));
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sources::testutil::temp_dir;

    fn runtime(id: &str, path: &str) -> RuntimeInfo { RuntimeInfo { id: id.into(), name: id.into(), kind: "compat".into(), path: path.into() } }
    fn which(name: &str) -> Option<PathBuf> { (name == "winetricks").then(|| PathBuf::from("/usr/bin/winetricks")) }
    fn nothing(_: &Path) -> bool { false }
    fn everything(_: &Path) -> bool { true }
    fn prefixes(tag: &str) -> PathBuf { let dir = temp_dir(tag).join("prefixes"); fs::create_dir_all(&dir).unwrap(); dir }

    #[test]
    fn kinds_are_recognised() {
        let root = prefixes("kinds");
        assert_eq!(detect_kind(&root.join("none")), "none");
        let wine = root.join("w"); fs::create_dir_all(&wine).unwrap(); fs::write(wine.join("system.reg"), "").unwrap();
        let proton = root.join("p"); fs::create_dir_all(proton.join("pfx")).unwrap();
        let empty = root.join("e"); fs::create_dir_all(&empty).unwrap();
        assert_eq!((detect_kind(&wine), detect_kind(&proton), detect_kind(&empty)), ("wine", "proton", "unknown"));
        let _ = fs::remove_dir_all(root.parent().unwrap());
    }

    #[test]
    fn reset_keeps_the_old_copy_and_restore_swaps_back() {
        let root = prefixes("reset");
        let prefix = root.join("game-default");
        fs::create_dir_all(&prefix).unwrap(); fs::write(prefix.join("system.reg"), "one").unwrap();
        reset(&prefix).unwrap();
        assert!(!prefix.exists() && root.join("game-default.old/system.reg").is_file());
        fs::create_dir_all(&prefix).unwrap(); fs::write(prefix.join("system.reg"), "two").unwrap();
        reset(&prefix).unwrap(); // replaces the older copy
        assert_eq!(fs::read_to_string(root.join("game-default.old/system.reg")).unwrap(), "two");
        fs::create_dir_all(&prefix).unwrap(); fs::write(prefix.join("system.reg"), "three").unwrap();
        restore_backup(&prefix).unwrap();
        assert_eq!(fs::read_to_string(prefix.join("system.reg")).unwrap(), "two");
        assert_eq!(fs::read_to_string(root.join("game-default.old/system.reg")).unwrap(), "three");
        delete_backup(&prefix).unwrap();
        assert!(!root.join("game-default.old").exists() && prefix.is_dir());
        let _ = fs::remove_dir_all(root.parent().unwrap());
    }

    #[test]
    fn only_mochis_own_prefix_folder_can_be_changed() {
        let root = temp_dir("guard");
        let elsewhere = root.join("documents");
        fs::create_dir_all(&elsewhere).unwrap();
        assert!(reset(&elsewhere).is_err() && delete_backup(&elsewhere).is_err() && restore_backup(&elsewhere).is_err());
        assert!(elsewhere.is_dir());
        assert!(reset(Path::new("relative/prefixes/x")).is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn wine_tools_use_the_prefix_variable() {
        let prefix = temp_dir("wine-tools").join("prefixes/g");
        let plan = plan_tool("wineboot", None, &runtime("wine", "/usr/bin/wine"), &prefix, None, &which, &nothing).unwrap();
        assert_eq!(plan.argv, ["/usr/bin/wine", "wineboot", "-u"]);
        assert_eq!(plan.env, [("WINEPREFIX".to_owned(), prefix.to_string_lossy().into_owned())]);
        assert!(plan.waits);
        assert!(!plan_tool("winecfg", None, &runtime("wine", "/usr/bin/wine"), &prefix, None, &which, &nothing).unwrap().waits);
    }

    #[test]
    fn proton_tools_need_steam_and_use_run() {
        let prefix = PathBuf::from("/data/prefixes/g");
        let proton = runtime("proton:/p/GE/proton", "/p/GE/proton");
        assert!(plan_tool("winecfg", None, &proton, &prefix, None, &which, &nothing).is_err());
        let plan = plan_tool("winecfg", None, &proton, &prefix, Some(Path::new("/s")), &which, &nothing).unwrap();
        assert_eq!(plan.argv, ["/p/GE/proton", "run", "winecfg"]);
        assert!(plan.env.contains(&("STEAM_COMPAT_DATA_PATH".into(), "/data/prefixes/g".into())));
    }

    #[test]
    fn winetricks_is_allow_listed_and_aimed_at_the_proton_pfx() {
        let prefix = PathBuf::from("/data/prefixes/g");
        let wine = runtime("wine", "/usr/bin/wine");
        assert!(plan_tool("winetricks", Some("rm -rf"), &wine, &prefix, None, &which, &nothing).is_err());
        assert!(plan_tool("winetricks", None, &wine, &prefix, None, &which, &nothing).is_err());
        assert!(plan_tool("winetricks", Some("vcrun2022"), &wine, &prefix, None, &|_| None, &nothing).is_err());
        let plan = plan_tool("winetricks", Some("vcrun2022"), &wine, &prefix, None, &which, &nothing).unwrap();
        assert_eq!(plan.argv, ["/usr/bin/winetricks", "-q", "vcrun2022"]);
        let proton = runtime("proton:/p/GE/proton", "/p/GE/proton");
        assert!(plan_tool("winetricks", Some("corefonts"), &proton, &prefix, Some(Path::new("/s")), &which, &nothing).is_err());
        let plan = plan_tool("winetricks", Some("corefonts"), &proton, &prefix, Some(Path::new("/s")), &which, &everything).unwrap();
        assert!(plan.env.contains(&("WINEPREFIX".into(), "/data/prefixes/g/pfx".into())));
        assert!(plan.env.contains(&("WINE".into(), "/p/GE/files/bin/wine".into())));
    }

    #[test]
    fn a_prefix_is_not_handed_to_the_wrong_runtime() {
        let root = prefixes("mismatch");
        let prefix = root.join("g");
        fs::create_dir_all(prefix.join("pfx")).unwrap();
        assert!(plan_tool("winecfg", None, &runtime("wine", "/usr/bin/wine"), &prefix, None, &which, &nothing).unwrap_err().contains("Proton"));
        let wine_prefix = root.join("w");
        fs::create_dir_all(&wine_prefix).unwrap(); fs::write(wine_prefix.join("system.reg"), "").unwrap();
        assert!(plan_tool("winecfg", None, &runtime("proton:/p/proton", "/p/proton"), &wine_prefix, Some(Path::new("/s")), &which, &nothing).unwrap_err().contains("Wine"));
        let _ = fs::remove_dir_all(root.parent().unwrap());
    }

    #[test]
    fn unknown_tools_are_refused() {
        assert!(plan_tool("bash", None, &runtime("wine", "/usr/bin/wine"), Path::new("/d/prefixes/g"), None, &which, &nothing).is_err());
    }
}
