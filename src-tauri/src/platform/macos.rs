use super::{FlatpakApp, PlatformCapabilities};
use std::{env, fs, path::{Path, PathBuf}, process::Command};

const APP_ID: &str = "dev.sidequestgames.Mochilauncher";
const SCHEME: &str = "mochi";
const STARTUP_PLIST: &str = "dev.sidequestgames.Mochilauncher.plist";

fn home() -> Result<PathBuf, String> {
    env::var_os("HOME").map(PathBuf::from).ok_or_else(|| "Unable to determine the home directory.".into())
}

fn app_support() -> Result<PathBuf, String> { Ok(home()?.join("Library/Application Support")) }

fn command_exists(command: &str) -> bool {
    Command::new("sh").args(["-c", &format!("command -v {command}")]).output().map(|o| o.status.success()).unwrap_or(false)
}

pub fn capabilities() -> PlatformCapabilities {
    PlatformCapabilities {
        platform: "macos".into(),
        display_name: "macOS".into(),
        launch_methods: vec!["file".into(), "app".into(), "custom".into()],
        supports_flatpak: false,
        supports_app_bundles: true,
        supports_startup: true,
        supports_system_notifications: true,
    }
}

pub fn list_flatpaks() -> Result<Vec<FlatpakApp>, String> {
    Err("Flatpak discovery is not available on macOS.".into())
}

pub fn launch_game(target: &str) -> Result<(), String> {
    let target = target.trim();
    if target.is_empty() { return Err("Launch target is empty.".into()); }

    if target.starts_with("steam://") || target.starts_with("heroic://") || target.starts_with("lutris:") || target.starts_with("bottles:") || target.starts_with("itch://") || target.starts_with("mochi://") {
        return open_external_url(target);
    }

    let path = Path::new(target);
    if path.extension().and_then(|value| value.to_str()).map(|value| value.eq_ignore_ascii_case("app")).unwrap_or(false) || path.is_dir() && path.to_string_lossy().ends_with(".app") {
        return Command::new("open").arg(path).spawn().map(|_| ()).map_err(|e| format!("Failed to launch macOS application: {e}"));
    }

    if target.ends_with(".sh") || target.ends_with(".bash") {
        return Command::new("sh").arg(target).spawn().map(|_| ()).map_err(|e| format!("Failed to launch shell script: {e}"));
    }
    if target.ends_with(".py") {
        return Command::new("python3").arg(target).spawn().map(|_| ()).map_err(|e| format!("Failed to launch Python script: {e}"));
    }
    if target.ends_with(".js") {
        return Command::new("node").arg(target).spawn().map(|_| ()).map_err(|e| format!("Failed to launch JavaScript script: {e}"));
    }

    Command::new(target).spawn().map(|_| ()).map_err(|e| format!("Failed to launch game or executable: {e}"))
}

pub fn ensure_platform_integration() -> Result<(), String> { Ok(()) }

pub fn set_launch_on_startup(enabled: bool) -> Result<(), String> {
    let launch_agents = home()?.join("Library/LaunchAgents");
    let plist = launch_agents.join(STARTUP_PLIST);
    if enabled {
        fs::create_dir_all(&launch_agents).map_err(|e| format!("Unable to create LaunchAgents directory: {e}"))?;
        let executable = env::current_exe().map_err(|e| format!("Unable to determine the Mochi executable: {e}"))?;
        let escaped = executable.to_string_lossy().replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;");
        let content = format!(r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>{APP_ID}</string>
<key>ProgramArguments</key><array><string>{escaped}</string></array>
<key>RunAtLoad</key><true/>
<key>ProcessType</key><string>Interactive</string>
</dict></plist>
"#);
        fs::write(&plist, content).map_err(|e| format!("Unable to install Mochi startup agent: {e}"))?;
        if command_exists("launchctl") {
            let _ = Command::new("launchctl").args(["load", "-w"]).arg(&plist).status();
        }
    } else if plist.exists() {
        if command_exists("launchctl") { let _ = Command::new("launchctl").args(["unload", "-w"]).arg(&plist).status(); }
        fs::remove_file(&plist).map_err(|e| format!("Unable to remove Mochi startup agent: {e}"))?;
    }
    Ok(())
}

pub fn open_external_url(url: &str) -> Result<(), String> {
    Command::new("open").arg(url).spawn().map(|_| ()).map_err(|error| format!("Unable to open the external URL: {error}"))
}

pub fn send_system_notification(title: &str, body: &str) -> Result<(), String> {
    let script = format!(
        "display notification {} with title {}",
        applescript_string(body.trim()),
        applescript_string(title.trim())
    );
    Command::new("osascript").args(["-e", &script]).status().map_err(|error| format!("Unable to start macOS notifications: {error}"))?
        .success().then_some(()).ok_or_else(|| "macOS rejected the system notification.".into())
}

fn applescript_string(value: &str) -> String {
    format!("\\\"{}\\\"", value.replace('\\\\', "\\\\\\\\").replace('"', "\\\"").replace('\\n', " "))
}
