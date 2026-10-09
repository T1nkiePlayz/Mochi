//! Operating-system adapter. Shared code describes *what* Mochi wants to do;
//! the `linux` and `macos` modules describe *how* the OS does it.

use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant},
};

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
mod launchagent;
#[cfg(target_os = "linux")]
mod linux;
// Compiled on Linux for tests only, so the macOS adapter is type-checked and unit-tested everywhere.
#[cfg(any(target_os = "macos", test))]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
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
    /// Where this game's session logs go; output is captured when set.
    #[serde(skip)]
    pub log_dir: Option<PathBuf>,
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
    std::env::var_os("HOME").map(PathBuf::from).filter(|path| path.is_absolute()).or_else(passwd_home)
}

/// The account's home directory from the user database, for the rare session where `HOME` is unset.
fn passwd_home() -> Option<PathBuf> {
    use std::os::unix::ffi::OsStrExt;
    // SAFETY: getpwuid_r writes only into the buffers we own and returns a pointer into `buffer`.
    unsafe {
        let mut passwd: libc::passwd = std::mem::zeroed();
        let mut buffer = vec![0u8; 8192];
        let mut result: *mut libc::passwd = std::ptr::null_mut();
        if libc::getpwuid_r(libc::getuid(), &mut passwd, buffer.as_mut_ptr().cast(), buffer.len(), &mut result) != 0 || result.is_null() || passwd.pw_dir.is_null() {
            return None;
        }
        let dir = std::ffi::CStr::from_ptr(passwd.pw_dir);
        Some(PathBuf::from(std::ffi::OsStr::from_bytes(dir.to_bytes()))).filter(|path| path.is_absolute())
    }
}

/// Where per-user files live. macOS uses `~/Library/...`; Linux follows the XDG base directory
/// specification (an unset or relative `XDG_*` variable falls back to the default, as the spec says).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[allow(dead_code)]
pub enum UserDir {
    Config,
    Data,
    Cache,
    Logs,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[cfg_attr(not(test), allow(dead_code))]
pub enum Os {
    Linux,
    MacOs,
}

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub const CURRENT_OS: Os = if cfg!(target_os = "macos") { Os::MacOs } else { Os::Linux };

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub fn resolve_user_dir(os: Os, kind: UserDir, home: &Path, env: &dyn Fn(&str) -> Option<std::ffi::OsString>) -> PathBuf {
    match os {
        Os::MacOs => match kind {
            UserDir::Config | UserDir::Data => home.join("Library/Application Support"),
            UserDir::Cache => home.join("Library/Caches"),
            UserDir::Logs => home.join("Library/Logs"),
        },
        Os::Linux => {
            let (variable, fallback) = match kind {
                UserDir::Config => ("XDG_CONFIG_HOME", ".config"),
                UserDir::Data => ("XDG_DATA_HOME", ".local/share"),
                UserDir::Cache => ("XDG_CACHE_HOME", ".cache"),
                UserDir::Logs => ("XDG_STATE_HOME", ".local/state"),
            };
            env(variable).map(PathBuf::from).filter(|path| path.is_absolute()).unwrap_or_else(|| home.join(fallback))
        }
    }
}

/// The base directory for `kind` on this OS (the same places Tauri's path resolver uses).
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub fn user_dir(kind: UserDir) -> Option<PathBuf> {
    Some(resolve_user_dir(CURRENT_OS, kind, &home_dir()?, &|name| std::env::var_os(name)))
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
/// With a `log`, the child's stdout and stderr are appended to that file (and kept under the size cap).
pub fn spawn_detached_logged(mut command: Command, log: Option<(std::fs::File, PathBuf)>) -> Result<u32, String> {
    use std::os::unix::process::CommandExt;
    command.process_group(0).stdin(Stdio::null());
    let log_path = match log {
        Some((file, path)) => match file.try_clone() {
            Ok(second) => { command.stdout(Stdio::from(file)).stderr(Stdio::from(second)); Some(path) }
            Err(_) => { command.stdout(Stdio::null()).stderr(Stdio::null()); None }
        },
        None => { command.stdout(Stdio::null()).stderr(Stdio::null()); None }
    };
    let mut child = command.spawn().map_err(|error| error.to_string())?;
    let pid = child.id();
    std::thread::spawn(move || {
        let Some(path) = log_path else { let _ = child.wait(); return };
        loop {
            match child.try_wait() {
                Ok(Some(_)) | Err(_) => break,
                Ok(None) => {}
            }
            let _ = crate::gamelogs::trim_log(&path, crate::gamelogs::MAX_BYTES, crate::gamelogs::KEEP_BYTES);
            std::thread::sleep(Duration::from_secs(2));
        }
    });
    Ok(pid)
}

pub fn spawn_detached(command: Command) -> Result<u32, String> { spawn_detached_logged(command, None) }

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
    // A log that cannot be created must never stop the game from starting.
    let log = config.log_dir.as_deref().and_then(|dir| crate::gamelogs::begin_session(dir, direct, &format!("Mochi launched {target}{}", if direct { "" } else { " (through another launcher: its output is not captured)" })).ok());
    let pid = spawn_detached_logged(command, log).map_err(|error| format!("Failed to launch: {error}"))?;
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
    // Callers go through `url_policy::evaluate`; this is the last line of defence.
    match crate::url_policy::evaluate(url)? {
        crate::url_policy::UrlDecision::Open(url) | crate::url_policy::UrlDecision::Confirm { url, .. } => os::open_url(&url),
    }
}

/// Opens a folder (or reveals a file) in the system file manager.
pub fn open_path(path: &str) -> Result<(), String> {
    let path = Path::new(path.trim());
    if !path.is_absolute() || !path.exists() { return Err("That location does not exist.".into()); }
    os::open_path(path)
}

/// WebKitGTK renders a blank window with some NVIDIA drivers unless DMA-BUF rendering is off.
/// Respect an explicit setting from the user.
#[cfg(target_os = "linux")]
pub fn prepare_linux_webview_environment() {
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() && Path::new("/proc/driver/nvidia").exists() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
}

/// Whether the OS shows tray / menu-bar icons Mochi can hide its window behind.
pub fn tray_available() -> bool { os::tray_available() }
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

/// Whether a launch target still exists. URI-style targets (`steam://`, `flatpak://`, ...) are assumed present
/// because their launcher owns them; paths and `.app` bundles are checked on disk.
fn launch_target_exists(target: &str) -> bool {
    let target = target.trim();
    if target.is_empty() { return false; }
    if target.contains("://") { return true; }
    let path = Path::new(target);
    if path.is_absolute() || target.starts_with("~/") || target.starts_with("./") {
        let expanded = match target.strip_prefix("~/") {
            Some(rest) => home_dir().map(|home| home.join(rest)),
            None => Some(path.to_path_buf()),
        };
        return expanded.is_some_and(|path| path.exists());
    }
    // A bare command name is looked up on PATH; anything with arguments cannot be checked cheaply.
    target.contains(char::is_whitespace) || command_exists(target)
}

#[tauri::command]
pub fn check_launch_targets(targets: Vec<String>) -> Vec<bool> {
    targets.iter().take(5000).map(|target| launch_target_exists(target)).collect()
}

#[cfg(test)]
mod launch_target_tests {
    use super::launch_target_exists;

    #[test]
    fn uri_targets_are_assumed_present() {
        assert!(launch_target_exists("steam://rungameid/220"));
        assert!(launch_target_exists("flatpak://org.example.Game"));
    }

    #[test]
    fn missing_and_empty_paths_are_absent() {
        assert!(!launch_target_exists(""));
        assert!(!launch_target_exists("/definitely/not/a/real/mochi/path"));
        assert!(launch_target_exists("/"));
    }
}

#[cfg(test)]
mod directory_tests {
    use super::*;
    use std::ffi::OsString;

    fn env<'a>(pairs: &'a [(&'a str, &'a str)]) -> impl Fn(&str) -> Option<OsString> + 'a {
        move |name| pairs.iter().find(|(key, _)| *key == name).map(|(_, value)| OsString::from(*value))
    }

    #[test]
    fn macos_uses_library_folders_and_ignores_xdg() {
        let home = Path::new("/Users/me");
        let xdg = env(&[("XDG_CONFIG_HOME", "/elsewhere")]);
        assert_eq!(resolve_user_dir(Os::MacOs, UserDir::Config, home, &xdg), Path::new("/Users/me/Library/Application Support"));
        assert_eq!(resolve_user_dir(Os::MacOs, UserDir::Data, home, &xdg), Path::new("/Users/me/Library/Application Support"));
        assert_eq!(resolve_user_dir(Os::MacOs, UserDir::Cache, home, &xdg), Path::new("/Users/me/Library/Caches"));
        assert_eq!(resolve_user_dir(Os::MacOs, UserDir::Logs, home, &xdg), Path::new("/Users/me/Library/Logs"));
    }

    #[test]
    fn linux_follows_xdg_with_spec_fallbacks() {
        let home = Path::new("/home/me");
        assert_eq!(resolve_user_dir(Os::Linux, UserDir::Config, home, &env(&[])), Path::new("/home/me/.config"));
        assert_eq!(resolve_user_dir(Os::Linux, UserDir::Data, home, &env(&[])), Path::new("/home/me/.local/share"));
        assert_eq!(resolve_user_dir(Os::Linux, UserDir::Cache, home, &env(&[])), Path::new("/home/me/.cache"));
        assert_eq!(resolve_user_dir(Os::Linux, UserDir::Config, home, &env(&[("XDG_CONFIG_HOME", "/cfg")])), Path::new("/cfg"));
        // Relative values must be ignored.
        assert_eq!(resolve_user_dir(Os::Linux, UserDir::Data, home, &env(&[("XDG_DATA_HOME", "relative/dir")])), Path::new("/home/me/.local/share"));
    }

    #[test]
    fn home_directory_falls_back_to_the_user_database() {
        assert!(passwd_home().is_some_and(|path| path.is_absolute()));
    }
}
