//! Operating-system adapter. Shared code describes *what* Mochi wants to do;
//! the `linux` and `macos` modules describe *how* the OS does it.

use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant},
};

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(not(any(target_os = "linux", target_os = "macos")))]
compile_error!("Mochi supports Linux and macOS only.");

#[cfg(target_os = "linux")]
use linux as os;
#[cfg(target_os = "macos")]
use macos as os;

#[derive(Debug, Serialize, Clone)]
pub struct FlatpakApp {
    pub id: String,
    pub name: String,
    pub category: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PlatformCapabilities {
    pub platform: String,
    pub display_name: String,
    pub launch_methods: Vec<String>,
    pub supports_flatpak: bool,
    pub supports_app_bundles: bool,
    pub supports_startup: bool,
    pub supports_system_notifications: bool,
    pub supports_shortcuts: bool,
    /// Running on a Steam Deck (or SteamOS handheld).
    pub is_steam_deck: bool,
    /// Running inside a gamescope session (Steam Gaming Mode).
    pub is_gamescope: bool,
}

/// A compatibility layer or wrapper that can be applied to a launch.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeInfo {
    pub id: String,
    pub name: String,
    /// "compat" runs a program that is not native (Wine, Proton, ...);
    /// "wrapper" decorates a native launch (gamemode, mangohud, ...).
    pub kind: String,
    pub path: String,
}

/// Per-Tofu launch settings supplied by the frontend.
#[derive(Debug, Default, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct LaunchConfig {
    pub runtime: Option<String>,
    pub wrappers: Vec<String>,
    pub args: Vec<String>,
    pub env: BTreeMap<String, String>,
    pub working_dir: Option<String>,
    #[serde(skip)]
    pub prefix_dir: Option<PathBuf>,
}

/// What `launch_game` started.
pub struct Launched {
    /// Set when the spawned process is the game itself (it leads its own
    /// process group), as opposed to a hand-off through another launcher.
    pub direct_pid: Option<u32>,
}

/// A prepared command and whether the child is the game itself.
pub struct Prepared {
    pub command: Command,
    pub direct: bool,
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

pub fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from).filter(|path| path.is_absolute())
}

/// Locates an executable on PATH (plus the usual GUI-session gaps on macOS).
pub fn command_path(name: &str) -> Option<PathBuf> {
    if name.is_empty() || name.contains('/') { return None; }
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect()).unwrap_or_default();
    for extra in ["/usr/local/bin", "/opt/homebrew/bin", "/usr/bin", "/bin"] {
        let extra = PathBuf::from(extra);
        if !dirs.contains(&extra) { dirs.push(extra); }
    }
    dirs.into_iter().map(|dir| dir.join(name)).find(|candidate| is_executable(candidate))
}

pub fn command_exists(name: &str) -> bool { command_path(name).is_some() }

pub fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    path.metadata().map(|meta| meta.is_file() && meta.permissions().mode() & 0o111 != 0).unwrap_or(false)
}

/// Runs a command, capturing stdout, and kills it if it exceeds `timeout`.
pub fn run_capture(mut command: Command, timeout: Duration) -> Option<Vec<u8>> {
    use std::io::Read;
    let mut child = command.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().ok()?;
    let mut stdout = child.stdout.take()?;
    let reader = std::thread::spawn(move || { let mut buffer = Vec::new(); let _ = stdout.read_to_end(&mut buffer); buffer });
    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) if started.elapsed() < timeout => std::thread::sleep(Duration::from_millis(25)),
            _ => { let _ = child.kill(); let _ = child.wait(); break None; }
        }
    };
    let output = reader.join().unwrap_or_default();
    status.filter(|status| status.success()).map(|_| output)
}

/// Spawns `command` as the leader of a new process group, detached from our
/// stdio, and reaps it in the background so it never lingers as a zombie.
pub fn spawn_detached(mut command: Command) -> Result<u32, String> {
    use std::os::unix::process::CommandExt;
    command.process_group(0).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    let mut child = command.spawn().map_err(|error| error.to_string())?;
    let pid = child.id();
    std::thread::spawn(move || { let _ = child.wait(); });
    Ok(pid)
}

pub fn launch_game(target: &str, config: &LaunchConfig) -> Result<Launched, String> {
    let target = target.trim();
    if target.is_empty() { return Err("Launch target is empty.".into()); }
    if target.contains('\0') { return Err("Launch target contains an invalid character.".into()); }
    let Prepared { mut command, direct } = os::prepare_launch(target, config)?;
    for (key, value) in &config.env {
        if valid_env_name(key) { command.env(key, value); }
    }
    if let Some(dir) = config.working_dir.as_deref().filter(|dir| Path::new(dir).is_dir()) {
        command.current_dir(dir);
    }
    let pid = spawn_detached(command).map_err(|error| format!("Failed to launch: {error}"))?;
    Ok(Launched { direct_pid: direct.then_some(pid) })
}

pub fn valid_env_name(name: &str) -> bool {
    !name.is_empty() && name.len() <= 128 && !name.starts_with(|c: char| c.is_ascii_digit()) && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// Allows only ids a launcher could plausibly use in a URL or argument.
pub fn safe_launch_id(id: &str) -> Result<&str, String> {
    if !id.is_empty() && id.len() <= 128 && id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ':')) {
        Ok(id)
    } else {
        Err("The game's launch identifier is not valid.".into())
    }
}

pub fn open_external_url(url: &str) -> Result<(), String> {
    let trimmed = url.trim();
    if !(trimmed.starts_with("https://") || trimmed.starts_with("http://") || trimmed.starts_with("mochi://")) {
        return Err("Only http(s) and Mochi URLs can be opened externally.".into());
    }
    os::open_url(trimmed)
}

/// Opens a folder (or reveals a file) in the system file manager.
pub fn open_path(path: &str) -> Result<(), String> {
    let path = Path::new(path.trim());
    if !path.is_absolute() || !path.exists() { return Err("That location does not exist.".into()); }
    os::open_path(path)
}

pub fn ensure_platform_integration() -> Result<(), String> { os::ensure_platform_integration() }
pub fn set_launch_on_startup(enabled: bool) -> Result<(), String> { os::set_launch_on_startup(enabled) }
pub fn list_flatpaks() -> Result<Vec<FlatpakApp>, String> { os::list_flatpaks() }
pub fn capabilities() -> PlatformCapabilities {
    PlatformCapabilities { is_steam_deck: crate::bigpicture::is_steam_deck(), is_gamescope: crate::bigpicture::is_gamescope(), ..os::capabilities() }
}
pub fn list_runtimes() -> Vec<RuntimeInfo> { os::list_runtimes() }
pub fn send_system_notification(title: &str, body: &str) -> Result<(), String> { os::send_system_notification(title.trim(), body.trim()) }
pub fn create_game_shortcut(game_id: &str, name: &str) -> Result<String, String> { os::create_game_shortcut(game_id, name) }
pub fn remove_game_shortcut(game_id: &str) -> Result<(), String> { os::remove_game_shortcut(game_id) }
