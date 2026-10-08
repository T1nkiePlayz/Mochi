//! Native gamepad input.
//!
//! The web Gamepad API is unreliable inside WebKitGTK and WKWebView, so a
//! background thread reads controllers with `gilrs` (which applies the SDL
//! mapping database) and forwards a canonical, family-tagged event stream to the
//! frontend as `gamepad-event`. The thread must never take Mochi down: when the
//! gamepad subsystem is unavailable it logs once and exits.

use gilrs::{
    ev::EventType,
    ff::{BaseEffect, BaseEffectType, Effect, EffectBuilder, Replay, Ticks},
    Axis, Button, GamepadId, Gilrs,
};
use serde::Serialize;
use std::{
    collections::HashMap,
    sync::{
        mpsc::{channel, Receiver, Sender},
        Mutex, OnceLock,
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter};

/// Controller families the UI draws different button prompts for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Family {
    Xbox,
    Playstation,
    Switch,
    Steam,
    Deck,
    Generic,
}

const VENDOR_SONY: u16 = 0x054c;
const VENDOR_MICROSOFT: u16 = 0x045e;
const VENDOR_NINTENDO: u16 = 0x057e;
const VENDOR_VALVE: u16 = 0x28de;
const PRODUCT_DECK: u16 = 0x1205;

/// Works out which family a controller belongs to from its USB ids and name.
/// `on_deck` is true on a Steam Deck, where Steam Input presents the built-in
/// controls as a virtual Xbox 360 pad.
pub fn detect_family(name: &str, vendor: Option<u16>, product: Option<u16>, on_deck: bool) -> Family {
    let lower = name.to_ascii_lowercase();
    let has = |needles: &[&str]| needles.iter().any(|needle| lower.contains(needle));

    if vendor == Some(VENDOR_VALVE) && product == Some(PRODUCT_DECK) || has(&["steam deck", "neptune", "jupiter"]) {
        return Family::Deck;
    }
    if vendor == Some(VENDOR_VALVE) || has(&["steam controller", "steam virtual", "valve"]) {
        return Family::Steam;
    }
    if vendor == Some(VENDOR_SONY) || has(&["dualsense", "dualshock", "playstation", "ps5", "ps4", "ps3"]) || lower == "wireless controller" {
        return Family::Playstation;
    }
    if vendor == Some(VENDOR_NINTENDO) || has(&["pro controller", "joy-con", "joycon", "nintendo", "switch"]) {
        return Family::Switch;
    }
    if vendor == Some(VENDOR_MICROSOFT) || has(&["xbox", "x-box", "xinput", "microsoft"]) {
        // The Deck's virtual pad is indistinguishable from a real Xbox 360 pad by name alone.
        return if on_deck && has(&["x-box 360", "xbox 360", "microsoft"]) { Family::Deck } else { Family::Xbox };
    }
    Family::Generic
}

/// Canonical button names, named by physical position so every layout shares them.
pub fn canonical_button(button: Button) -> Option<&'static str> {
    Some(match button {
        Button::South => "south",
        Button::East => "east",
        Button::West => "west",
        Button::North => "north",
        Button::LeftTrigger => "l1",
        Button::RightTrigger => "r1",
        Button::LeftTrigger2 => "l2",
        Button::RightTrigger2 => "r2",
        Button::Select => "select",
        Button::Start => "start",
        Button::Mode => "guide",
        Button::LeftThumb => "l3",
        Button::RightThumb => "r3",
        Button::DPadUp => "dpadUp",
        Button::DPadDown => "dpadDown",
        Button::DPadLeft => "dpadLeft",
        Button::DPadRight => "dpadRight",
        Button::C | Button::Z | Button::Unknown => return None,
    })
}

/// Canonical axes with screen orientation: x grows to the right, y grows downward.
pub fn canonical_axis(axis: Axis, value: f32) -> Option<(&'static str, f32)> {
    Some(match axis {
        Axis::LeftStickX => ("leftX", value),
        Axis::LeftStickY => ("leftY", -value),
        Axis::RightStickX => ("rightX", value),
        Axis::RightStickY => ("rightY", -value),
        Axis::DPadX => ("dpadX", value),
        Axis::DPadY => ("dpadY", -value),
        Axis::LeftZ | Axis::RightZ | Axis::Unknown => return None,
    })
}

/// Axis events arrive far faster than the UI needs; forward only meaningful changes.
pub fn axis_changed(previous: Option<f32>, next: f32) -> bool {
    match previous {
        None => next.abs() > 0.001,
        Some(prev) => (next - prev).abs() >= 0.02 || (next == 0.0 && prev != 0.0) || (next.abs() >= 0.99 && prev.abs() < 0.99),
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PadInfo {
    pub id: usize,
    pub name: String,
    pub family: Family,
    pub vendor: Option<u16>,
    pub product: Option<u16>,
    pub rumble: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum PadEvent {
    Connected { pad: PadInfo },
    Disconnected { id: usize },
    Button { id: usize, button: &'static str, pressed: bool },
    Axis { id: usize, axis: &'static str, value: f32 },
}

enum Command {
    Rumble { id: Option<usize>, strong: f32, weak: f32, millis: u32 },
}

static PADS: Mutex<Vec<PadInfo>> = Mutex::new(Vec::new());
static COMMANDS: OnceLock<Mutex<Sender<Command>>> = OnceLock::new();

fn pad_info(gilrs: &Gilrs, id: GamepadId, on_deck: bool) -> PadInfo {
    let pad = gilrs.gamepad(id);
    let name = pad.name().to_string();
    PadInfo {
        id: usize::from(id),
        family: detect_family(&name, pad.vendor_id(), pad.product_id(), on_deck),
        vendor: pad.vendor_id(),
        product: pad.product_id(),
        rumble: pad.is_ff_supported(),
        name,
    }
}

fn remember(pad: &PadInfo) {
    if let Ok(mut pads) = PADS.lock() {
        pads.retain(|existing| existing.id != pad.id);
        pads.push(pad.clone());
    }
}

fn forget(id: usize) {
    if let Ok(mut pads) = PADS.lock() { pads.retain(|existing| existing.id != id); }
}

fn emit(app: &AppHandle, event: &PadEvent) { let _ = app.emit("gamepad-event", event); }

/// Starts the input thread. Returns immediately and never fails the caller.
pub fn start(app: AppHandle) {
    if std::env::var_os("MOCHI_NO_GAMEPAD").is_some() { return; }
    let (sender, receiver) = channel();
    let _ = COMMANDS.set(Mutex::new(sender));
    let spawned = std::thread::Builder::new().name("mochi-gamepad".into()).spawn(move || {
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| run(app, receiver)));
        if outcome.is_err() { eprintln!("Mochi gamepad: input thread stopped unexpectedly."); }
    });
    if let Err(error) = spawned { eprintln!("Mochi gamepad: unable to start input thread: {error}"); }
}

fn run(app: AppHandle, commands: Receiver<Command>) {
    let mut gilrs = match Gilrs::new() {
        Ok(gilrs) => gilrs,
        Err(error) => { eprintln!("Mochi gamepad: controller support unavailable: {error}"); return; }
    };
    let on_deck = crate::bigpicture::is_steam_deck();
    for (id, _) in gilrs.gamepads() {
        let pad = pad_info(&gilrs, id, on_deck);
        remember(&pad);
        emit(&app, &PadEvent::Connected { pad });
    }

    let mut axes: HashMap<(usize, &'static str), f32> = HashMap::new();
    let mut effect: Option<(Effect, Instant)> = None;
    loop {
        if let Some((_, until)) = &effect {
            if Instant::now() >= *until { effect = None; }
        }
        while let Ok(command) = commands.try_recv() {
            let Command::Rumble { id, strong, weak, millis } = command;
            effect = rumble(&mut gilrs, id, strong, weak, millis);
        }
        let Some(event) = gilrs.next_event_blocking(Some(Duration::from_millis(100))) else { continue };
        let id = usize::from(event.id);
        match event.event {
            EventType::Connected => {
                let pad = pad_info(&gilrs, event.id, on_deck);
                remember(&pad);
                emit(&app, &PadEvent::Connected { pad });
            }
            EventType::Disconnected => {
                forget(id);
                axes.retain(|(pad, _), _| *pad != id);
                emit(&app, &PadEvent::Disconnected { id });
            }
            EventType::ButtonPressed(button, _) | EventType::ButtonReleased(button, _) => {
                let pressed = matches!(event.event, EventType::ButtonPressed(..));
                if let Some(name) = canonical_button(button) { emit(&app, &PadEvent::Button { id, button: name, pressed }); }
            }
            EventType::AxisChanged(axis, value, _) => {
                if let Some((name, value)) = canonical_axis(axis, value) {
                    if axis_changed(axes.get(&(id, name)).copied(), value) {
                        axes.insert((id, name), value);
                        emit(&app, &PadEvent::Axis { id, axis: name, value });
                    }
                }
            }
            _ => {}
        }
    }
}

fn rumble(gilrs: &mut Gilrs, id: Option<usize>, strong: f32, weak: f32, millis: u32) -> Option<(Effect, Instant)> {
    let targets: Vec<GamepadId> = gilrs
        .gamepads()
        .filter(|(pad_id, pad)| pad.is_ff_supported() && id.map_or(true, |wanted| usize::from(*pad_id) == wanted))
        .map(|(pad_id, _)| pad_id)
        .collect();
    if targets.is_empty() { return None; }
    let millis = millis.clamp(10, 2000);
    let magnitude = |value: f32| (value.clamp(0.0, 1.0) * f32::from(u16::MAX)) as u16;
    let replay = Replay { play_for: Ticks::from_ms(millis), ..Default::default() };
    let built = EffectBuilder::new()
        .add_effect(BaseEffect { kind: BaseEffectType::Strong { magnitude: magnitude(strong) }, scheduling: replay, envelope: Default::default() })
        .add_effect(BaseEffect { kind: BaseEffectType::Weak { magnitude: magnitude(weak) }, scheduling: replay, envelope: Default::default() })
        .gamepads(&targets)
        .finish(gilrs)
        .ok()?;
    built.play().ok()?;
    Some((built, Instant::now() + Duration::from_millis(u64::from(millis) + 50)))
}

#[tauri::command]
pub fn get_gamepads() -> Vec<PadInfo> { PADS.lock().map(|pads| pads.clone()).unwrap_or_default() }

/// Short haptic pulse; silently does nothing when no connected pad supports it.
#[tauri::command]
pub fn gamepad_rumble(id: Option<usize>, strong: f32, weak: f32, millis: u32) {
    if let Some(sender) = COMMANDS.get().and_then(|sender| sender.lock().ok()) {
        let _ = sender.send(Command::Rumble { id, strong, weak, millis });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_families_by_vendor() {
        assert_eq!(detect_family("Whatever", Some(0x054c), Some(0x0ce6), false), Family::Playstation);
        assert_eq!(detect_family("Whatever", Some(0x045e), Some(0x02ea), false), Family::Xbox);
        assert_eq!(detect_family("Whatever", Some(0x057e), Some(0x2009), false), Family::Switch);
        assert_eq!(detect_family("Whatever", Some(0x28de), Some(0x1205), false), Family::Deck);
        assert_eq!(detect_family("Whatever", Some(0x28de), Some(0x1142), false), Family::Steam);
    }

    #[test]
    fn detects_families_by_name() {
        assert_eq!(detect_family("Sony Interactive Entertainment DualSense Wireless Controller", None, None, false), Family::Playstation);
        assert_eq!(detect_family("Wireless Controller", None, None, false), Family::Playstation);
        assert_eq!(detect_family("Nintendo Switch Pro Controller", None, None, false), Family::Switch);
        assert_eq!(detect_family("Xbox Wireless Controller", None, None, false), Family::Xbox);
        assert_eq!(detect_family("8BitDo Generic Pad", None, None, false), Family::Generic);
    }

    #[test]
    fn deck_virtual_pad_is_a_deck() {
        assert_eq!(detect_family("Microsoft X-Box 360 pad", Some(0x045e), Some(0x028e), true), Family::Deck);
        assert_eq!(detect_family("Microsoft X-Box 360 pad", Some(0x045e), Some(0x028e), false), Family::Xbox);
        assert_eq!(detect_family("Xbox Wireless Controller", Some(0x045e), Some(0x0b13), true), Family::Xbox);
    }

    #[test]
    fn maps_buttons_by_position() {
        assert_eq!(canonical_button(Button::South), Some("south"));
        assert_eq!(canonical_button(Button::LeftTrigger), Some("l1"));
        assert_eq!(canonical_button(Button::RightTrigger2), Some("r2"));
        assert_eq!(canonical_button(Button::Mode), Some("guide"));
        assert_eq!(canonical_button(Button::Unknown), None);
    }

    #[test]
    fn stick_y_is_screen_oriented() {
        assert_eq!(canonical_axis(Axis::LeftStickY, 1.0), Some(("leftY", -1.0)));
        assert_eq!(canonical_axis(Axis::LeftStickX, 0.5), Some(("leftX", 0.5)));
        assert_eq!(canonical_axis(Axis::Unknown, 0.5), None);
    }

    #[test]
    fn axis_throttling() {
        assert!(!axis_changed(None, 0.0));
        assert!(axis_changed(None, 0.5));
        assert!(!axis_changed(Some(0.50), 0.51));
        assert!(axis_changed(Some(0.50), 0.55));
        assert!(axis_changed(Some(0.10), 0.0));
        assert!(axis_changed(Some(0.95), 1.0));
    }
}
