use super::{FlatpakApp, PlatformCapabilities};

pub fn capabilities() -> PlatformCapabilities {
    PlatformCapabilities {
        platform: "other".into(),
        display_name: "Other".into(),
        launch_methods: vec!["file".into(), "custom".into()],
        supports_flatpak: false,
        supports_app_bundles: false,
    }
}

pub fn list_flatpaks() -> Result<Vec<FlatpakApp>, String> {
    Err("Installed Flatpak discovery is not supported on this platform.".into())
}

pub fn launch_game(target: &str) -> Result<(), String> {
    if target.is_empty() {
        return Err("Launch target is empty.".into());
    }

    std::process::Command::new(target)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Failed to launch game: {e}"))
}
