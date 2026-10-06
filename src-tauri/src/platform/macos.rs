use super::{FlatpakApp, PlatformCapabilities};

pub fn capabilities() -> PlatformCapabilities {
    PlatformCapabilities {
        platform: "macos".into(),
        display_name: "macOS".into(),
        launch_methods: vec!["file".into(), "custom".into()],
        supports_flatpak: false,
        supports_app_bundles: true,
    }
}

pub fn list_flatpaks() -> Result<Vec<FlatpakApp>, String> {
    Err("Flatpak discovery is not available on macOS.".into())
}

pub fn launch_game(target: &str) -> Result<(), String> {
    if target.is_empty() {
        return Err("Launch target is empty.".into());
    }

    if target.ends_with(".app") {
        std::process::Command::new("open")
            .arg(target)
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("Failed to launch macOS application: {e}"))
    } else if target.ends_with(".sh") || target.ends_with(".bash") {
        std::process::Command::new("sh")
            .arg(target)
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("Failed to launch shell script: {e}"))
    } else {
        std::process::Command::new(target)
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("Failed to launch game or executable: {e}"))
    }
}
