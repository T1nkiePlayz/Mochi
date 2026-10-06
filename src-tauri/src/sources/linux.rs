use super::DetectedImportSource;
use std::{env, fs, path::{Path, PathBuf}, process::Command};

fn home() -> PathBuf {
    env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("."))
}

fn exists_any(paths: &[PathBuf]) -> bool {
    paths.iter().any(|path| path.exists())
}

fn command_exists(command: &str) -> bool {
    Command::new("sh")
        .args(["-c", &format!("command -v {command}")])
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn flatpak_installed(app_id: &str) -> bool {
    Command::new("flatpak")
        .args(["info", app_id])
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn steam_game_count(home: &Path) -> u32 {
    let mut roots = vec![
        home.join(".steam/steam/steamapps"),
        home.join(".local/share/Steam/steamapps"),
        home.join(".steam/root/steamapps"),
    ];
    roots.retain(|path| path.is_dir());

    let mut count = 0;
    for root in roots {
        if let Ok(entries) = fs::read_dir(root) {
            count += entries.flatten().filter(|entry| {
                entry.file_name().to_string_lossy().starts_with("appmanifest_")
                    && entry.path().extension().and_then(|v| v.to_str()) == Some("acf")
            }).count() as u32;
        }
    }
    count
}

pub fn detect_import_sources() -> Vec<DetectedImportSource> {
    let home = home();
    let steam = exists_any(&[
        home.join(".steam"),
        home.join(".local/share/Steam"),
    ]) || command_exists("steam");

    let heroic = exists_any(&[
        home.join(".config/heroic"),
        home.join(".var/app/com.heroicgameslauncher.hgl"),
    ]) || command_exists("heroic") || flatpak_installed("com.heroicgameslauncher.hgl");

    let lutris = exists_any(&[
        home.join(".config/lutris"),
        home.join(".local/share/lutris"),
    ]) || command_exists("lutris");

    let bottles = exists_any(&[
        home.join(".var/app/com.usebottles.bottles"),
        home.join(".local/share/bottles"),
    ]) || command_exists("bottles") || flatpak_installed("com.usebottles.bottles");

    let itch = exists_any(&[
        home.join(".config/itch"),
        home.join(".config/itch.io"),
        home.join(".local/share/itch"),
        home.join(".var/app/io.itch.itch"),
    ]) || command_exists("itch");

    let flatpak_games = super::super::platform::list_flatpaks()
        .map(|apps| apps.into_iter().filter(|app| app.category == "Games").count() as u32)
        .unwrap_or(0);

    vec![
        DetectedImportSource { id: "flatpak".into(), name: "Flatpak".into(), description: "Installed games delivered through Flatpak.".into(), detected: flatpak_games > 0 || command_exists("flatpak"), game_count: Some(flatpak_games) },
        DetectedImportSource { id: "steam".into(), name: "Steam".into(), description: "Games installed through Steam and its libraries.".into(), detected: steam, game_count: if steam { Some(steam_game_count(&home)) } else { None } },
        DetectedImportSource { id: "heroic".into(), name: "Heroic Games Launcher".into(), description: "Epic, GOG and Amazon games managed by Heroic.".into(), detected: heroic, game_count: None },
        DetectedImportSource { id: "lutris".into(), name: "Lutris".into(), description: "Existing Lutris games, runners and launch configurations.".into(), detected: lutris, game_count: None },
        DetectedImportSource { id: "bottles".into(), name: "Bottles".into(), description: "Windows games and applications inside Bottles.".into(), detected: bottles, game_count: None },
        DetectedImportSource { id: "itch".into(), name: "itch.io".into(), description: "Games installed with the itch desktop app.".into(), detected: itch, game_count: None },
    ]
}
