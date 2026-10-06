use super::{FlatpakApp, PlatformCapabilities};

pub fn capabilities() -> PlatformCapabilities {
    PlatformCapabilities {
        platform: "other".into(),
        display_name: "Unsupported platform".into(),
        launch_methods: vec!["file".into(), "custom".into()],
        supports_flatpak: false,
        supports_app_bundles: false,
    }
}

pub fn list_flatpaks() -> Result<Vec<FlatpakApp>, String> {
    Err("Installed Flatpak discovery is not supported on this platform.".into())
}

pub fn launch_game(_target: &str) -> Result<(), String> {
    Err("Mochi does not currently support launching games on this platform.".into())
}
