//! `nxm://` links from Nexus Mods' "Mod Manager Download" button, which let free Nexus accounts download through Mochi.
//! The scheme is declared in `tauri.conf.json` (so macOS lists Mochi as a handler from the bundle and a running Mochi
//! receives the link), but on Linux Mochi only becomes the default handler when the user turns it on: other mod managers
//! may own `nxm://` and Mochi never takes it over silently. The link itself is parsed and validated in the frontend.
use std::path::PathBuf;
use tauri::Manager;

const MARKER: &str = "nxm-handler";

fn marker(app: &tauri::AppHandle) -> Option<PathBuf> { app.path().app_data_dir().ok().map(|dir| dir.join(MARKER)) }

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NxmHandler {
    /// Mochi can switch the handler on and off itself (Linux). On macOS the bundle declares it and Finder decides.
    pub configurable: bool,
    pub registered: bool,
}

/// Re-registers the handler at startup when the user turned it on (desktop integration rewrites the handler entry).
pub fn apply_saved(app: &tauri::AppHandle) {
    #[cfg(target_os = "linux")]
    if marker(app).is_some_and(|path| path.exists()) {
        use tauri_plugin_deep_link::DeepLinkExt;
        if let Err(error) = app.deep_link().register("nxm") { eprintln!("Mochi nxm handler: {error}"); }
    }
    #[cfg(not(target_os = "linux"))]
    let _ = app;
}

#[tauri::command(async)]
pub fn get_nxm_handler(app: tauri::AppHandle) -> NxmHandler {
    #[cfg(target_os = "linux")]
    {
        use tauri_plugin_deep_link::DeepLinkExt;
        let registered = app.deep_link().is_registered("nxm").unwrap_or(false) && marker(&app).is_some_and(|path| path.exists());
        NxmHandler { configurable: true, registered }
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = app;
        NxmHandler { configurable: false, registered: true }
    }
}

#[tauri::command(async)]
pub fn set_nxm_handler(app: tauri::AppHandle, enabled: bool) -> Result<NxmHandler, String> {
    let path = marker(&app).ok_or("Mochi could not find its data folder.")?;
    #[cfg(target_os = "linux")]
    {
        use tauri_plugin_deep_link::DeepLinkExt;
        if enabled {
            app.deep_link().register("nxm").map_err(|e| format!("Could not register Mochi for Nexus Mods links: {e}"))?;
            if let Some(parent) = path.parent() { let _ = std::fs::create_dir_all(parent); }
            std::fs::write(&path, b"1").map_err(|e| e.to_string())?;
        } else {
            let _ = std::fs::remove_file(&path);
            app.deep_link().unregister("nxm").map_err(|e| format!("Could not unregister Mochi for Nexus Mods links: {e}"))?;
        }
    }
    #[cfg(not(target_os = "linux"))]
    let _ = (enabled, path);
    Ok(get_nxm_handler(app))
}
