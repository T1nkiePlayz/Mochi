//! Big Picture mode and Steam Deck support: launch flags, device detection,
//! battery status, and power actions. Everything here is read-only, cheap, and
//! degrades to "unknown" rather than failing.

use serde::{Deserialize, Serialize};
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
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn parse_pmset(text: &str) -> SystemStatus {
    let Some(line) = text.lines().find(|line| line.contains('%')) else { return SystemStatus::NONE };
    let percent = line.split('%').next().and_then(|head| {
        let digits: String = head.chars().rev().take_while(|c| c.is_ascii_digit()).collect::<Vec<_>>().into_iter().rev().collect();
        digits.parse::<u16>().ok()
    });
    let lower = line.to_ascii_lowercase();
    // "not charging" (AC attached but the battery is held, e.g. optimised charging) also contains "charging".
    let charging = if lower.contains("discharging") || lower.contains("not charging") { Some(false) } else if lower.contains("charging") || lower.contains("charged") || lower.contains("finishing charge") { Some(true) } else { None };
    SystemStatus { has_battery: percent.is_some(), battery_percent: percent.map(|value| value.min(100) as u8), charging }
}

/// Interprets one `/sys/class/power_supply/*` entry; `None` when it is not the system battery.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
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

/// A system power action offered by the Big Picture menu.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PowerAction { Suspend, Restart, Shutdown }

impl PowerAction {
    fn verb(self) -> &'static str {
        match self { PowerAction::Suspend => "suspend", PowerAction::Restart => "restart", PowerAction::Shutdown => "shut down" }
    }
}

#[cfg_attr(not(any(target_os = "linux", target_os = "macos")), allow(dead_code))]
/// The program and arguments that perform a power action.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PowerCommand { pub program: &'static str, pub args: Vec<&'static str> }

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
/// What a Linux machine offers for power management. `can` is logind's answer to CanSuspend/CanReboot/CanPowerOff
/// (`None` when it could not be asked).
#[derive(Debug, Clone, Copy, Default)]
pub struct LinuxPower { pub systemctl: bool, pub loginctl: bool }

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
/// Linux: systemd-logind through `systemctl` (falls back to `loginctl`, which elogind systems also ship).
pub fn linux_power_command(action: PowerAction, env: LinuxPower) -> Option<PowerCommand> {
    let verb = match action { PowerAction::Suspend => "suspend", PowerAction::Restart => "reboot", PowerAction::Shutdown => "poweroff" };
    let program = if env.systemctl { "systemctl" } else if env.loginctl { "loginctl" } else { return None };
    Some(PowerCommand { program, args: vec![verb] })
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
/// macOS: `pmset sleepnow` sleeps without any permission; restart and shut down go through System Events,
/// which macOS gates behind the Automation privacy permission (asked once).
pub fn macos_power_command(action: PowerAction) -> PowerCommand {
    match action {
        PowerAction::Suspend => PowerCommand { program: "/usr/bin/pmset", args: vec!["sleepnow"] },
        PowerAction::Restart => PowerCommand { program: "/usr/bin/osascript", args: vec!["-e", "tell application \"System Events\" to restart"] },
        PowerAction::Shutdown => PowerCommand { program: "/usr/bin/osascript", args: vec!["-e", "tell application \"System Events\" to shut down"] },
    }
}

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
/// Reads `busctl call ... CanSuspend` output (`s "yes"`); "na" and "no" mean the action is unavailable here.
pub fn parse_login1_can(text: &str) -> Option<bool> {
    let value = text.trim().strip_prefix("s ")?.trim().trim_matches('"');
    match value { "yes" | "challenge" => Some(true), "no" | "na" => Some(false), _ => None }
}

/// Turns a failed power command's output into something a person can act on.
pub fn describe_power_error(action: PowerAction, macos: bool, output: &str) -> String {
    let verb = action.verb();
    let lower = output.to_ascii_lowercase();
    if macos {
        if lower.contains("-1743") || lower.contains("not authorized to send apple events") || lower.contains("not allowed to send") {
            return format!("macOS blocked Mochi from asking to {verb}. Allow Mochi to control System Events in System Settings > Privacy & Security > Automation, then try again.");
        }
        if lower.contains("-128") || lower.contains("user canceled") || lower.contains("user cancelled") { return format!("The request to {verb} was cancelled."); }
    } else {
        if lower.contains("interactive authentication required") || lower.contains("access denied") || lower.contains("not authorized") || lower.contains("permission denied") {
            return format!("Your system needs administrator permission to {verb} (polkit refused the request). Use your desktop's power menu, or allow it in your polkit rules.");
        }
        if lower.contains("inhibit") { return format!("Another program is preventing the system from trying to {verb} right now. Close it and try again."); }
    }
    let detail = output.lines().map(str::trim).find(|line| !line.is_empty()).unwrap_or("");
    if detail.is_empty() { format!("The system refused to {verb}.") } else { format!("The system refused to {verb}: {}", detail.chars().take(200).collect::<String>()) }
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PowerCapabilities { pub suspend: bool, pub restart: bool, pub shutdown: bool }

#[cfg(target_os = "linux")]
fn linux_env() -> LinuxPower {
    LinuxPower {
        systemctl: crate::platform::command_exists("systemctl") && std::path::Path::new("/run/systemd/system").exists(),
        loginctl: crate::platform::command_exists("loginctl"),
    }
}

#[cfg(target_os = "linux")]
fn login1_can(method: &str) -> Option<bool> {
    if !crate::platform::command_exists("busctl") { return None; }
    let mut command = std::process::Command::new("busctl");
    command.args(["--system", "call", "org.freedesktop.login1", "/org/freedesktop/login1", "org.freedesktop.login1.Manager", method]);
    crate::platform::run_capture(command, Duration::from_secs(2)).and_then(|bytes| parse_login1_can(&String::from_utf8_lossy(&bytes)))
}

fn power_command(action: PowerAction) -> Option<PowerCommand> {
    #[cfg(target_os = "linux")]
    { linux_power_command(action, linux_env()) }
    #[cfg(target_os = "macos")]
    { Some(macos_power_command(action)) }
    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    { let _ = action; None }
}

#[tauri::command(async)]
pub fn get_power_capabilities() -> PowerCapabilities {
    #[cfg(target_os = "linux")]
    {
        let env = linux_env();
        let usable = |method: &str| (env.systemctl || env.loginctl) && login1_can(method).unwrap_or(true);
        PowerCapabilities { suspend: usable("CanSuspend"), restart: usable("CanReboot"), shutdown: usable("CanPowerOff") }
    }
    #[cfg(target_os = "macos")]
    { PowerCapabilities { suspend: true, restart: true, shutdown: true } }
    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    { PowerCapabilities { suspend: false, restart: false, shutdown: false } }
}

#[tauri::command(async)]
pub fn power_action(action: PowerAction) -> Result<(), String> {
    let Some(command) = power_command(action) else { return Err(format!("This system cannot {} from Mochi.", action.verb())) };
    let output = std::process::Command::new(command.program).args(&command.args).output()
        .map_err(|error| format!("Unable to {}: {error}", action.verb()))?;
    if output.status.success() { return Ok(()); }
    let text = format!("{}\n{}", String::from_utf8_lossy(&output.stderr), String::from_utf8_lossy(&output.stdout));
    Err(describe_power_error(action, cfg!(target_os = "macos"), &text))
}

/// Kept for older frontends; same as `power_action("suspend")`.
#[tauri::command(async)]
pub fn suspend_system() -> Result<(), String> { power_action(PowerAction::Suspend) }

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
        let held = " -InternalBattery-0 (id=1)\t80%; AC attached; not charging present: true";
        assert_eq!(parse_pmset(held).charging, Some(false));
        let charging = " -InternalBattery-0 (id=1)\t55%; charging; 1:10 remaining present: true";
        assert_eq!(parse_pmset(charging).charging, Some(true));
        assert_eq!(parse_pmset("garbage % %% é%").battery_percent, None);
    }

    #[test]
    fn parses_power_supply() {
        assert_eq!(parse_power_supply("Battery\n", "System\n", "73\n", "Charging\n"), Some(SystemStatus { has_battery: true, battery_percent: Some(73), charging: Some(true) }));
        assert_eq!(parse_power_supply("Mains", "", "", ""), None);
        assert_eq!(parse_power_supply("Battery", "Device", "50", "Discharging"), None);
    }

    #[test]
    fn picks_linux_power_commands() {
        let both = LinuxPower { systemctl: true, loginctl: true };
        assert_eq!(linux_power_command(PowerAction::Suspend, both), Some(PowerCommand { program: "systemctl", args: vec!["suspend"] }));
        assert_eq!(linux_power_command(PowerAction::Restart, both).unwrap().args, vec!["reboot"]);
        assert_eq!(linux_power_command(PowerAction::Shutdown, both).unwrap().args, vec!["poweroff"]);
        let elogind = LinuxPower { systemctl: false, loginctl: true };
        assert_eq!(linux_power_command(PowerAction::Shutdown, elogind), Some(PowerCommand { program: "loginctl", args: vec!["poweroff"] }));
        assert_eq!(linux_power_command(PowerAction::Suspend, LinuxPower::default()), None);
    }

    #[test]
    fn picks_macos_power_commands() {
        assert_eq!(macos_power_command(PowerAction::Suspend), PowerCommand { program: "/usr/bin/pmset", args: vec!["sleepnow"] });
        let restart = macos_power_command(PowerAction::Restart);
        assert_eq!(restart.program, "/usr/bin/osascript");
        assert!(restart.args[1].ends_with("to restart"));
        assert!(macos_power_command(PowerAction::Shutdown).args[1].ends_with("to shut down"));
    }

    #[test]
    fn reads_login1_answers() {
        assert_eq!(parse_login1_can("s \"yes\"\n"), Some(true));
        assert_eq!(parse_login1_can("s \"challenge\""), Some(true));
        assert_eq!(parse_login1_can("s \"na\""), Some(false));
        assert_eq!(parse_login1_can("s \"no\""), Some(false));
        assert_eq!(parse_login1_can("garbage"), None);
    }

    #[test]
    fn explains_power_errors() {
        assert!(describe_power_error(PowerAction::Suspend, false, "Failed to suspend system via logind: Interactive authentication required.").contains("polkit"));
        assert!(describe_power_error(PowerAction::Shutdown, false, "Operation inhibited by \"Steam\"").contains("preventing"));
        assert!(describe_power_error(PowerAction::Restart, true, "execution error: Not authorized to send Apple events to System Events. (-1743)").contains("Automation"));
        assert!(describe_power_error(PowerAction::Restart, true, "execution error: User canceled. (-128)").contains("cancelled"));
        assert_eq!(describe_power_error(PowerAction::Suspend, false, ""), "The system refused to suspend.");
    }
}
