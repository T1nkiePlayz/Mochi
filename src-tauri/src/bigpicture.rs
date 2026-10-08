//! Big Picture mode and Steam Deck support: launch flags, device detection,
//! battery status, and power actions. Everything here is read-only, cheap, and
//! degrades to "unknown" rather than failing.

use serde::Serialize;
use std::{
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

// ---------------------------------------------------------------------------
// Launch flags
// ---------------------------------------------------------------------------

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchFlags {
    /// `--big-picture` or a `mochi://bigpicture` link.
    pub big_picture: bool,
    /// Started by the desktop session at login.
    pub autostart: bool,
}

pub fn parse_flags<I, S>(args: I) -> LaunchFlags
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let mut flags = LaunchFlags::default();
    for arg in args {
        match arg.as_ref().trim().to_ascii_lowercase().as_str() {
            "--big-picture" | "--bigpicture" | "--console" => flags.big_picture = true,
            "--autostart" => flags.autostart = true,
            link if link.starts_with("mochi://bigpicture") => flags.big_picture = true,
            _ => {}
        }
    }
    flags
}

// ---------------------------------------------------------------------------
// Steam Deck detection
// ---------------------------------------------------------------------------

pub fn deck_from_dmi(product_name: &str, board_name: &str) -> bool {
    let is_deck = |value: &str| matches!(value.trim(), "Jupiter" | "Galileo");
    is_deck(product_name) || is_deck(board_name)
}

pub fn deck_from_os_release(text: &str) -> bool {
    text.lines().any(|line| {
        let Some((key, value)) = line.split_once('=') else { return false };
        let value = value.trim().trim_matches('"').to_ascii_lowercase();
        (key == "ID" && value == "steamos") || (key == "VARIANT_ID" && value == "steamdeck") || (key == "SteamDeck" && value == "1")
    })
}

pub fn gamescope_from_env(get: impl Fn(&str) -> Option<String>) -> bool {
    let lower = |name: &str| get(name).map(|value| value.to_ascii_lowercase()).unwrap_or_default();
    get("GAMESCOPE_WAYLAND_DISPLAY").is_some_and(|value| !value.is_empty())
        || lower("XDG_CURRENT_DESKTOP").split(':').any(|part| part == "gamescope")
        || lower("XDG_SESSION_DESKTOP") == "gamescope"
}

pub fn is_steam_deck() -> bool {
    static CACHE: OnceLock<bool> = OnceLock::new();
    *CACHE.get_or_init(detect_steam_deck)
}

pub fn is_gamescope() -> bool { gamescope_from_env(|name| std::env::var(name).ok()) }

#[cfg(target_os = "linux")]
fn detect_steam_deck() -> bool {
    use std::fs;
    let dmi = |file: &str| fs::read_to_string(format!("/sys/class/dmi/id/{file}")).unwrap_or_default();
    deck_from_dmi(&dmi("product_name"), &dmi("board_name"))
        || std::env::var("SteamDeck").is_ok_and(|value| value == "1")
        || fs::read_to_string("/etc/os-release").is_ok_and(|text| deck_from_os_release(&text))
}

#[cfg(not(target_os = "linux"))]
fn detect_steam_deck() -> bool { false }

// ---------------------------------------------------------------------------
// Battery
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SystemStatus {
    pub has_battery: bool,
    pub battery_percent: Option<u8>,
    pub charging: Option<bool>,
}

impl SystemStatus {
    const NONE: SystemStatus = SystemStatus { has_battery: false, battery_percent: None, charging: None };
}

/// Parses `pmset -g batt` output such as
/// `Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1) 87%; discharging; 4:12 remaining present: true`.
pub fn parse_pmset(text: &str) -> SystemStatus {
    let Some(line) = text.lines().find(|line| line.contains('%')) else { return SystemStatus::NONE };
    let percent = line.split('%').next().and_then(|head| {
        let digits: String = head.chars().rev().take_while(|c| c.is_ascii_digit()).collect::<Vec<_>>().into_iter().rev().collect();
        digits.parse::<u16>().ok()
    });
    let lower = line.to_ascii_lowercase();
    let charging = if lower.contains("discharging") { Some(false) } else if lower.contains("charging") || lower.contains("charged") || lower.contains("finishing charge") { Some(true) } else { None };
    SystemStatus { has_battery: percent.is_some(), battery_percent: percent.map(|value| value.min(100) as u8), charging }
}

/// Interprets one `/sys/class/power_supply/*` entry; `None` when it is not the system battery.
pub fn parse_power_supply(kind: &str, scope: &str, capacity: &str, status: &str) -> Option<SystemStatus> {
    if kind.trim() != "Battery" || scope.trim().eq_ignore_ascii_case("Device") { return None; }
    let percent = capacity.trim().parse::<u16>().ok()?.min(100) as u8;
    let charging = match status.trim() {
        "Charging" | "Full" => Some(true),
        "Discharging" => Some(false),
        _ => None,
    };
    Some(SystemStatus { has_battery: true, battery_percent: Some(percent), charging })
}

#[cfg(target_os = "linux")]
fn read_status() -> SystemStatus {
    use std::fs;
    let Ok(entries) = fs::read_dir("/sys/class/power_supply") else { return SystemStatus::NONE };
    for entry in entries.flatten() {
        let path = entry.path();
        let read = |file: &str| fs::read_to_string(path.join(file)).unwrap_or_default();
        if let Some(status) = parse_power_supply(&read("type"), &read("scope"), &read("capacity"), &read("status")) { return status; }
    }
    SystemStatus::NONE
}

#[cfg(target_os = "macos")]
fn read_status() -> SystemStatus {
    let mut command = std::process::Command::new("/usr/bin/pmset");
    command.args(["-g", "batt"]);
    crate::platform::run_capture(command, Duration::from_secs(2)).map(|bytes| parse_pmset(&String::from_utf8_lossy(&bytes))).unwrap_or(SystemStatus::NONE)
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
fn read_status() -> SystemStatus { SystemStatus::NONE }

#[tauri::command(async)]
pub fn get_system_status() -> SystemStatus {
    static CACHE: Mutex<Option<(Instant, SystemStatus)>> = Mutex::new(None);
    let Ok(mut cache) = CACHE.lock() else { return SystemStatus::NONE };
    if let Some((at, status)) = cache.as_ref() {
        if at.elapsed() < Duration::from_secs(10) { return status.clone(); }
    }
    let status = read_status();
    *cache = Some((Instant::now(), status.clone()));
    status
}

// ---------------------------------------------------------------------------
// Power actions and launch flags commands
// ---------------------------------------------------------------------------

#[tauri::command(async)]
pub fn suspend_system() -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        if !crate::platform::command_exists("systemctl") { return Err("Suspend is not available on this system.".into()); }
        let status = std::process::Command::new("systemctl").arg("suspend").status().map_err(|error| format!("Unable to suspend: {error}"))?;
        if status.success() { Ok(()) } else { Err("The system refused to suspend.".into()) }
    }
    #[cfg(target_os = "macos")]
    {
        let status = std::process::Command::new("/usr/bin/pmset").arg("sleepnow").status().map_err(|error| format!("Unable to sleep: {error}"))?;
        if status.success() { Ok(()) } else { Err("macOS refused to sleep.".into()) }
    }
}

#[tauri::command]
pub fn quit_mochi(app: tauri::AppHandle) { app.exit(0); }

/// What this process was started with, for the frontend to read once at boot.
pub fn boot_script(flags: LaunchFlags) -> String {
    let boot = serde_json::json!({
        "bigPicture": flags.big_picture,
        "autostart": flags.autostart,
        "steamDeck": is_steam_deck(),
        "gamescope": is_gamescope(),
    });
    format!("window.__MOCHI_BOOT__ = {boot};")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_launch_flags() {
        assert_eq!(parse_flags(["mochi", "--big-picture"]), LaunchFlags { big_picture: true, autostart: false });
        assert_eq!(parse_flags(["mochi", "--autostart"]), LaunchFlags { big_picture: false, autostart: true });
        assert!(parse_flags(["mochi", "mochi://bigpicture"]).big_picture);
        assert_eq!(parse_flags(["mochi", "mochi://launch/abc"]), LaunchFlags::default());
    }

    #[test]
    fn detects_deck_hardware() {
        assert!(deck_from_dmi("Jupiter", ""));
        assert!(deck_from_dmi("", "Galileo\n"));
        assert!(!deck_from_dmi("ThinkPad", "20XW"));
        assert!(deck_from_os_release("NAME=\"SteamOS\"\nID=steamos\n"));
        assert!(deck_from_os_release("VARIANT_ID=steamdeck"));
        assert!(!deck_from_os_release("ID=arch\n"));
    }

    #[test]
    fn detects_gamescope() {
        let env = |pairs: &'static [(&'static str, &'static str)]| move |name: &str| pairs.iter().find(|(key, _)| *key == name).map(|(_, value)| value.to_string());
        assert!(gamescope_from_env(env(&[("GAMESCOPE_WAYLAND_DISPLAY", "gamescope-0")])));
        assert!(gamescope_from_env(env(&[("XDG_CURRENT_DESKTOP", "gamescope")])));
        assert!(!gamescope_from_env(env(&[("XDG_CURRENT_DESKTOP", "KDE")])));
        assert!(!gamescope_from_env(env(&[])));
    }

    #[test]
    fn parses_pmset() {
        let text = "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=4653155)\t87%; discharging; 4:12 remaining present: true\n";
        assert_eq!(parse_pmset(text), SystemStatus { has_battery: true, battery_percent: Some(87), charging: Some(false) });
        let text = "Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t100%; charged; 0:00 remaining present: true";
        assert_eq!(parse_pmset(text).charging, Some(true));
        assert_eq!(parse_pmset("Now drawing from 'AC Power'\n"), SystemStatus::NONE);
    }

    #[test]
    fn parses_power_supply() {
        assert_eq!(parse_power_supply("Battery\n", "System\n", "73\n", "Charging\n"), Some(SystemStatus { has_battery: true, battery_percent: Some(73), charging: Some(true) }));
        assert_eq!(parse_power_supply("Mains", "", "", ""), None);
        assert_eq!(parse_power_supply("Battery", "Device", "50", "Discharging"), None);
    }
}
