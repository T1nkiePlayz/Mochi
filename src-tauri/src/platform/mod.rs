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
mod unsupported;

#[cfg(target_os = "linux")]
pub fn ensure_desktop_entry() -> Result<(), String> {
    linux::ensure_desktop_entry()
}

pub fn set_launch_on_startup(enabled: bool) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        return linux::set_launch_on_startup(enabled);
    }
    #[cfg(target_os = "macos")]
    {
        return macos::set_launch_on_startup(enabled);
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    {
        return unsupported::set_launch_on_startup(enabled);
    }
}

pub fn launch_game(target: &str) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    { linux::launch_game(target) }

    #[cfg(target_os = "macos")]
    { macos::launch_game(target) }

    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    { unsupported::launch_game(target) }
}

pub fn list_flatpaks() -> Result<Vec<FlatpakApp>, String> {
    #[cfg(target_os = "linux")]
    { linux::list_flatpaks() }

    #[cfg(target_os = "macos")]
    { macos::list_flatpaks() }

    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    { unsupported::list_flatpaks() }
}

pub fn capabilities() -> PlatformCapabilities {
    #[cfg(target_os = "linux")]
    { linux::capabilities() }

    #[cfg(target_os = "macos")]
    { macos::capabilities() }

    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    { unsupported::capabilities() }
}


pub fn open_external_url(url: &str) -> Result<(), String> {
    let trimmed = url.trim();
    if !(trimmed.starts_with("https://") || trimmed.starts_with("http://") || trimmed.starts_with("mochi://")) {
        return Err("Only http(s) and Mochi URLs can be opened externally.".into());
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open").arg(trimmed).spawn()
            .map_err(|error| format!("Unable to open the external URL: {error}"))?;
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open").arg(trimmed).spawn()
            .map_err(|error| format!("Unable to open the external URL: {error}"))?;
        return Ok(());
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd").args(["/C", "start", "", trimmed]).spawn()
            .map_err(|error| format!("Unable to open the external URL: {error}"))?;
        return Ok(());
    }
    #[allow(unreachable_code)]
    Err("Opening external URLs is not supported on this platform.".into())
}
