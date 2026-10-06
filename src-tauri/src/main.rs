#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[tauri::command]
fn launch_game(launch_target: String) -> Result<(), String> {
    let target = launch_target.trim();
    if target.is_empty() {
        return Err("Launch target is empty.".into());
    }

    #[cfg(target_os = "linux")]
    {
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
            std::process::Command::new("sh")
                .arg(target)
                .spawn()
                .map(|_| ())
                .map_err(|e| format!("Failed to launch shell script: {e}"))
        } else if target.ends_with(".py") {
            std::process::Command::new("python3")
                .arg(target)
                .spawn()
                .map(|_| ())
                .map_err(|e| format!("Failed to launch Python script: {e}"))
        } else if target.ends_with(".js") {
            std::process::Command::new("node")
                .arg(target)
                .spawn()
                .map(|_| ())
                .map_err(|e| format!("Failed to launch JavaScript script: {e}"))
        } else {
            std::process::Command::new(target)
                .spawn()
                .map(|_| ())
                .map_err(|e| format!("Failed to launch game or executable script: {e}"))
        }
    }

    #[cfg(not(target_os = "linux"))]
    {
        std::process::Command::new(target)
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("Failed to launch game: {e}"))
    }
}

#[cfg(target_os = "linux")]
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

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![launch_game])
        .run(tauri::generate_context!())
        .expect("error while running Mochi");
}
