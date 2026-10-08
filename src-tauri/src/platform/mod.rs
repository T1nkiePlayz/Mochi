use serde::Serialize;

#[derive(Debug, Serialize, Clone)]
pub struct FlatpakApp {
    pub id: String,
    pub name: String,
    pub category: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PlatformCapabilities {
    pub platform: String,
    pub display_name: String,
    pub launch_methods: Vec<String>,
    pub supports_flatpak: bool,
    pub supports_app_bundles: bool,
    pub supports_startup: bool,
    pub supports_system_notifications: bool,
}

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;
#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
mod unsupported;

pub fn ensure_platform_integration() -> Result<(), String> {
    #[cfg(target_os = "linux")]
    { return linux::ensure_platform_integration(); }
    #[cfg(target_os = "macos")]
    { return macos::ensure_platform_integration(); }
    #[cfg(target_os = "windows")]
    { return windows::ensure_platform_integration(); }
    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    { return unsupported::ensure_platform_integration(); }
}

pub fn set_launch_on_startup(enabled: bool) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    { return linux::set_launch_on_startup(enabled); }
    #[cfg(target_os = "macos")]
    { return macos::set_launch_on_startup(enabled); }
    #[cfg(target_os = "windows")]
    { return windows::set_launch_on_startup(enabled); }
    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    { return unsupported::set_launch_on_startup(enabled); }
}

pub fn launch_game(target: &str) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    { linux::launch_game(target) }
    #[cfg(target_os = "macos")]
    { macos::launch_game(target) }
    #[cfg(target_os = "windows")]
    { windows::launch_game(target) }
    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    { unsupported::launch_game(target) }
}

pub fn list_flatpaks() -> Result<Vec<FlatpakApp>, String> {
    #[cfg(target_os = "linux")]
    { linux::list_flatpaks() }
    #[cfg(target_os = "macos")]
    { macos::list_flatpaks() }
    #[cfg(target_os = "windows")]
    { windows::list_flatpaks() }
    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    { unsupported::list_flatpaks() }
}

pub fn capabilities() -> PlatformCapabilities {
    #[cfg(target_os = "linux")]
    { linux::capabilities() }
    #[cfg(target_os = "macos")]
    { macos::capabilities() }
    #[cfg(target_os = "windows")]
    { windows::capabilities() }
    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    { unsupported::capabilities() }
}

pub fn open_external_url(url: &str) -> Result<(), String> {
    let trimmed = url.trim();
    if !(trimmed.starts_with("https://") || trimmed.starts_with("http://") || trimmed.starts_with("mochi://")) {
        return Err("Only http(s) and Mochi URLs can be opened externally.".into());
    }

    #[cfg(target_os = "linux")]
    { return linux::open_external_url(trimmed); }
    #[cfg(target_os = "macos")]
    { return macos::open_external_url(trimmed); }
    #[cfg(target_os = "windows")]
    { return windows::open_external_url(trimmed).and(Ok(())).map(|_| ()).map_err(|error| format!("Unable to open the external URL: {error}")); }
    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    { Err("Opening external URLs is not supported on this platform.".into()) }
}

pub fn send_system_notification(title: &str, body: &str) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    { return linux::send_system_notification(title, body); }
    #[cfg(target_os = "macos")]
    { return macos::send_system_notification(title, body); }
    #[cfg(target_os = "windows")]
    { return windows::send_system_notification(title, body); }
    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    { unsupported::send_system_notification(title, body) }
}
