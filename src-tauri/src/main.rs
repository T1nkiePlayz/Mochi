#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

pub(crate) mod platform;
mod sources;
mod themes;
mod modrinth;
mod playtime;
mod tray;

#[tauri::command]
fn send_system_notification(title: String, body: String) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        let status = std::process::Command::new("notify-send").args(["--app-name=Mochi", title.trim(), body.trim()]).status().map_err(|error| format!("Unable to start notify-send: {error}"))?;
        if status.success() { Ok(()) } else { Err("The system notification daemon rejected the notification.".into()) }
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (title, body);
        Err("System notifications are currently implemented for Linux.".into())
    }
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> { platform::open_external_url(url.trim()) }

#[tauri::command]
fn set_launch_on_startup(enabled: bool) -> Result<(), String> { platform::set_launch_on_startup(enabled) }

#[tauri::command]
fn launch_game(launch_target: String) -> Result<(), String> { platform::launch_game(launch_target.trim()) }

#[tauri::command]
fn launch_game_tracked(app: tauri::AppHandle, game_id: String, name: String, launch_target: String) -> Result<(), String> {
    let target = launch_target.trim().to_string();
    if target.is_empty() {
        return Err("Launch target is empty.".into());
    }

    playtime::start(app.clone(), game_id, name, target.clone(), move || platform::launch_game(&target))?;
    let _ = tray::refresh(&app);
    Ok(())
}

#[tauri::command]
fn get_playtime() -> Result<Vec<playtime::PlaytimeEntry>, String> {
    playtime::list()
}

#[tauri::command]
fn get_downloads() -> Vec<modrinth::DownloadEntry> {
    modrinth::list_downloads()
}

#[tauri::command]
fn list_flatpaks() -> Result<Vec<platform::FlatpakApp>, String> { platform::list_flatpaks() }

#[tauri::command]
fn get_platform_capabilities() -> platform::PlatformCapabilities { platform::capabilities() }

#[tauri::command]
fn detect_import_sources() -> Vec<sources::DetectedImportSource> { sources::detect_import_sources() }

#[tauri::command]
fn scan_import_games(source:String, library_path:Option<String>)->Vec<sources::ImportedGame>{sources::scan_import_games(source.trim(),library_path)}

#[tauri::command]
fn get_mochi_config_info(app: tauri::AppHandle) -> Result<themes::MochiConfigInfo, String> { themes::get_mochi_config_info(app) }

#[tauri::command]
fn move_mochi_config(app: tauri::AppHandle, destination: String) -> Result<String, String> { themes::move_config_location(app, destination) }

#[tauri::command]
fn set_mochi_theme(app: tauri::AppHandle, theme_id: String) -> Result<(), String> { themes::set_mochi_theme(app, theme_id) }

#[tauri::command]
fn list_user_themes(app: tauri::AppHandle) -> Result<Vec<themes::UserThemeDescriptor>, String> { themes::list_user_themes(app) }

#[tauri::command]
fn load_user_theme(app: tauri::AppHandle, theme_id: String) -> Result<themes::LoadedUserTheme, String> { themes::load_user_theme(app, theme_id) }

#[tauri::command]
fn clear_mochi_app_data(app: tauri::AppHandle) -> Result<(), String> { themes::clear_app_data(app) }

#[tauri::command]
fn import_theme(app: tauri::AppHandle, source_path: String) -> Result<themes::UserThemeDescriptor, String> { themes::import_theme(app, source_path) }

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|_app, argv, _cwd| {
            println!("Mochi received a new invocation: {argv:?}");
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_deep_link::init())
        .setup(|app| {
            #[cfg(target_os = "linux")]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                app.deep_link().register_all()?;
            }
            themes::initialize_config(&app.handle())?;
            let app_data_dir = app.path().app_data_dir()?;
            playtime::initialize(app_data_dir).map_err(|error| std::io::Error::new(std::io::ErrorKind::Other, error))?;
            tray::initialize(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            send_system_notification, open_external_url, set_launch_on_startup, launch_game, launch_game_tracked, get_playtime, list_flatpaks, get_platform_capabilities, detect_import_sources, scan_import_games,
            get_mochi_config_info, move_mochi_config, set_mochi_theme, list_user_themes, load_user_theme, clear_mochi_app_data, import_theme,
            modrinth::list_mod_files, modrinth::set_mod_file_enabled, modrinth::delete_mod_file, modrinth::start_modrinth_download, modrinth::download_modrinth_file, get_downloads
        ])
        .run(tauri::generate_context!())
        .expect("error while running Mochi");
}
