//! Remembers the main window's size, position and maximised state across launches.
//!
//! Positions are stored in physical pixels and sizes in logical pixels (so a different display scale
//! does not grow or shrink the window). On restore the saved rectangle is checked against the monitors
//! that exist now: a window saved on an unplugged display is re-centred instead of opening off-screen.
//! Wayland compositors do not report window positions; then only the size is restored.

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tauri::{Manager, WebviewWindow};

const FILE: &str = "window-state.json";
/// A saved window must show at least this much of its title strip on a monitor to keep its position.
const MIN_VISIBLE_W: i32 = 120;
const MIN_VISIBLE_H: i32 = 40;

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
pub struct WindowState {
    pub x: Option<i32>,
    pub y: Option<i32>,
    /// Logical pixels.
    pub width: f64,
    pub height: f64,
    pub maximized: bool,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Area {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

#[derive(Debug, PartialEq)]
pub struct Placement {
    pub width: f64,
    pub height: f64,
    pub position: Option<(i32, i32)>,
    pub maximized: bool,
}

fn overlap(a: Area, b: Area) -> (i32, i32) {
    let w = (a.x + a.w).min(b.x + b.w) - a.x.max(b.x);
    let h = (a.y + a.h).min(b.y + b.h) - a.y.max(b.y);
    (w, h)
}

/// Decides where to open the window. `monitors` are work areas in physical pixels, `scale` the window's
/// current display scale, `min` the minimum logical size from tauri.conf.json.
pub fn plan(state: &WindowState, monitors: &[Area], scale: f64, min: (f64, f64)) -> Placement {
    let scale = if scale.is_finite() && scale > 0.0 { scale } else { 1.0 };
    let largest = monitors.iter().map(|m| (m.w as f64 / scale, m.h as f64 / scale)).fold((f64::MAX, f64::MAX), |acc, m| (if acc.0 == f64::MAX { m.0 } else { acc.0.max(m.0) }, if acc.1 == f64::MAX { m.1 } else { acc.1.max(m.1) }));
    let clamp = |value: f64, lo: f64, hi: f64| if hi < lo { lo } else { value.clamp(lo, hi) };
    let width = clamp(state.width, min.0, largest.0);
    let height = clamp(state.height, min.1, largest.1);
    let position = match (state.x, state.y) {
        (Some(x), Some(y)) => {
            let strip = Area { x, y, w: (width * scale) as i32, h: MIN_VISIBLE_H };
            let visible = monitors.iter().any(|m| { let (w, h) = overlap(strip, *m); w >= MIN_VISIBLE_W.min(strip.w) && h >= MIN_VISIBLE_H });
            if visible { Some((x, y)) } else { None }
        }
        _ => None,
    };
    Placement { width, height, position, maximized: state.maximized }
}

fn path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    crate::themes::config_dir(app).ok().map(|dir| dir.join(FILE))
}

fn load(app: &tauri::AppHandle) -> Option<WindowState> {
    let state: WindowState = serde_json::from_slice(&std::fs::read(path(app)?).ok()?).ok()?;
    (state.width.is_finite() && state.height.is_finite() && state.width >= 100.0 && state.height >= 100.0 && state.width < 20000.0 && state.height < 20000.0).then_some(state)
}

fn monitors(window: &WebviewWindow) -> Vec<Area> {
    window.available_monitors().unwrap_or_default().iter().map(|m| {
        let (p, s) = (m.position(), m.size());
        Area { x: p.x, y: p.y, w: s.width as i32, h: s.height as i32 }
    }).collect()
}

/// Applies the saved geometry. Never fails: any problem leaves the window at its configured default.
pub fn restore(window: &WebviewWindow, min: (f64, f64)) {
    let Some(state) = load(window.app_handle()) else { return };
    let areas = monitors(window);
    let scale = window.scale_factor().unwrap_or(1.0);
    let placement = plan(&state, &areas, scale, min);
    let _ = window.set_size(tauri::LogicalSize::new(placement.width, placement.height));
    match placement.position {
        Some((x, y)) => { let _ = window.set_position(tauri::PhysicalPosition::new(x, y)); }
        None => { let _ = window.center(); }
    }
    if placement.maximized { let _ = window.maximize(); }
}

static GENERATION: AtomicU64 = AtomicU64::new(0);

fn save_now(window: &WebviewWindow) {
    // Minimised or fullscreen (Big Picture) windows have meaningless geometry; keep the last good state.
    if window.is_minimized().unwrap_or(false) || window.is_fullscreen().unwrap_or(false) { return; }
    let app = window.app_handle();
    let Some(file) = path(app) else { return };
    let scale = window.scale_factor().unwrap_or(1.0);
    let maximized = window.is_maximized().unwrap_or(false);
    let previous = load(app);
    let state = if maximized {
        match previous { Some(old) => WindowState { maximized: true, ..old }, None => return }
    } else {
        let Ok(size) = window.inner_size() else { return };
        let pos = window.outer_position().ok();
        WindowState { x: pos.map(|p| p.x), y: pos.map(|p| p.y), width: size.width as f64 / scale, height: size.height as f64 / scale, maximized: false }
    };
    if let Ok(json) = serde_json::to_vec_pretty(&state) { let _ = std::fs::write(file, json); }
}

/// Called on every resize/move; writes once the window has been still for a moment.
pub fn schedule_save(window: &WebviewWindow) {
    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    let window = window.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(600));
        if GENERATION.load(Ordering::SeqCst) == generation { save_now(&window); }
    });
}

pub fn save_immediately(window: &WebviewWindow) { save_now(window); }

#[cfg(test)]
mod tests {
    use super::*;

    const MIN: (f64, f64) = (640.0, 480.0);
    fn state(x: i32, y: i32, w: f64, h: f64) -> WindowState { WindowState { x: Some(x), y: Some(y), width: w, height: h, maximized: false } }
    const SCREEN: Area = Area { x: 0, y: 0, w: 1920, h: 1080 };

    #[test]
    fn keeps_a_position_that_is_on_screen() {
        assert_eq!(plan(&state(100, 80, 1280.0, 800.0), &[SCREEN], 1.0, MIN).position, Some((100, 80)));
    }
    #[test]
    fn recentres_when_the_monitor_is_gone() {
        let placement = plan(&state(2500, 100, 1280.0, 800.0), &[SCREEN], 1.0, MIN);
        assert_eq!(placement.position, None);
        assert_eq!((placement.width, placement.height), (1280.0, 800.0));
    }
    #[test]
    fn follows_a_second_monitor_when_present() {
        let second = Area { x: 1920, y: 0, w: 1920, h: 1080 };
        assert_eq!(plan(&state(2500, 100, 1280.0, 800.0), &[SCREEN, second], 1.0, MIN).position, Some((2500, 100)));
    }
    #[test]
    fn rejects_a_title_bar_hidden_above_the_screen() {
        assert_eq!(plan(&state(100, -500, 1280.0, 800.0), &[SCREEN], 1.0, MIN).position, None);
    }
    #[test]
    fn clamps_the_size_to_the_screen_and_the_minimum() {
        let big = plan(&state(0, 0, 5000.0, 4000.0), &[SCREEN], 1.0, MIN);
        assert_eq!((big.width, big.height), (1920.0, 1080.0));
        let small = plan(&state(0, 0, 100.0, 100.0), &[SCREEN], 1.0, MIN);
        assert_eq!((small.width, small.height), (640.0, 480.0));
    }
    #[test]
    fn uses_logical_size_on_hidpi() {
        let retina = Area { x: 0, y: 0, w: 3024, h: 1964 };
        let placement = plan(&state(0, 0, 2000.0, 1500.0), &[retina], 2.0, MIN);
        assert_eq!((placement.width, placement.height), (1512.0, 982.0));
    }
    #[test]
    fn no_monitor_info_keeps_the_saved_size() {
        let placement = plan(&state(0, 0, 1000.0, 700.0), &[], 1.0, MIN);
        assert_eq!((placement.width, placement.height, placement.position), (1000.0, 700.0, None));
    }
}
