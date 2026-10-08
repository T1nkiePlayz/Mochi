use super::{FlatpakApp, PlatformCapabilities};
use std::process::Command;

pub fn capabilities() -> PlatformCapabilities {
    PlatformCapabilities {
        platform: "windows".into(),
        display_name: "Windows".into(),
        launch_methods: vec!["file".into(), "custom".into()],
        supports_flatpak: false,
        supports_app_bundles: false,
        supports_startup: false,
        supports_system_notifications: false,
    }
}

pub fn ensure_platform_integration() -> Result<(), String> { Ok(()) }
pub fn list_flatpaks() -> Result<Vec<FlatpakApp>, String> { Err("Installed Flatpak discovery is not supported on Windows.".into()) }
pub fn set_launch_on_startup(_enabled: bool) -> Result<(), String> { Err("Launch on startup is not implemented on Windows.".into()) }

pub fn launch_game(target: &str) -> Result<(), String> {
    let target = target.trim();
    if target.is_empty() { return Err("Launch target is empty.".into()); }
    if target.starts_with("http://") || target.starts_with("https://") || target.starts_with("steam://") || target.starts_with("heroic://") || target.starts_with("lutris:") || target.starts_with("bottles:") || target.starts_with("itch://") || target.starts_with("mochi://") {
        return open_external_url(target);
    }
    if target.ends_with(".bat") || target.ends_with(".cmd") {
        return Command::new("cmd").args(["/C", target]).spawn().map(|_| ()).map_err(|e| format!("Failed to launch Windows script: {e}"));
    }
    Command::new("cmd").args(["/C", "start", "", target]).spawn().map(|_| ()).map_err(|e| format!("Failed to launch Windows application: {e}"))
}

pub fn open_external_url(url: &str) -> Result<(), String> {
    // Not routed through cmd.exe: `&` in a URL (or a crafted one) would be treated as a command separator.
    Command::new("rundll32").args(["url.dll,FileProtocolHandler", url]).spawn().map(|_| ()).map_err(|error| format!("Unable to open the external URL: {error}"))
}

pub fn send_system_notification(_title: &str, _body: &str) -> Result<(), String> {
    Err("System notifications are not implemented on Windows.".into())
}
