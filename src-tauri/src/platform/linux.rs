use super::{FlatpakApp, PlatformCapabilities};

const APP_ID: &str = "dev.sidequestgames.Mochilauncher";
const DESKTOP_FILE: &str = "mochi.desktop";
const DESKTOP_SCHEME: &str = "mochi";
const AUTOSTART_DIRECTORY: &str = "autostart";
const ICON_PNG: &[u8] = include_bytes!("../../icons/icon.png");

pub fn capabilities() -> PlatformCapabilities {
    PlatformCapabilities {
        platform: "linux".into(),
        display_name: "Linux".into(),
        launch_methods: vec!["file".into(), "flatpak".into(), "custom".into()],
        supports_flatpak: true,
        supports_app_bundles: false,
        supports_startup: true,
        supports_system_notifications: true,
    }
}

pub fn list_flatpaks() -> Result<Vec<FlatpakApp>, String> {
    let output = std::process::Command::new("flatpak")
        .args(["list", "--app", "--columns=application,name"])
        .output()
        .map_err(|e| format!("Unable to query installed Flatpaks: {e}"))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    let mut apps = Vec::new();
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let mut fields = line.splitn(2, '\t');
        let Some(id) = fields.next().map(str::trim).filter(|v| !v.is_empty()) else { continue };
        let name = fields.next().map(str::trim).filter(|v| !v.is_empty()).unwrap_or(id).to_string();
        let metadata = std::process::Command::new("flatpak")
            .args(["info", "--show-metadata", id])
            .output()
            .ok();
        let category = metadata.as_ref().and_then(|result| {
            let text = String::from_utf8_lossy(&result.stdout);
            text.lines().find_map(|line| line.strip_prefix("categories=")).map(|categories| {
                if categories.split(';').any(|value| value.eq_ignore_ascii_case("Game") || value.eq_ignore_ascii_case("Games")) {
                    "Games".to_string()
                } else { "Other".to_string() }
            })
        }).unwrap_or_else(|| "Other".to_string());
        apps.push(FlatpakApp { id: id.to_string(), name, category });
    }
    apps.sort_by_key(|app| (app.category != "Games", app.name.to_lowercase()));
    Ok(apps)
}

pub fn launch_game(target: &str) -> Result<(), String> {
    if target.is_empty() { return Err("Launch target is empty.".into()); }
    if let Some(id) = target.strip_prefix("steam://rungameid/") { return launch_steam(id); }
    if target.starts_with("heroic://") { return launch_uri(target, "Heroic"); }
    if target.starts_with("lutris:rungameid/") { return launch_lutris(target); }
    if target.starts_with("bottles:run/") { return launch_uri(target, "Bottles"); }
    if let Some(id) = target.strip_prefix("itch://run-game/") { return launch_itch(id); }

    if target.ends_with(".desktop") {
        std::process::Command::new("gio").args(["launch", target]).spawn()
            .or_else(|_| std::process::Command::new("xdg-open").arg(target).spawn())
            .map(|_| ()).map_err(|e| format!("Failed to launch .desktop file: {e}"))
    } else if let Some(app_id) = target.strip_prefix("flatpak://") {
        launch_flatpak(app_id.trim())
    } else if let Some(app_id) = target.strip_prefix("flatpak run ") {
        launch_flatpak(app_id.trim())
    } else if target.ends_with(".sh") || target.ends_with(".bash") {
        spawn_with_error(std::process::Command::new("sh").arg(target), "shell script")
    } else if target.ends_with(".py") {
        spawn_with_error(std::process::Command::new("python3").arg(target), "Python script")
    } else if target.ends_with(".js") {
        spawn_with_error(std::process::Command::new("node").arg(target), "JavaScript script")
    } else {
        spawn_with_error(&mut std::process::Command::new(target), "game or executable")
    }
}

fn spawn_with_error(command: &mut std::process::Command, kind: &str) -> Result<(), String> {
    command.spawn().map(|_| ()).map_err(|e| format!("Failed to launch {kind}: {e}"))
}
fn launch_flatpak(id: &str) -> Result<(), String> {
    if id.is_empty() || id.contains('/') || id.split_whitespace().count() != 1 { return Err("Enter a valid Flatpak application ID, such as com.example.Game.".into()); }
    std::process::Command::new("flatpak").args(["run", id]).spawn().map(|_| ()).map_err(|e| format!("Failed to launch Flatpak game: {e}"))
}
fn launch_uri(target: &str, kind: &str) -> Result<(), String> {
    std::process::Command::new("xdg-open").arg(target).spawn().map(|_| ()).map_err(|e| format!("Failed to open {kind}: {e}"))
}
fn launch_steam(id: &str) -> Result<(), String> {
    if command_exists("steam") { return std::process::Command::new("steam").arg(format!("steam://rungameid/{id}")).spawn().map(|_| ()).map_err(|e| e.to_string()); }
    if flatpak_installed("com.valvesoftware.Steam") { return std::process::Command::new("flatpak").args(["run", "com.valvesoftware.Steam"]).arg(format!("steam://rungameid/{id}")).spawn().map(|_| ()).map_err(|e| e.to_string()); }
    launch_uri(&format!("steam://rungameid/{id}"), "Steam")
}
fn launch_lutris(target: &str) -> Result<(), String> {
    if command_exists("lutris") { return std::process::Command::new("lutris").arg(target).spawn().map(|_| ()).map_err(|e| e.to_string()); }
    if flatpak_installed("net.lutris.Lutris") { return std::process::Command::new("flatpak").args(["run", "net.lutris.Lutris", target]).spawn().map(|_| ()).map_err(|e| e.to_string()); }
    launch_uri(target, "Lutris")
}
fn launch_itch(id: &str) -> Result<(), String> {
    if command_exists("itch-setup") { return std::process::Command::new("itch-setup").args(["--run-game", id]).spawn().map(|_| ()).map_err(|e| e.to_string()); }
    if let Some(h) = std::env::var_os("HOME") {
        let path = std::path::PathBuf::from(h).join(".itch/itch-setup");
        if path.is_file() { return std::process::Command::new(path).args(["--run-game", id]).spawn().map(|_| ()).map_err(|e| e.to_string()); }
    }
    launch_uri(&format!("itch://install?game_id={id}&launch"), "itch.io")
}
fn command_exists(command: &str) -> bool { std::process::Command::new("sh").args(["-c", &format!("command -v {command}")]).output().map(|o| o.status.success()).unwrap_or(false) }
fn flatpak_installed(id: &str) -> bool { std::process::Command::new("flatpak").args(["info", id]).output().map(|o| o.status.success()).unwrap_or(false) }

pub fn ensure_platform_integration() -> Result<(), String> {
    let home = std::env::var_os("HOME").ok_or("Unable to determine the home directory.")?;
    let applications = std::path::PathBuf::from(&home).join(".local/share/applications");
    std::fs::create_dir_all(&applications).map_err(|e| format!("Unable to create the applications directory: {e}"))?;
    let executable = std::env::current_exe().map_err(|e| format!("Unable to determine the Mochi executable: {e}"))?;
    let exec = executable.to_string_lossy().replace('\\', "\\").replace('"', "\"").replace('%', "%%");
    let icons = std::path::PathBuf::from(&home).join(".local/share/icons/hicolor/512x512/apps");
    std::fs::create_dir_all(&icons).map_err(|e| format!("Unable to create the icon directory: {e}"))?;
    std::fs::write(icons.join("mochi.png"), ICON_PNG).map_err(|e| format!("Unable to install the Mochi application icon: {e}"))?;

    let desktop = applications.join(DESKTOP_FILE);
    let content = format!("[Desktop Entry]\nType=Application\nName=Mochi\nComment=Your games, your way.\nExec=\"{exec}\" %U\nTryExec=\"{exec}\"\nIcon=mochi\nTerminal=false\nStartupNotify=true\nStartupWMClass={APP_ID}\nCategories=Game;Utility;\nMimeType=x-scheme-handler/{DESKTOP_SCHEME};\n");
    std::fs::write(&desktop, content).map_err(|e| format!("Unable to write Mochi desktop entry: {e}"))?;
    if command_exists("update-desktop-database") { let _ = std::process::Command::new("update-desktop-database").arg(&applications).status(); }
    Ok(())
}

pub fn set_launch_on_startup(enabled: bool) -> Result<(), String> {
    let home = std::env::var_os("HOME").ok_or("Unable to determine the home directory.")?;
    let config_root = std::env::var_os("XDG_CONFIG_HOME").map(std::path::PathBuf::from).unwrap_or_else(|| std::path::PathBuf::from(home).join(".config"));
    let autostart = config_root.join(AUTOSTART_DIRECTORY);
    let desktop = autostart.join(DESKTOP_FILE);
    if enabled {
        std::fs::create_dir_all(&autostart).map_err(|e| format!("Unable to create autostart directory: {e}"))?;
        let exe = std::env::current_exe().map_err(|e| format!("Unable to determine the Mochi executable: {e}"))?;
        let content = format!("[Desktop Entry]\nType=Application\nName=Mochi\nComment=Launch Mochi when you sign in\nExec=\"{}\"\nTerminal=false\nStartupNotify=false\nX-GNOME-Autostart-enabled=true\n", exe.to_string_lossy().replace('\\', "\\").replace('"', "\""));
        std::fs::write(&desktop, content).map_err(|e| format!("Unable to install Mochi startup entry: {e}"))?;
    } else if desktop.exists() { std::fs::remove_file(&desktop).map_err(|e| format!("Unable to remove Mochi startup entry: {e}"))?; }
    Ok(())
}

pub fn open_external_url(url: &str) -> Result<(), String> {
    std::process::Command::new("xdg-open").arg(url).spawn().map(|_| ()).map_err(|error| format!("Unable to open the external URL: {error}"))
}

pub fn send_system_notification(title: &str, body: &str) -> Result<(), String> {
    let status = std::process::Command::new("notify-send").args(["--app-name=Mochi", title.trim(), body.trim()]).status().map_err(|error| format!("Unable to start notify-send: {error}"))?;
    if status.success() { Ok(()) } else { Err("The system notification daemon rejected the notification.".into()) }
}
