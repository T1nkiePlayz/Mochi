use super::{command_exists, home_dir, safe_launch_id, FlatpakApp, LaunchConfig, PlatformCapabilities, Prepared, RuntimeInfo};
use std::{ffi::OsString, fs, path::Path, process::Command};

const APP_ID: &str = "dev.sidequestgames.Mochilauncher";
const STARTUP_PLIST: &str = "dev.sidequestgames.Mochilauncher.plist";
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

fn open_command() -> Command { Command::new("/usr/bin/open") }

fn is_app_bundle(path: &Path) -> bool {
    path.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("app")) && path.is_dir()
}

pub fn prepare_launch(target: &str, config: &LaunchConfig) -> Result<Prepared, String> {
    for scheme in ["steam://rungameid/", "lutris:rungameid/", "itch://run-game/"] {
        if let Some(id) = target.strip_prefix(scheme) {
            let mut command = open_command();
            command.arg(format!("{scheme}{}", safe_launch_id(id)?));
            return Ok(Prepared { command, direct: false });
        }
    }
    if target.starts_with("heroic://") || target.starts_with("bottles:run/") || target.starts_with("mochi://") {
        let mut command = open_command();
        command.arg(target);
        return Ok(Prepared { command, direct: false });
    }

    let path = Path::new(target);
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

pub fn ensure_platform_integration() -> Result<(), String> { Ok(()) }

fn launchctl_domain() -> Option<String> {
    // SAFETY: getuid has no preconditions and cannot fail.
    Some(format!("gui/{}", unsafe { libc::getuid() }))
}

fn xml_escape(value: &str) -> String {
    value.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

pub fn set_launch_on_startup(enabled: bool) -> Result<(), String> {
    let launch_agents = home_dir().ok_or("Unable to determine the home directory.")?.join("Library/LaunchAgents");
    let plist = launch_agents.join(STARTUP_PLIST);
    let domain = launchctl_domain();
    let launchctl = |action: &str| {
        if let (true, Some(domain)) = (command_exists("launchctl"), &domain) {
            let _ = Command::new("launchctl").args([action, domain]).arg(&plist).status();
        }
    };
    if enabled {
        fs::create_dir_all(&launch_agents).map_err(|e| format!("Unable to create LaunchAgents directory: {e}"))?;
        let executable = std::env::current_exe().map_err(|e| format!("Unable to determine the Mochi executable: {e}"))?;
        let content = format!(r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>{APP_ID}</string>
<key>ProgramArguments</key><array><string>{}</string></array>
<key>RunAtLoad</key><true/>
<key>ProcessType</key><string>Interactive</string>
</dict></plist>
"#, xml_escape(&executable.to_string_lossy()));
        // Replace any previously loaded copy so a moved app is picked up.
        launchctl("bootout");
        fs::write(&plist, content).map_err(|e| format!("Unable to install Mochi startup agent: {e}"))?;
        launchctl("bootstrap");
    } else if plist.exists() {
        launchctl("bootout");
        fs::remove_file(&plist).map_err(|e| format!("Unable to remove Mochi startup agent: {e}"))?;
    }
    Ok(())
}

pub fn open_url(url: &str) -> Result<(), String> {
    open_command().arg(url).spawn().map(|_| ()).map_err(|e| format!("Unable to open the external URL: {e}"))
}

pub fn open_path(path: &Path) -> Result<(), String> {
    let mut command = open_command();
    if path.is_file() { command.arg("-R"); }
    command.arg(path).spawn().map(|_| ()).map_err(|e| format!("Unable to open the folder: {e}"))
}

pub fn send_system_notification(title: &str, body: &str) -> Result<(), String> {
    let script = format!("display notification {} with title {}", applescript_string(body), applescript_string(title));
    let status = Command::new("/usr/bin/osascript").args(["-e", &script]).status().map_err(|e| format!("Unable to start macOS notifications: {e}"))?;
    if status.success() { Ok(()) } else { Err("macOS rejected the system notification.".into()) }
}

fn applescript_string(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\"").replace(['\n', '\r'], " "))
}
