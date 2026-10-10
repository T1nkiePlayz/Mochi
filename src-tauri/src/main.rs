use serde::Deserialize;
use tauri::{Emitter, Manager, WindowEvent};

mod fonts;
mod bigpicture;
mod cli;
mod deals;
mod dirsize;
mod game_artwork;
mod icon_cover;
mod gamelogs;
mod gamepad;
mod downloads;
mod modinstance;
mod mochipack;
mod modsnapshot;
mod modhash;
mod modlocs;
mod modprofiles;
mod modscan;
mod nxm;
mod modrinth;
mod platform;
mod selfinstall;
mod shortcuts;
mod playtime;
mod process;
mod savebackup;
mod sharecard;
mod sources;
mod soundpacks;
mod steam_achievements;
mod steam_news;
mod steam_store;
mod settings_zip;
mod storage;
mod themes;
mod tracking;
mod tray;
mod url_policy;
mod util;
mod window_state;

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
    /// Copies the Tofu's mods into the game's mods folder before the game starts.
    #[serde(default)]
    mod_sync: Option<modinstance::ModSyncRequest>,
}

fn safe_segment(value: &str) -> String {
    value.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '-' }).take(80).collect()
}

#[tauri::command(async)]
fn send_system_notification(title: String, body: String) -> Result<(), String> {
    platform::send_system_notification(&title, &body)
}

#[tauri::command(async)]
fn open_external_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
    match url_policy::evaluate(&url)? {
        url_policy::UrlDecision::Open(url) => platform::open_external_url(&url),
        url_policy::UrlDecision::Confirm { url, host } => {
            let approved = app.dialog()
                .message(format!("Mochi is about to open this link in your browser:\n\n{url}\n\n{host} is not a site Mochi knows. Only continue if you trust it."))
                .title("Open external link?")
                .kind(MessageDialogKind::Warning)
                .buttons(MessageDialogButtons::OkCancelCustom("Open".into(), "Cancel".into()))
                .blocking_show();
            if approved { platform::open_external_url(&url) } else { Err("Cancelled.".into()) }
        }
    }
}

#[tauri::command(async)]
fn open_path_in_file_manager(path: String) -> Result<(), String> { platform::open_path(&path) }

#[tauri::command(async)]
fn set_launch_on_startup(enabled: bool) -> Result<(), String> { platform::set_launch_on_startup(enabled) }

/// The per-game Wine/Proton prefix, created on demand at launch.
fn prefix_dir(app: &tauri::AppHandle, game_id: &str, tofu_id: Option<&str>) -> Option<std::path::PathBuf> {
    let name = format!("{}-{}", safe_segment(game_id), safe_segment(tofu_id.unwrap_or("default")));
    app.path().app_data_dir().ok().map(|dir| dir.join("prefixes").join(name))
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct PreviewRequest {
    game_id: String,
    launch_target: String,
    tofu_id: Option<String>,
    #[serde(default)]
    config: platform::LaunchConfig,
}

/// The command a launch with these options would run, built by the launcher's own code.
#[tauri::command(async)]
fn preview_launch_command(app: tauri::AppHandle, request: PreviewRequest) -> platform::launchopts::LaunchPreview {
    let mut config = request.config;
    config.prefix_dir = prefix_dir(&app, &request.game_id, request.tofu_id.as_deref());
    platform::preview_launch(&request.launch_target, &config)
}

/// Detected Proton/Wine runtimes and wrappers; scanning the Steam libraries is cached for a few seconds.
#[tauri::command(async)]
fn list_launch_runtimes() -> Vec<platform::RuntimeInfo> {
    use std::{sync::Mutex, time::{Duration, Instant}};
    static CACHE: Mutex<Option<(Instant, Vec<platform::RuntimeInfo>)>> = Mutex::new(None);
    if let Some((at, found)) = CACHE.lock().ok().as_deref().and_then(|cache| cache.as_ref()) {
        if at.elapsed() < Duration::from_secs(10) { return found.clone(); }
    }
    let found = platform::list_runtimes();
    if let Ok(mut cache) = CACHE.lock() { *cache = Some((Instant::now(), found.clone())); }
    found
}

#[tauri::command(async)]
fn launch_game_tracked(app: tauri::AppHandle, request: LaunchRequest) -> Result<(), String> {
    let LaunchRequest { game_id, name, launch_target, install_path, tofu_id, mut config, mod_sync } = request;
    let target = launch_target.trim().to_string();
    if target.is_empty() { return Err("Launch target is empty.".into()); }
    config.prefix_dir = prefix_dir(&app, &game_id, tofu_id.as_deref());
    config.log_dir = gamelogs::game_log_dir(&game_id).ok();
    // Mods are swapped in only now, at launch: only the differences are touched and a failure never blocks the game.
    if let Some(sync) = mod_sync {
        let tofu_id = sync.tofu_id.clone();
        let progress_id = tofu_id.clone();
        let outcome = modinstance::run_sync(&sync, &|done, total| modinstance::emit("mod-sync-progress", modinstance::SyncProgress { tofu_id: progress_id.clone(), done, total }));
        let _ = app.emit("mod-sync-result", serde_json::json!({ "tofuId": tofu_id, "report": outcome.as_ref().ok(), "error": outcome.as_ref().err() }));
    }

    let request = playtime::StartRequest { game_id, name, target: target.clone(), install_path };
    playtime::start(app, request, move || platform::launch_game(&target, &config))
}

#[tauri::command(async)]
fn stop_game(game_id: String) -> Result<(), String> { playtime::stop(&game_id) }

#[tauri::command(async)]
fn get_active_sessions() -> Result<Vec<playtime::ActiveSessionInfo>, String> { playtime::active() }

#[tauri::command(async)]
fn get_playtime() -> Result<Vec<playtime::PlaytimeEntry>, String> { playtime::list() }

#[tauri::command(async)]
fn get_playtime_history(since_epoch: Option<u64>) -> Result<Vec<playtime::Session>, String> { playtime::history(since_epoch) }

#[tauri::command(async)]
fn get_dir_size(path: String) -> Result<dirsize::DirSize, String> { dirsize::dir_size_cached(&path) }

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

/// Copies a Minecraft launcher instance next to the original (see `sources::mccopy`), reporting `minecraft-copy-progress`.
#[tauri::command]
async fn copy_minecraft_instance(app: tauri::AppHandle, launch_target: String) -> Result<sources::mccopy::CopiedInstance, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let home = platform::home_dir().ok_or("Could not find your home folder.")?;
        let target = launch_target.clone();
        sources::mccopy::copy_instance(&home, &launch_target, &mut |copied_bytes, total_bytes, file| {
            let _ = app.emit("minecraft-copy-progress", sources::mccopy::CopyProgress { target: target.clone(), copied_bytes, total_bytes, file: file.to_owned() });
        })
    }).await.map_err(|e| format!("The copy was interrupted: {e}"))?
}

/// The modpack facts of one Minecraft instance (`ManagedPack*` keys, pack manifest), read from its folder.
#[tauri::command(async)]
fn read_minecraft_pack(launch_target: String) -> Result<Option<sources::prism::MinecraftInstance>, String> {
    let home = platform::home_dir().ok_or("Could not find your home folder.")?;
    Ok(sources::mccopy::read_target(&home, &launch_target)?.minecraft)
}

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
fn clear_mochi_app_data(app: tauri::AppHandle) -> Result<(), String> {
    themes::clear_app_data(app.clone())?;
    // Cached API responses live in the per-OS cache folder; wine prefixes are the user's data and stay.
    if let Ok(cache) = app.path().app_cache_dir() { let _ = std::fs::remove_dir_all(cache.join("modrinth-api")); }
    if let Ok(data) = app.path().app_data_dir() { let _ = std::fs::remove_dir_all(data.join("steam-store")); }
    // Playtime of games that are running right now is kept.
    let _ = playtime::reset();
    Ok(())
}

#[tauri::command(async)]
fn import_theme(app: tauri::AppHandle, source_path: String) -> Result<themes::UserThemeDescriptor, String> { themes::import_theme(app, source_path) }

/// Prints how long each setup step took when `MOCHI_STARTUP_TRACE` is set (off by default).
fn startup_mark(since: std::time::Instant, step: &str) {
    if std::env::var_os("MOCHI_STARTUP_TRACE").is_some() { eprintln!("[mochi startup] {step}: {:.1} ms", since.elapsed().as_secs_f64() * 1000.0); }
}

/// Mirrors the library's ids and names for `mochi list` and `mochi launch` (see cli.rs).
#[tauri::command(async)]
async fn write_library_index(app: tauri::AppHandle, entries: Vec<cli::IndexEntry>) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || cli::save_index(&dir, entries)).await.map_err(|e| e.to_string())?
}

fn main() {
    // `mochi list`, `mochi --help` and unknown games answer on the terminal without starting the app.
    let argv: Vec<String> = std::env::args().collect();
    if let Some(code) = cli::run_early(&argv) { std::process::exit(code); }
    #[cfg(target_os = "linux")]
    platform::prepare_linux_webview_environment();
    // A build that will offer to install itself runs beside any running copy: no single-instance
    // lock (the installed copy takes it after the relaunch) and no desktop integration yet.
    let candidate = selfinstall::detect();
    let installing = candidate.is_some();
    let mut builder = tauri::Builder::default()
        // Tells the frontend how it was started before the first paint.
        .plugin(tauri::plugin::Builder::<tauri::Wry, ()>::new("mochi-boot").js_init_script(bigpicture::boot_script(bigpicture::parse_flags(&argv)) + &cli::boot_script(&argv)).build())
        .manage(std::sync::Mutex::new(candidate));
    if !installing {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // The window is hidden to the tray on close, so a second launch or a
            // mochi:// link must bring it back or it appears to do nothing.
            tray::show_mochi(app);
            // `mochi --big-picture` from a Steam shortcut switches the running instance over.
            if bigpicture::parse_flags(&argv).big_picture { let _ = app.emit("mochi-bigpicture", true); }
            // `mochi launch <game>` / `mochi open <game>` from a terminal; the app resolves the game in the live library.
            // (mochi:// links reach the frontend through the deep-link plugin instead.)
            if let Some((kind, query)) = cli::frontend_intent(&argv) { let _ = app.emit("cli-intent", serde_json::json!({ "kind": kind, "query": query })); }
        }));
    }
    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(move |app| {
            let startup = std::time::Instant::now();
            // Desktop integration (registering the mochi:// handler, copying the AppImage, writing desktop
            // entries) spawns helper processes and touches several folders; it must neither delay
            // startup nor stop Mochi from opening. The handler entry is registered first because
            // the integration step rewrites it.
            {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    #[cfg(target_os = "linux")]
                    {
                        use tauri_plugin_deep_link::DeepLinkExt;
                        // Only mochi:// here; nxm:// (also in the config) is opt-in, see nxm.rs.
                        if let Err(error) = handle.deep_link().register("mochi") { eprintln!("Mochi deep link registration: {error}"); }
                    }
                    if !installing { if let Err(error) = platform::ensure_platform_integration() { eprintln!("Mochi platform integration: {error}"); } }
                    nxm::apply_saved(&handle);
                });
            }
            // An unwritable config folder must not stop Mochi from opening; commands report the problem when used.
            if let Err(error) = themes::initialize_config(app.handle()) { eprintln!("Mochi config: {error}"); }
            startup_mark(startup, "config");
            let data_dir = app.path().app_data_dir()?;
            modinstance::initialize(app.handle().clone(), data_dir.clone());
            playtime::initialize(data_dir).map_err(std::io::Error::other)?;
            startup_mark(startup, "playtime");
            tray::initialize(app);
            startup_mark(startup, "tray");
            gamepad::start(app.handle().clone());
            startup_mark(startup, "gamepad");
            if let Some(window) = app.get_webview_window("main") {
                window_state::restore(&window, (640.0, 480.0));
                window.clone().on_window_event(move |event| {
                    match event {
                        WindowEvent::Resized(_) | WindowEvent::Moved(_) => window_state::schedule_save(&window),
                        WindowEvent::CloseRequested { .. } => window_state::save_immediately(&window),
                        _ => {}
                    }
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        // Without a tray icon there is no way back, so closing really closes.
                        if tray::close_hides_window() {
                            api.prevent_close();
                            let _ = window.hide();
                        }
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            write_library_index, send_system_notification, open_external_url, open_path_in_file_manager, set_launch_on_startup,
            launch_game_tracked, stop_game, get_active_sessions, get_playtime, get_playtime_history, get_dir_size, get_downloads,
            list_flatpaks, list_runtimes, list_launch_runtimes, preview_launch_command, get_platform_capabilities, create_game_shortcut, remove_game_shortcut, shortcuts::get_shortcut_targets, shortcuts::create_piko_shortcut, shortcuts::add_piko_to_steam,
            detect_import_sources, scan_import_games, copy_minecraft_instance, read_minecraft_pack,
            bigpicture::get_system_status, bigpicture::suspend_system, bigpicture::power_action, bigpicture::get_power_capabilities, soundpacks::list_sound_packs, soundpacks::import_sound_pack, soundpacks::remove_sound_pack, soundpacks::export_sound_pack, sharecard::write_share_card, soundpacks::read_sound_pack_file, bigpicture::quit_mochi, gamepad::get_gamepads, gamepad::gamepad_rumble,
            get_mochi_config_info, move_mochi_config, set_mochi_theme, list_user_themes, load_user_theme, clear_mochi_app_data, import_theme,
            fonts::cache_theme_fonts, settings_zip::export_settings_zip, settings_zip::read_settings_zip, settings_zip::install_themes_from_settings_zip,
            storage::scan_storage, storage::cancel_storage_scan, storage::clear_storage_location,
            game_artwork::cache_game_artwork, game_artwork::get_cached_game_artwork, game_artwork::get_cached_game_artwork_path, game_artwork::clear_game_artwork_cache,
            game_artwork::prepare_artwork_preview, game_artwork::save_custom_artwork, game_artwork::delete_game_artwork, icon_cover::cache_icon_cover, platform::check_launch_targets,
            modrinth::get_public_api, modrinth::list_mod_files, modrinth::set_mod_file_enabled, modrinth::apply_mod_profile,
            deals::get_epic_free_games, deals::get_cheapshark_deals, deals::get_price_info,
            steam_store::get_steam_store_details, steam_news::get_steam_news, steam_achievements::get_steam_achievements, steam_achievements::get_steam_achievement_totals,
            steam_achievements::clear_steam_achievements_cache, steam_store::clear_steam_store_cache,
            modrinth::delete_mod_file, modrinth::start_modrinth_download, downloads::start_mod_download, modrinth::update_mod_file, modrinth::analyze_mod_files,
            downloads::cancel_mod_download, downloads::clear_finished_downloads,
            modinstance::list_instance_mods, modinstance::get_instance_store_dir, modinstance::record_instance_mod, modinstance::set_instance_mods_enabled,
            modinstance::rollback_mod_update, modinstance::sync_instance_mods, modinstance::import_mods_from_folder, modlocs::detect_mod_locations,
            modscan::hash_mod_files, modscan::modrinth_identify, modscan::record_instance_mods, modscan::list_instance_records, modscan::copy_instance_records,
            modprofiles::read_tofu_manifest, modprofiles::write_tofu_manifest, modprofiles::restore_instance_records, modprofiles::apply_tofu_mods, nxm::get_nxm_handler, nxm::set_nxm_handler,
            mochipack::write_mochipack_file, mochipack::read_mochipack_file,
            modsnapshot::create_tofu_snapshot, modsnapshot::list_tofu_snapshots, modsnapshot::restore_tofu_snapshot, modsnapshot::delete_tofu_snapshot,
            gamelogs::list_game_logs, gamelogs::read_game_log, gamelogs::clear_game_logs,
            savebackup::list_save_locations, savebackup::create_save_backup, savebackup::list_save_backups, savebackup::restore_save_backup, savebackup::delete_save_backup, savebackup::auto_backup_saves, savebackup::get_save_backup_settings, savebackup::set_save_backup_settings,
            selfinstall::self_install_status, selfinstall::self_install_verify, selfinstall::self_install_apply, selfinstall::self_install_skip,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Mochi")
        .run(|app, event| match event {
            // Credit time for games still running when Mochi quits.
            tauri::RunEvent::Exit => playtime::finish_all(),
            // Clicking the Dock icon should reopen a window that was hidden to the menu bar.
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { .. } => tray::show_mochi(app),
            // A mochi:// link opened while Mochi sits in the menu bar must bring the window back
            // (the deep-link plugin forwards the URL to the frontend itself).
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Opened { .. } => tray::show_mochi(app),
            _ => { let _ = app; }
        });
}
