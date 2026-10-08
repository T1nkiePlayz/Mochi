use super::{FlatpakApp, PlatformCapabilities};

pub fn capabilities() -> PlatformCapabilities {
    PlatformCapabilities {
        platform: "other".into(),
        display_name: "Unsupported platform".into(),
        launch_methods: vec!["file".into(), "custom".into()],
        supports_flatpak: false,
        supports_app_bundles: false,
        supports_startup: false,
        supports_system_notifications: false,
    }
}
pub fn list_flatpaks() -> Result<Vec<FlatpakApp>, String> { Err("Installed Flatpak discovery is not supported on this platform.".into()) }
pub fn launch_game(_target: &str) -> Result<(), String> { Err("Mochi does not currently support launching games on this platform.".into()) }
pub fn ensure_platform_integration() -> Result<(), String> { Ok(()) }
pub fn set_launch_on_startup(_enabled: bool) -> Result<(), String> { Err("Launch on startup is not implemented on this platform.".into()) }
pub fn open_external_url(_url: &str) -> Result<(), String> { Err("Opening external URLs is not supported on this platform.".into()) }
pub fn send_system_notification(_title: &str, _body: &str) -> Result<(), String> { Err("System notifications are not implemented on this platform.".into()) }
