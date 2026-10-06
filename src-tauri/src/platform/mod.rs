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
}

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(not(any(target_os = "linux", target_os = "macos")))]
mod other;

pub fn launch_game(target: &str) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    { linux::launch_game(target) }

    #[cfg(target_os = "macos")]
    { macos::launch_game(target) }

    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    { other::launch_game(target) }
}

pub fn list_flatpaks() -> Result<Vec<FlatpakApp>, String> {
    #[cfg(target_os = "linux")]
    { linux::list_flatpaks() }

    #[cfg(target_os = "macos")]
    { macos::list_flatpaks() }

    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    { other::list_flatpaks() }
}

pub fn capabilities() -> PlatformCapabilities {
    #[cfg(target_os = "linux")]
    { linux::capabilities() }

    #[cfg(target_os = "macos")]
    { macos::capabilities() }

    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    { other::capabilities() }
}
