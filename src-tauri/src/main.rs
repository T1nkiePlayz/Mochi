use serde::Deserialize;
use tauri::{Manager, WindowEvent};

mod fonts;
mod game_artwork;
mod modrinth;
mod platform;
mod playtime;
mod process;
mod sources;
mod steam_store;
mod themes;
mod tray;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LaunchRequest {
    game_id: String,
    name: String,
    launch_target: String,
    install_path: Option<String>,
    tofu_id: Option<String>,
    #[serde(default)]
    config: platform::LaunchConfig,
}

fn safe_segment(value: &str) -> String {
    value.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '-' }).take(80).collect()
}

#[tauri::command(async)]
fn send_system_notification(title: String, body: String) -> Result<(), String> {
    platform::send_system_notification(&title, &body)
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> { platform::open_external_url(&url) }

#[tauri::command]
fn open_path_in_file_manager(path: String) -> Result<(), String> { platform::open_path(&path) }

#[tauri::command(async)]
fn set_launch_on_startup(enabled: bool) -> Result<(), String> { platform::set_launch_on_startup(enabled) }

#[tauri::command(async)]
fn launch_game_tracked(app: tauri::AppHandle, request: LaunchRequest) -> Result<(), String> {
    let LaunchRequest { game_id, name, launch_target, install_path, tofu_id, mut config } = request;
    let target = launch_target.trim().to_string();
    if target.is_empty() { return Err("Launch target is empty.".into()); }
    let prefix = format!("{}-{}", safe_segment(&game_id), safe_segment(tofu_id.as_deref().unwrap_or("default")));
    config.prefix_dir = app.path().app_data_dir().ok().map(|dir| dir.join("prefixes").join(prefix));

    let request = playtime::StartRequest { game_id, name, target: target.clone(), install_path };
    playtime::start(app, request, move || platform::launch_game(&target, &config))
}

#[tauri::command]
fn stop_game(game_id: String) -> Result<(), String> { playtime::stop(&game_id) }

#[tauri::command]
fn get_active_sessions() -> Result<Vec<playtime::ActiveSessionInfo>, String> { playtime::active() }

#[tauri::command]
fn get_playtime() -> Result<Vec<playtime::PlaytimeEntry>, String> { playtime::list() }

#[tauri::command]
fn get_downloads() -> Vec<modrinth::DownloadEntry> { modrinth::list_downloads() }

#[tauri::command(async)]
fn list_flatpaks() -> Result<Vec<platform::FlatpakApp>, String> { platform::list_flatpaks() }

#[tauri::command(async)]
fn list_runtimes() -> Vec<platform::RuntimeInfo> { platform::list_runtimes() }

#[tauri::command]
fn get_platform_capabilities() -> platform::PlatformCapabilities { platform::capabilities() }

#[tauri::command(async)]
fn create_game_shortcut(game_id: String, name: String) -> Result<String, String> { platform::create_game_shortcut(&game_id, &name) }

#[tauri::command(async)]
fn remove_game_shortcut(game_id: String) -> Result<(), String> { platform::remove_game_shortcut(&game_id) }

#[tauri::command(async)]
fn detect_import_sources() -> Vec<sources::DetectedImportSource> { sources::detect_import_sources() }

#[tauri::command(async)]
fn scan_import_games(source: String, library_path: Option<String>) -> Vec<sources::ImportedGame> { sources::scan_import_games(source.trim(), library_path) }

#[tauri::command(async)]
fn get_mochi_config_info(app: tauri::AppHandle) -> Result<themes::MochiConfigInfo, String> { themes::get_mochi_config_info(app) }

#[tauri::command(async)]
fn move_mochi_config(app: tauri::AppHandle, destination: String) -> Result<String, String> { themes::move_config_location(app, destination) }

#[tauri::command(async)]
fn set_mochi_theme(app: tauri::AppHandle, theme_id: String) -> Result<(), String> { themes::set_mochi_theme(app, theme_id) }

#[tauri::command(async)]
fn list_user_themes(app: tauri::AppHandle) -> Result<Vec<themes::UserThemeDescriptor>, String> { themes::list_user_themes(app) }

#[tauri::command(async)]
fn load_user_theme(app: tauri::AppHandle, theme_id: String) -> Result<themes::LoadedUserTheme, String> { themes::load_user_theme(app, theme_id) }

#[tauri::command(async)]
fn clear_mochi_app_data(app: tauri::AppHandle) -> Result<(), String> { themes::clear_app_data(app) }

#[tauri::command(async)]
fn import_theme(app: tauri::AppHandle, source_path: String) -> Result<themes::UserThemeDescriptor, String> { themes::import_theme(app, source_path) }

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // The window is hidden to the tray on close, so a second launch or a
            // mochi:// link must bring it back or it appears to do nothing.
            tray::show_mochi(app);
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            #[cfg(target_os = "linux")]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                app.deep_link().register_all()?;
            }
            // Desktop integration copies the AppImage and writes desktop entries;
            // it must neither delay startup nor stop Mochi from opening.
            std::thread::spawn(|| {
                if let Err(error) = platform::ensure_platform_integration() { eprintln!("Mochi platform integration: {error}"); }
            });
            themes::initialize_config(app.handle())?;
            let data_dir = app.path().app_data_dir()?;
            playtime::initialize(data_dir).map_err(std::io::Error::other)?;
            tray::initialize(app)?;
            if let Some(window) = app.get_webview_window("main") {
                window.clone().on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            send_system_notification, open_external_url, open_path_in_file_manager, set_launch_on_startup,
            launch_game_tracked, stop_game, get_active_sessions, get_playtime, get_downloads,
            list_flatpaks, list_runtimes, get_platform_capabilities, create_game_shortcut, remove_game_shortcut,
            detect_import_sources, scan_import_games,
            get_mochi_config_info, move_mochi_config, set_mochi_theme, list_user_themes, load_user_theme, clear_mochi_app_data, import_theme,
            fonts::cache_theme_fonts,
            game_artwork::cache_game_artwork, game_artwork::get_cached_game_artwork, game_artwork::clear_game_artwork_cache,
            game_artwork::prepare_artwork_preview, game_artwork::save_custom_artwork, game_artwork::delete_game_artwork, platform::check_launch_targets,
            modrinth::get_public_api, modrinth::list_mod_files, modrinth::set_mod_file_enabled, modrinth::apply_mod_profile,
            steam_store::get_steam_store_details,
            modrinth::delete_mod_file, modrinth::start_modrinth_download, modrinth::update_mod_file, modrinth::analyze_mod_files,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Mochi")
        .run(|app, event| match event {
            // Credit time for games still running when Mochi quits.
            tauri::RunEvent::Exit => playtime::finish_all(),
            // Clicking the Dock icon should reopen a window that was hidden to the menu bar.
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { .. } => tray::show_mochi(app),
            _ => { let _ = app; }
        });
}
