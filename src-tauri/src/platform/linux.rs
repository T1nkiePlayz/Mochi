use super::{FlatpakApp, PlatformCapabilities};

pub fn capabilities() -> PlatformCapabilities {
    PlatformCapabilities {
        platform: "linux".into(),
        display_name: "Linux".into(),
        launch_methods: vec!["file".into(), "flatpak".into(), "custom".into()],
        supports_flatpak: true,
        supports_app_bundles: false,
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

        let category = metadata
            .as_ref()
            .and_then(|result| {
                let text = String::from_utf8_lossy(&result.stdout);
                text.lines()
                    .find_map(|line| line.strip_prefix("categories="))
                    .map(|categories| {
                        if categories.split(';').any(|value| value.eq_ignore_ascii_case("Game") || value.eq_ignore_ascii_case("Games")) {
                            "Games".to_string()
                        } else {
                            "Other".to_string()
                        }
                    })
            })
            .unwrap_or_else(|| "Other".to_string());

        apps.push(FlatpakApp { id: id.to_string(), name, category });
    }

    apps.sort_by_key(|app| (app.category != "Games", app.name.to_lowercase()));
    Ok(apps)
}

pub fn launch_game(target: &str) -> Result<(), String> {
    if target.is_empty() {
        return Err("Launch target is empty.".into());
    }

    if let Some(id)=target.strip_prefix("steam://rungameid/"){return launch_steam(id)}
    if target.starts_with("heroic://"){return launch_uri(target,"Heroic")}
    if target.starts_with("lutris:rungameid/"){return launch_lutris(target)}
    if target.starts_with("bottles:run/"){return launch_uri(target,"Bottles")}
    if let Some(id)=target.strip_prefix("itch://run-game/"){return launch_itch(id)}
    if target.ends_with(".desktop") {
        std::process::Command::new("gio")
            .args(["launch", target])
            .spawn()
            .or_else(|_| std::process::Command::new("xdg-open").arg(target).spawn())
            .map(|_| ())
            .map_err(|e| format!("Failed to launch .desktop file: {e}"))
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

fn launch_flatpak(app_id: &str) -> Result<(), String> {
    if app_id.is_empty() || app_id.contains('/') || app_id.split_whitespace().count() != 1 {
        return Err("Enter a valid Flatpak application ID, such as com.example.Game.".into());
    }

    std::process::Command::new("flatpak")
        .args(["run", app_id])
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Failed to launch Flatpak game: {e}"))
}

fn launch_uri(t:&str,k:&str)->Result<(),String>{std::process::Command::new("xdg-open").arg(t).spawn().map(|_|()).map_err(|e|format!("Failed to open {k}: {e}"))}
fn launch_steam(id:&str)->Result<(),String>{if command_exists("steam"){return std::process::Command::new("steam").arg(format!("steam://rungameid/{id}")).spawn().map(|_|()).map_err(|e|e.to_string())}if flatpak_installed("com.valvesoftware.Steam"){return std::process::Command::new("flatpak").args(["run","com.valvesoftware.Steam"]).arg(format!("steam://rungameid/{id}")).spawn().map(|_|()).map_err(|e|e.to_string())}launch_uri(&format!("steam://rungameid/{id}"),"Steam")}
fn launch_lutris(t:&str)->Result<(),String>{if command_exists("lutris"){return std::process::Command::new("lutris").arg(t).spawn().map(|_|()).map_err(|e|e.to_string())}if flatpak_installed("net.lutris.Lutris"){return std::process::Command::new("flatpak").args(["run","net.lutris.Lutris",t]).spawn().map(|_|()).map_err(|e|e.to_string())}launch_uri(t,"Lutris")}
fn launch_itch(id:&str)->Result<(),String>{if command_exists("itch-setup"){return std::process::Command::new("itch-setup").args(["--run-game",id]).spawn().map(|_|()).map_err(|e|e.to_string())}if let Some(h)=std::env::var_os("HOME"){let p=std::path::PathBuf::from(h).join(".itch/itch-setup");if p.is_file(){return std::process::Command::new(p).args(["--run-game",id]).spawn().map(|_|()).map_err(|e|e.to_string())}}launch_uri(&format!("itch://install?game_id={id}&launch"),"itch.io")}
fn command_exists(s:&str)->bool{std::process::Command::new("sh").args(["-c",&format!("command -v {s}")]).output().map(|o|o.status.success()).unwrap_or(false)}
fn flatpak_installed(s:&str)->bool{std::process::Command::new("flatpak").args(["info",s]).output().map(|o|o.status.success()).unwrap_or(false)}

pub fn set_launch_on_startup(enabled: bool) -> Result<(), String> {
    let home = std::env::var_os("HOME").ok_or("Unable to determine the home directory.")?;
    let config_root = std::env::var_os("XDG_CONFIG_HOME").map(std::path::PathBuf::from).unwrap_or_else(|| std::path::PathBuf::from(home).join(".config"));\n    let autostart = config_root.join("autostart");
    let desktop = autostart.join("mochi.desktop");

    if enabled {
        std::fs::create_dir_all(&autostart)
            .map_err(|e| format!("Unable to create autostart directory: {e}"))?;
        let exe = std::env::current_exe()
            .map_err(|e| format!("Unable to determine the Mochi executable: {e}"))?;
        let content = format!(
            "[Desktop Entry]\nType=Application\nName=Mochi\nComment=Launch Mochi when you sign in\nExec={}\nTerminal=false\nStartupNotify=false\nX-GNOME-Autostart-enabled=true\n",
            exe.to_string_lossy().replace('\\', "\\\\").replace('"', "\\\"")
        );
        std::fs::write(&desktop, content)
            .map_err(|e| format!("Unable to install Mochi startup entry: {e}"))?;
    } else if desktop.exists() {
        std::fs::remove_file(&desktop)
            .map_err(|e| format!("Unable to remove Mochi startup entry: {e}"))?;
    }

    Ok(())
}
