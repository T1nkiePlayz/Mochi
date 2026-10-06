#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[derive(serde::Serialize)]
struct FlatpakApp {
    id: String,
    name: String,
    category: String,
}

#[cfg(target_os = "linux")]
#[tauri::command]
fn list_flatpaks() -> Result<Vec<FlatpakApp>, String> {
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
        .invoke_handler(tauri::generate_handler![launch_game, list_flatpaks])
        .run(tauri::generate_context!())
        .expect("error while running Mochi");
}
