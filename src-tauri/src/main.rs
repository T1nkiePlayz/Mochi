#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[tauri::command]
fn launch_game(executable_path: String) -> Result<(), String> {
    std::process::Command::new(&executable_path).spawn().map(|_| ()).map_err(|e| format!("Failed to launch game: {e}"))
}

fn main() {
    tauri::Builder::default().invoke_handler(tauri::generate_handler![launch_game])
        .run(tauri::generate_context!())
        .expect("error while running Mochi");
}
