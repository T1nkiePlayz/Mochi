#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

pub(crate) mod platform;
mod sources;
mod themes;

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

#[tauri::command]
fn detect_import_sources() -> Vec<sources::DetectedImportSource> {
    sources::detect_import_sources()
}

#[tauri::command]
fn scan_import_games(source:String, library_path:Option<String>)->Vec<sources::ImportedGame>{sources::scan_import_games(source.trim(),library_path)}

#[tauri::command]
fn get_mochi_config_info(app: tauri::AppHandle) -> Result<themes::MochiConfigInfo, String> {
    themes::get_mochi_config_info(app)
}

#[tauri::command]
fn set_mochi_theme(app: tauri::AppHandle, theme_id: String) -> Result<(), String> {
    themes::set_mochi_theme(app, theme_id)
}

#[tauri::command]
fn list_user_themes(app: tauri::AppHandle) -> Result<Vec<themes::UserThemeDescriptor>, String> {
    themes::list_user_themes(app)
}

#[tauri::command]
fn load_user_theme(app: tauri::AppHandle, theme_id: String) -> Result<themes::LoadedUserTheme, String> {
    themes::load_user_theme(app, theme_id)
}

#[tauri::command]
fn import_theme(app: tauri::AppHandle, source_path: String) -> Result<themes::UserThemeDescriptor, String> {
    themes::import_theme(app, source_path)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_deep_link::init())
        .invoke_handler(tauri::generate_handler![
            launch_game,
            list_flatpaks,
            get_platform_capabilities,
            detect_import_sources,
            scan_import_games,
            get_mochi_config_info,
            set_mochi_theme,
            list_user_themes,
            load_user_theme,
            import_theme
        ])
        .run(tauri::generate_context!())
        .expect("error while running Mochi");
}
