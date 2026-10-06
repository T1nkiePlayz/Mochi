#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod platform;

#[tauri::command]
fn launch_game(launch_target: String) -> Result<(), String> {
    platform::launch_game(launch_target.trim())
}

#[tauri::command]
fn list_flatpaks() -> Result<Vec<platform::FlatpakApp>, String> {
    platform::list_flatpaks()
}

#[tauri::command]
fn get_platform_capabilities() -> platform::PlatformCapabilities {
    platform::capabilities()
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            launch_game,
            list_flatpaks,
            get_platform_capabilities
        ])
        .run(tauri::generate_context!())
        .expect("error while running Mochi");
}
