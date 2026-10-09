use super::{home_dir, launchagent, safe_launch_id, spawn_detached, FlatpakApp, LaunchConfig, PlatformCapabilities, Prepared, RuntimeInfo};
use std::{ffi::OsString, fs, path::{Path, PathBuf}, process::Command};

const APP_ID: &str = "dev.sidequestgames.Mochilauncher";
const STARTUP_PLIST: &str = "dev.sidequestgames.Mochilauncher.plist";
/// Schemes handed to `open` unchanged: other launchers register them with LaunchServices.
const OPEN_SCHEMES: [&str; 6] = ["heroic://", "mochi://", "com.epicgames.launcher://", "battlenet://", "bottles:run/", "goggalaxy://"];
const COMPAT_APPS: [(&str, &str); 2] = [("/Applications/CrossOver.app", "CrossOver"), ("/Applications/Whisky.app", "Whisky")];

pub fn capabilities() -> PlatformCapabilities {
    PlatformCapabilities {
        platform: "macos".into(),
        display_name: "macOS".into(),
        launch_methods: vec!["file".into(), "app".into(), "custom".into()],
        supports_flatpak: false,
        supports_app_bundles: true,
        supports_startup: true,
        supports_system_notifications: true,
        supports_shortcuts: false,
        is_steam_deck: false,
        is_gamescope: false,
    }
}

pub fn list_flatpaks() -> Result<Vec<FlatpakApp>, String> {
    Err("Flatpak discovery is not available on macOS.".into())
}

/// Windows compatibility apps that can open a `.exe` for the user.
pub fn list_runtimes() -> Vec<RuntimeInfo> {
    let user_apps = home_dir().map(|home| home.join("Applications"));
    COMPAT_APPS
        .iter()
        .filter_map(|(path, name)| {
            let system = Path::new(path);
            let user = user_apps.as_ref().map(|dir| dir.join(system.file_name().unwrap_or_default()));
            [Some(system.to_path_buf()), user].into_iter().flatten().find(|candidate| candidate.is_dir()).map(|found| RuntimeInfo {
                id: format!("app:{}", found.display()),
                name: format!("Open with {name}"),
                kind: "compat".into(),
                path: found.to_string_lossy().into_owned(),
            })
        })
        .collect()
}

/// Steam's Proton does not exist on macOS.
pub fn steam_root() -> Option<PathBuf> { None }

fn open_command() -> Command { Command::new("/usr/bin/open") }

fn is_app_bundle(path: &Path) -> bool {
    path.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("app")) && path.is_dir()
}

pub fn prepare_launch(target: &str, config: &LaunchConfig) -> Result<Prepared, String> {
    for scheme in ["steam://rungameid/", "steam://open/", "lutris:rungameid/"] {
        if let Some(id) = target.strip_prefix(scheme) {
            let mut command = open_command();
            command.arg(format!("{scheme}{}", safe_launch_id(id)?));
            return Ok(Prepared { command, direct: false });
        }
    }
    // The itch app has no "run" URL; its game page is the closest thing to launching from there.
    if let Some(id) = target.strip_prefix("itch://run-game/") {
        let mut command = open_command();
        command.arg(format!("itch://games/{}", safe_launch_id(id)?));
        return Ok(Prepared { command, direct: false });
    }
    if let Some((launcher, id)) = crate::sources::prism::parse_instance_target(target) {
        let mut command = open_command();
        command.args(["-b", launcher.bundle, "--args", "--launch"]).arg(id);
        return Ok(Prepared { command, direct: false });
    }
    if OPEN_SCHEMES.iter().any(|scheme| target.starts_with(scheme)) {
        let mut command = open_command();
        command.arg(target);
        return Ok(Prepared { command, direct: false });
    }

    let path = Path::new(target);
    if target.to_ascii_lowercase().trim_end_matches('/').ends_with(".app") && !path.is_dir() {
        return Err("This app is no longer installed at the saved location. Edit the game to pick it again.".into());
    }
    if is_app_bundle(path) {
        let mut command = open_command();
        for (key, value) in &config.env {
            if super::valid_env_name(key) { command.arg("--env").arg(format!("{key}={value}")); }
        }
        command.arg(path);
        if !config.args.is_empty() { command.arg("--args").args(&config.args); }
        return Ok(Prepared { command, direct: false });
    }

    let extension = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    if matches!(extension.as_str(), "exe" | "bat" | "msi" | "lnk") {
        let selected = config.runtime.as_deref().and_then(|id| list_runtimes().into_iter().find(|runtime| runtime.id == id))
            .or_else(|| list_runtimes().into_iter().next())
            .ok_or("This Windows program needs CrossOver or Whisky. Install one, then pick it in the Tofu settings.")?;
        let mut command = open_command();
        command.arg("-a").arg(&selected.path).arg(path);
        return Ok(Prepared { command, direct: false });
    }

    let mut argv: Vec<OsString> = match extension.as_str() {
        "sh" | "bash" | "command" => vec!["sh".into(), target.into()],
        "py" => vec!["python3".into(), target.into()],
        "js" => vec!["node".into(), target.into()],
        _ => vec![target.into()],
    };
    argv.extend(config.args.iter().map(OsString::from));
    let mut iter = argv.into_iter();
    let mut command = Command::new(iter.next().ok_or("Launch target is empty.")?);
    command.args(iter);
    Ok(Prepared { command, direct: true })
}

pub fn create_game_shortcut(_game_id: &str, _name: &str) -> Result<String, String> {
    Err("Desktop shortcuts are not available on macOS.".into())
}

pub fn remove_game_shortcut(_game_id: &str) -> Result<(), String> { Ok(()) }

/// macOS needs no installation step: the `.app` bundle is the install, `mochi://` is registered
/// through the bundle's Info.plist, and Mochi never copies itself anywhere.
pub fn ensure_platform_integration() -> Result<(), String> { Ok(()) }

pub fn tray_available() -> bool { true }

/// Writes (or removes) a per-user LaunchAgent. The agent loads at the next login, so toggling
/// the setting never launches a second copy or stops the running one (no `launchctl` needed).
pub fn set_launch_on_startup(enabled: bool) -> Result<(), String> {
    let launch_agents = home_dir().ok_or("Unable to determine the home directory.")?.join("Library/LaunchAgents");
    let plist = launch_agents.join(STARTUP_PLIST);
    if enabled {
        let executable = std::env::current_exe().map_err(|e| format!("Unable to determine the Mochi executable: {e}"))?;
        let content = launchagent::plist(APP_ID, &launchagent::program_arguments(&executable)?);
        fs::create_dir_all(&launch_agents).map_err(|e| format!("Unable to create LaunchAgents directory: {e}"))?;
        fs::write(&plist, content).map_err(|e| format!("Unable to install Mochi startup agent: {e}"))?;
    } else if plist.exists() {
        fs::remove_file(&plist).map_err(|e| format!("Unable to remove Mochi startup agent: {e}"))?;
    }
    Ok(())
}

pub fn open_url(url: &str) -> Result<(), String> {
    let mut command = open_command();
    command.arg(url);
    spawn_detached(command).map(|_| ()).map_err(|e| format!("Unable to open the external URL: {e}"))
}

pub fn open_path(path: &Path) -> Result<(), String> {
    let mut command = open_command();
    if path.is_file() { command.arg("-R"); }
    command.arg(path);
    spawn_detached(command).map(|_| ()).map_err(|e| format!("Unable to open the folder: {e}"))
}

pub fn send_system_notification(title: &str, body: &str) -> Result<(), String> {
    // Inside Mochi.app the notification centre shows Mochi's name and icon. `osascript` remains the
    // fallback (dev builds, or when the centre refuses), where macOS attributes it to Script Editor.
    if running_from_bundle(std::env::current_exe().ok().as_deref()) && send_native_notification(title, body).is_ok() { return Ok(()); }
    let script = notification_script(title, body);
    let status = Command::new("/usr/bin/osascript").args(["-e", &script]).status().map_err(|e| format!("Unable to start macOS notifications: {e}"))?;
    if status.success() { Ok(()) } else { Err("macOS rejected the system notification.".into()) }
}

/// True for an executable inside an application bundle (`Mochi.app/Contents/MacOS/mochi`).
fn running_from_bundle(exe: Option<&Path>) -> bool {
    exe.and_then(Path::to_str).is_some_and(|path| path.contains(".app/Contents/MacOS/"))
}

#[cfg(target_os = "macos")]
fn send_native_notification(title: &str, body: &str) -> Result<(), String> {
    static APPLICATION: std::sync::Once = std::sync::Once::new();
    APPLICATION.call_once(|| { let _ = mac_notification_sys::set_application(APP_ID); });
    let (title, body) = (clip_notification_text(title), clip_notification_text(body));
    mac_notification_sys::Notification::new().title(&title).message(&body).asynchronous(true).send().map(|_| ()).map_err(|error| error.to_string())
}

#[cfg(not(target_os = "macos"))]
fn send_native_notification(_title: &str, _body: &str) -> Result<(), String> { Err("macOS only".into()) }

fn clip_notification_text(value: &str) -> String {
    value.chars().filter(|c| !c.is_control() || matches!(c, '\n' | '\t')).take(400).collect()
}

/// AppleScript for a notification. Text is embedded as string literals with `\` and `"` escaped
/// and line breaks removed, so it can never close the literal and run code of its own.
fn notification_script(title: &str, body: &str) -> String {
    format!("display notification {} with title {}", applescript_string(body), applescript_string(title))
}

fn applescript_string(value: &str) -> String {
    let clipped: String = value.chars().filter(|c| !c.is_control() || matches!(c, '\n' | '\r' | '\t')).take(400).collect();
    format!("\"{}\"", clipped.replace('\\', "\\\\").replace('"', "\\\"").replace(['\n', '\r', '\t'], " "))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn notification_text_cannot_escape_its_string_literal() {
        let script = notification_script("a\" & (do shell script \"id\") & \"", "line1\nline2 \\ \"quoted\"");
        assert_eq!(script, "display notification \"line1 line2 \\\\ \\\"quoted\\\"\" with title \"a\\\" & (do shell script \\\"id\\\") & \\\"\"");
        assert!(applescript_string(&"x".repeat(5000)).len() < 410);
    }

    #[test]
    fn native_notifications_only_inside_a_bundle() {
        assert!(running_from_bundle(Some(Path::new("/Applications/Mochi.app/Contents/MacOS/mochi"))));
        assert!(!running_from_bundle(Some(Path::new("/Users/me/src/mochi/target/debug/mochi"))));
        assert!(!running_from_bundle(None));
        assert_eq!(clip_notification_text("a\u{7}b\nc"), "ab\nc");
        assert_eq!(clip_notification_text(&"x".repeat(900)).len(), 400);
    }

    #[test]
    fn missing_app_bundles_give_a_clear_error() {
        let error = prepare_launch("/Applications/Definitely Not Installed.app", &LaunchConfig::default()).err().expect("error");
        assert!(error.contains("no longer installed"));
    }

    #[test]
    fn minecraft_instances_open_their_launcher_bundle() {
        let prepared = prepare_launch("mc-instance://prism/My%20Pack", &LaunchConfig::default()).expect("instance");
        let args: Vec<_> = prepared.command.get_args().map(|arg| arg.to_string_lossy().into_owned()).collect();
        assert_eq!(args, ["-b", "org.prismlauncher.PrismLauncher", "--args", "--launch", "My Pack"]);
        assert!(!prepared.direct);
    }

    #[test]
    fn url_targets_go_through_open() {
        for target in ["steam://rungameid/220", "heroic://launch?appName=a&runner=gog", "com.epicgames.launcher://apps/x?action=launch"] {
            let prepared = prepare_launch(target, &LaunchConfig::default()).expect(target);
            assert_eq!(prepared.command.get_program(), "/usr/bin/open");
            assert!(!prepared.direct);
        }
        assert!(prepare_launch("steam://rungameid/1 2", &LaunchConfig::default()).is_err());
    }
}
