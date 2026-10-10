use crate::playtime;
use std::sync::{atomic::{AtomicBool, Ordering}, Mutex};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager,
};

fn format_playtime(seconds: u64) -> String {
    let hours = seconds / 3600;
    let minutes = (seconds % 3600) / 60;
    if hours > 0 {
        format!("{hours}h {minutes}m")
    } else if minutes > 0 {
        format!("{minutes}m")
    } else {
        format!("{}m", (seconds / 60).max(1))
    }
}

const RECENT: usize = 5;
const MOST_PLAYED: usize = 3;

/// Game names in the clickable "Recent" section, set each time the menu is built so a click maps back to a name.
static RECENT_NAMES: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// The most recently played games, newest first; entries never played (no timestamp) are left out.
fn recent_games(games: &[playtime::PlaytimeEntry], count: usize) -> Vec<&playtime::PlaytimeEntry> {
    let mut played: Vec<_> = games.iter().filter(|game| game.last_played > 0).collect();
    played.sort_by_key(|game| std::cmp::Reverse(game.last_played));
    played.truncate(count);
    played
}

pub fn build_menu(app: &tauri::AppHandle) -> Result<Menu<tauri::Wry>, tauri::Error> {
    let open = MenuItem::with_id(app, "tray-open", "Open Mochi", true, None::<&str>)?;
    let big_picture = MenuItem::with_id(app, "tray-bigpicture", "Open Big Picture", true, None::<&str>)?;
    let title = MenuItem::with_id(app, "tray-title", "Most played", false, None::<&str>)?;
    let games = playtime::list().unwrap_or_default();

    let mut builder = tauri::menu::MenuBuilder::new(app);
    builder = builder.item(&open).item(&big_picture);
    // Quick launch: clicking a recent game asks the window to start it (it resolves the name against the library).
    let recent = recent_games(&games, RECENT);
    if !recent.is_empty() {
        builder = builder.separator().item(&MenuItem::with_id(app, "tray-recent-title", "Play recent", false, None::<&str>)?);
        for (index, game) in recent.iter().enumerate() {
            builder = builder.item(&MenuItem::with_id(app, format!("tray-launch-{index}"), format!("▶  {}", game.name), true, None::<&str>)?);
        }
    }
    if let Ok(mut names) = RECENT_NAMES.lock() { *names = recent.iter().map(|game| game.name.clone()).collect(); }
    builder = builder.separator().item(&title);

    if games.is_empty() {
        let empty = MenuItem::with_id(app, "tray-empty", "No games played yet", false, None::<&str>)?;
        builder = builder.item(&empty);
    } else {
        for (index, game) in games.into_iter().take(MOST_PLAYED).enumerate() {
            let label = format!("{}. {} — {}", index + 1, game.name, format_playtime(game.seconds));
            let item = MenuItem::with_id(app, format!("tray-game-{}", index + 1), label, false, None::<&str>)?;
            builder = builder.item(&item);
        }
    }

    let quit = MenuItem::with_id(app, "tray-quit", "Quit Mochi", true, None::<&str>)?;
    builder.item(&quit).build()
}

/// Whether closing the window may hide it: only when a tray / menu-bar icon exists to bring it back.
static HIDE_ON_CLOSE: AtomicBool = AtomicBool::new(false);

pub fn close_hides_window() -> bool { HIDE_ON_CLOSE.load(Ordering::Relaxed) }

/// Creates the tray icon. A desktop without tray support (GNOME without the AppIndicator
/// extension, a missing indicator library) must not stop Mochi from starting or leave a hidden
/// window nobody can restore, so failures only turn off close-to-tray.
pub fn initialize(app: &mut tauri::App) {
    if !crate::platform::tray_available() {
        eprintln!("Mochi: no system tray is available on this desktop; closing the window will quit Mochi.");
        return;
    }
    // Loading the indicator library can panic when it is not installed.
    let created = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| build_tray(app)));
    match created {
        Ok(Ok(())) => HIDE_ON_CLOSE.store(true, Ordering::Relaxed),
        Ok(Err(error)) => eprintln!("Mochi: unable to create the tray icon: {error}"),
        Err(_) => eprintln!("Mochi: the tray icon library is unavailable; closing the window will quit Mochi."),
    }
}

fn build_tray(app: &mut tauri::App) -> Result<(), tauri::Error> {
    let menu = build_menu(app.handle())?;
    let icon = app
        .default_window_icon()
        .cloned()
        .expect("Mochi must have a default application icon for the tray");

    TrayIconBuilder::with_id("mochi-tray")
        .icon(icon)
        .tooltip("Mochi")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "tray-open" => show_mochi(app),
            "tray-bigpicture" => { show_mochi(app); let _ = app.emit("mochi-bigpicture", true); }
            "tray-quit" => app.exit(0),
            id => {
                let name = id.strip_prefix("tray-launch-").and_then(|n| n.parse::<usize>().ok())
                    .and_then(|index| RECENT_NAMES.lock().ok().and_then(|names| names.get(index).cloned()));
                if let Some(name) = name { show_mochi(app); let _ = app.emit("mochi-tray-launch", name); }
            }
        })
        .on_tray_icon_event(|tray, event| {
            use tauri::tray::{MouseButton, MouseButtonState, TrayIconEvent};
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_mochi(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

pub fn refresh(app: &tauri::AppHandle) -> Result<(), tauri::Error> {
    if let Some(tray) = app.tray_by_id("mochi-tray") {
        let menu = build_menu(app)?;
        tray.set_menu(Some(menu))?;
    }
    Ok(())
}

pub fn show_mochi(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(name: &str, last_played: u64) -> playtime::PlaytimeEntry {
        playtime::PlaytimeEntry { game_id: name.into(), name: name.into(), seconds: 60, last_played }
    }

    #[test]
    fn recent_games_are_newest_first_capped_and_skip_unplayed() {
        let games = [entry("old", 10), entry("never", 0), entry("new", 30), entry("mid", 20)];
        let names: Vec<_> = recent_games(&games, 2).iter().map(|g| g.name.as_str()).collect();
        assert_eq!(names, ["new", "mid"]);
    }
}
