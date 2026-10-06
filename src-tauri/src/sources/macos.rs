use super::DetectedImportSource;
use std::{env, path::PathBuf};

pub fn detect_import_sources() -> Vec<DetectedImportSource> {
    let home = env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("."));
    let steam = home.join("Library/Application Support/Steam").exists();
    let heroic = home.join("Library/Application Support/heroic").exists();
    let lutris = home.join("Library/Application Support/lutris").exists();
    let itch = home.join("Library/Application Support/itch").exists();

    vec![
        DetectedImportSource { id: "flatpak".into(), name: "Flatpak".into(), description: "Installed games delivered through Flatpak.".into(), detected: false, game_count: Some(0) },
        DetectedImportSource { id: "steam".into(), name: "Steam".into(), description: "Games installed through Steam and its libraries.".into(), detected: steam, game_count: None },
        DetectedImportSource { id: "heroic".into(), name: "Heroic Games Launcher".into(), description: "Epic, GOG and Amazon games managed by Heroic.".into(), detected: heroic, game_count: None },
        DetectedImportSource { id: "lutris".into(), name: "Lutris".into(), description: "Existing Lutris games, runners and launch configurations.".into(), detected: lutris, game_count: None },
        DetectedImportSource { id: "bottles".into(), name: "Bottles".into(), description: "Windows games and applications inside Bottles.".into(), detected: false, game_count: None },
        DetectedImportSource { id: "itch".into(), name: "itch.io".into(), description: "Games installed with the itch desktop app.".into(), detected: itch, game_count: None },
    ]
}
