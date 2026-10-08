use crate::playtime;
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

pub fn build_menu(app: &tauri::AppHandle) -> Result<Menu<tauri::Wry>, tauri::Error> {
    let open = MenuItem::with_id(app, "tray-open", "Open Mochi", true, None::<&str>)?;
    let big_picture = MenuItem::with_id(app, "tray-bigpicture", "Open Big Picture", true, None::<&str>)?;
    let title = MenuItem::with_id(app, "tray-title", "Most played", false, None::<&str>)?;

    let mut builder = tauri::menu::MenuBuilder::new(app);
    builder = builder.item(&open).item(&big_picture).item(&title);
    let games = playtime::list().unwrap_or_default();

    if games.is_empty() {
        let empty = MenuItem::with_id(app, "tray-empty", "No games played yet", false, None::<&str>)?;
        builder = builder.item(&empty);
    } else {
        for (index, game) in games.into_iter().take(5).enumerate() {
            let label = format!("{}. {} — {}", index + 1, game.name, format_playtime(game.seconds));
            let item = MenuItem::with_id(app, format!("tray-game-{}", index + 1), label, false, None::<&str>)?;
            builder = builder.item(&item);
        }
    }

    let quit = MenuItem::with_id(app, "tray-quit", "Quit Mochi", true, None::<&str>)?;
    builder.item(&quit).build()
}

pub fn initialize(app: &mut tauri::App) -> Result<(), tauri::Error> {
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
            _ => {}
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
