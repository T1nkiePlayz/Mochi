//! Per-game controller profiles, translated into the SDL and Proton environment a launch gets. Mochi cannot
//! remap input for an arbitrary program without a virtual device, but SDL (native games, Proton, many emulators)
//! reads these variables. Everything here is pure: the connected pads are passed in, so tests need no hardware.

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

/// Vendor and product of the virtual pad Steam creates for Steam Input.
const STEAM_VIRTUAL: &str = "0x28de/0x11ff";

/// The buttons SDL's mapping strings name that a profile may move.
pub const REMAPPABLE: [&str; 12] = ["a", "b", "x", "y", "leftshoulder", "rightshoulder", "lefttrigger", "righttrigger", "leftstick", "rightstick", "start", "back"];

#[derive(Debug, Default, Deserialize, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct ControllerProfile {
    pub name: String,
    /// "xbox" (leave buttons alone), "nintendo" (swap A/B and X/Y) or "custom" (`remap`).
    pub layout: String,
    /// Physical button to the button the game sees; only used for the "custom" layout.
    pub remap: BTreeMap<String, String>,
    /// "auto", "xbox", "playstation" or "nintendo".
    pub type_hint: String,
    pub ignore_steam_virtual: bool,
    /// SDL GUID of the only pad the game may see.
    pub only_guid: Option<String>,
    pub proton_hidraw: bool,
}

/// A connected pad, as far as the profile needs to know it.
#[derive(Debug, Clone)]
pub struct Pad {
    pub name: String,
    pub guid: String,
    pub vendor: Option<u16>,
    pub product: Option<u16>,
}

/// A message for the editor: `message` is a fixed (translatable) sentence, `pad` the pad it is about.
#[derive(Debug, Serialize, Clone, PartialEq)]
pub struct ControllerNote {
    pub message: String,
    pub pad: Option<String>,
}

#[derive(Debug, Default, Clone)]
pub struct ProfileEnv {
    pub env: Vec<(String, String)>,
    pub notes: Vec<ControllerNote>,
}

fn note(message: &str, pad: Option<&str>) -> ControllerNote { ControllerNote { message: message.into(), pad: pad.map(str::to_owned) } }

fn hex_id(vendor: u16, product: u16) -> String { format!("0x{vendor:04x}/0x{product:04x}") }

/// Vendor and product encoded in an SDL GUID (32 hex digits; both are little-endian 16-bit fields).
pub fn guid_ids(guid: &str) -> Option<(u16, u16)> {
    if guid.len() != 32 || !guid.is_ascii() || !guid.bytes().all(|b| b.is_ascii_hexdigit()) { return None; }
    let field = |at: usize| u16::from_str_radix(&guid[at + 2..at + 4], 16).ok().and_then(|hi| u16::from_str_radix(&guid[at..at + 2], 16).ok().map(|lo| (hi << 8) | lo));
    Some((field(8)?, field(16)?))
}

fn swapped(pairs: [(&str, &str); 4]) -> BTreeMap<String, String> { pairs.iter().map(|(from, to)| ((*from).to_owned(), (*to).to_owned())).collect() }

/// The remap a profile asks for, without identity entries; an error is a fixed message for the editor.
pub fn effective_remap(profile: &ControllerProfile) -> Result<BTreeMap<String, String>, &'static str> {
    let remap = match profile.layout.as_str() {
        "nintendo" => swapped([("a", "b"), ("b", "a"), ("x", "y"), ("y", "x")]),
        "custom" => profile.remap.iter().filter(|(from, to)| from != to).map(|(from, to)| (from.clone(), to.clone())).collect(),
        _ => BTreeMap::new(),
    };
    if remap.iter().any(|(from, to)| !REMAPPABLE.contains(&from.as_str()) || !REMAPPABLE.contains(&to.as_str())) { return Err("The button remap is not valid for this controller, so it is skipped."); }
    let outputs: BTreeSet<&String> = remap.values().collect();
    if outputs.len() != remap.len() { return Err("Two buttons are remapped to the same button, so the remap is skipped."); }
    Ok(remap)
}

/// Applies `remap` (physical button to the button the game sees) to an SDL mapping body.
pub fn remap_body(body: &str, remap: &BTreeMap<String, String>) -> Result<String, &'static str> {
    let entries: Vec<(&str, &str)> = body.split(',').filter_map(|entry| entry.split_once(':')).collect();
    let binding = |key: &str| entries.iter().find(|(name, _)| *name == key).map(|(_, value)| *value);
    let claimed: BTreeSet<&str> = remap.values().map(String::as_str).collect();
    let mut out: Vec<String> = Vec::new();
    for (key, value) in &entries {
        if remap.contains_key(*key) || claimed.contains(key) { continue; }
        out.push(format!("{key}:{value}"));
    }
    for (from, to) in remap {
        let value = binding(from).ok_or("The button remap is not valid for this controller, so it is skipped.")?;
        out.push(format!("{to}:{value}"));
    }
    out.sort();
    Ok(out.join(","))
}

/// The bundled mapping for a pad's exact GUID.
pub fn known_mapping(guid: &str) -> Option<(&'static str, &'static str)> {
    crate::controllerdb::LINUX_MAPPINGS.iter().find(|(known, ..)| known.eq_ignore_ascii_case(guid)).map(|(_, name, body)| (*name, *body))
}

/// One `SDL_GAMECONTROLLERCONFIG` line for a pad, or `None` when Mochi has no exact mapping for its GUID.
pub fn mapping_line(pad: &Pad, remap: &BTreeMap<String, String>) -> Option<Result<String, &'static str>> {
    let (name, body) = known_mapping(&pad.guid)?;
    Some(remap_body(body, remap).map(|mapped| format!("{},{name},{mapped},platform:Linux,", pad.guid.to_ascii_lowercase())))
}

fn type_name(profile_hint: &str, pad: &Pad) -> Option<&'static str> {
    match profile_hint {
        "xbox" => Some(if pad.vendor == Some(0x045e) && matches!(pad.product, Some(0x028e)) { "Xbox360" } else { "XboxOne" }),
        "playstation" => Some(if pad.vendor == Some(0x054c) && matches!(pad.product, Some(0x05c4 | 0x09cc)) { "PS4" } else { "PS5" }),
        "nintendo" => Some("SwitchPro"),
        _ => None,
    }
}

/// The environment a profile adds to a direct launch. `proton` says the game runs through Proton (not plain Wine).
pub fn profile_env(profile: &ControllerProfile, pads: &[Pad], proton: bool) -> ProfileEnv {
    let mut out = ProfileEnv::default();
    let pads: Vec<&Pad> = pads.iter().filter(|pad| !profile.only_guid.as_deref().is_some_and(|only| !only.is_empty() && !pad.guid.eq_ignore_ascii_case(only))).collect();

    match effective_remap(profile) {
        Err(message) => out.notes.push(note(message, None)),
        Ok(remap) if !remap.is_empty() => {
            let mut lines = Vec::new();
            for pad in &pads {
                match mapping_line(pad, &remap) {
                    Some(Ok(line)) => lines.push(line),
                    Some(Err(message)) => out.notes.push(note(message, Some(&pad.name))),
                    None => out.notes.push(note("Mochi has no button map for this controller, so the remap is skipped for it.", Some(&pad.name))),
                }
            }
            if pads.is_empty() { out.notes.push(note("No controller is connected, so the button remap cannot be built yet.", None)); }
            if !lines.is_empty() { out.env.push(("SDL_GAMECONTROLLERCONFIG".into(), lines.join("\n"))); }
        }
        Ok(_) => {}
    }

    let types: Vec<String> = pads.iter().filter_map(|pad| Some(format!("{}={}", hex_id(pad.vendor?, pad.product?), type_name(&profile.type_hint, pad)?))).collect();
    if !types.is_empty() { out.env.push(("SDL_GAMECONTROLLERTYPE".into(), types.join(","))); }
    else if matches!(profile.type_hint.as_str(), "xbox" | "playstation" | "nintendo") { out.notes.push(note("No controller is connected, so the controller type hint cannot be built yet.", None)); }

    match profile.only_guid.as_deref().filter(|guid| !guid.is_empty()) {
        Some(guid) => match guid_ids(guid) {
            Some((vendor, product)) => out.env.push(("SDL_GAMECONTROLLER_IGNORE_DEVICES_EXCEPT".into(), hex_id(vendor, product))),
            None => out.notes.push(note("The chosen controller has an invalid identifier, so it is not used.", None)),
        },
        None if profile.ignore_steam_virtual => out.env.push(("SDL_GAMECONTROLLER_IGNORE_DEVICES".into(), STEAM_VIRTUAL.into())),
        None => {}
    }

    if profile.proton_hidraw {
        out.env.push(("SDL_JOYSTICK_HIDAPI".into(), "1".into()));
        if proton {
            out.env.push(("PROTON_ENABLE_HIDRAW".into(), "1".into()));
            out.env.push(("PROTON_PREFER_SDL".into(), "1".into()));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const XBOX_GUID: &str = "030000005e0400008e02000014010000";
    const DS4_GUID: &str = "030000004c050000cc09000011810000";

    fn pad(name: &str, guid: &str, vendor: u16, product: u16) -> Pad { Pad { name: name.into(), guid: guid.into(), vendor: Some(vendor), product: Some(product) } }
    fn xbox() -> Pad { pad("Xbox 360", XBOX_GUID, 0x045e, 0x028e) }
    fn ds4() -> Pad { pad("DS4", DS4_GUID, 0x054c, 0x09cc) }
    fn profile(layout: &str) -> ControllerProfile { ControllerProfile { layout: layout.into(), ..Default::default() } }
    fn value<'a>(env: &'a ProfileEnv, key: &str) -> Option<&'a str> { env.env.iter().find(|(k, _)| k == key).map(|(_, v)| v.as_str()) }

    #[test]
    fn guid_ids_reads_little_endian_vendor_and_product() {
        assert_eq!(guid_ids(XBOX_GUID), Some((0x045e, 0x028e)));
        assert_eq!(guid_ids(DS4_GUID), Some((0x054c, 0x09cc)));
        assert_eq!(guid_ids("short"), None);
        assert_eq!(guid_ids("zz0000005e0400008e02000014010000"), None);
    }

    #[test]
    fn every_bundled_guid_maps_to_its_own_body() {
        let remap = effective_remap(&profile("nintendo")).unwrap();
        for (guid, name, body) in crate::controllerdb::LINUX_MAPPINGS {
            assert!(guid_ids(guid).is_some(), "{guid}");
            assert_eq!(known_mapping(guid), Some((name, body)));
            let line = mapping_line(&pad(name, guid, 0, 0), &remap).unwrap().unwrap();
            assert!(line.starts_with(&format!("{guid},{name},")), "{guid}");
            assert_eq!(line, format!("{guid},{name},{},platform:Linux,", remap_body(body, &remap).unwrap()));
        }
    }

    #[test]
    fn hid_sony_and_xbox_360_variants_get_their_own_bodies() {
        let remap = effective_remap(&profile("nintendo")).unwrap();
        let sony = mapping_line(&pad("DS4", "030000004c050000cc09000011010000", 0x054c, 0x09cc), &remap).unwrap().unwrap();
        // hid-sony binds the cross to b1, so swapping A and B gives a:b2,b:b1.
        assert!(sony.contains(",a:b2,") && sony.contains(",b:b1,"), "{sony}");
        let hat = mapping_line(&pad("360", "030000005e0400008e02000001000000", 0x045e, 0x028e), &remap).unwrap().unwrap();
        assert!(hat.contains("dpdown:h0.1") && !hat.contains("guide:"), "{hat}");
    }

    #[test]
    fn unknown_guids_are_skipped_not_guessed() {
        let family_only = pad("DS4", "030000004c050000cc090000ffff0000", 0x054c, 0x09cc);
        assert!(mapping_line(&family_only, &BTreeMap::new()).is_none());
        let env = profile_env(&profile("nintendo"), &[family_only], false);
        assert!(env.env.is_empty());
        assert_eq!(env.notes.len(), 1);
    }

    #[test]
    fn nintendo_layout_swaps_face_buttons() {
        let line = mapping_line(&xbox(), &effective_remap(&profile("nintendo")).unwrap()).unwrap().unwrap();
        assert!(line.starts_with(&format!("{XBOX_GUID},Xbox 360 Controller,")));
        for part in ["a:b1", "b:b0", "x:b3", "y:b2", "leftshoulder:b4", "start:b7"] { assert!(line.contains(&format!(",{part},")), "{part} in {line}"); }
        assert!(line.ends_with("platform:Linux,"));
    }

    #[test]
    fn custom_remap_moves_buttons_and_drops_the_old_output() {
        let mut p = profile("custom");
        p.remap = BTreeMap::from([("leftshoulder".to_owned(), "a".to_owned())]);
        let body = remap_body(known_mapping(XBOX_GUID).unwrap().1, &effective_remap(&p).unwrap()).unwrap();
        assert!(body.split(',').any(|e| e == "a:b4"));
        assert!(!body.split(',').any(|e| e.starts_with("leftshoulder:")));
        assert!(body.split(',').any(|e| e == "b:b1"));
    }

    #[test]
    fn identity_and_xbox_layouts_change_nothing() {
        assert!(effective_remap(&profile("xbox")).unwrap().is_empty());
        let mut p = profile("custom");
        p.remap = BTreeMap::from([("a".to_owned(), "a".to_owned())]);
        assert!(effective_remap(&p).unwrap().is_empty());
        assert!(profile_env(&profile("xbox"), &[xbox()], false).env.is_empty());
    }

    #[test]
    fn bad_remaps_are_rejected() {
        let mut p = profile("custom");
        p.remap = BTreeMap::from([("a".to_owned(), "b".to_owned()), ("x".to_owned(), "b".to_owned())]);
        assert!(effective_remap(&p).is_err());
        p.remap = BTreeMap::from([("guide".to_owned(), "a".to_owned())]);
        assert!(effective_remap(&p).is_err());
        let env = profile_env(&p, &[xbox()], false);
        assert!(env.env.is_empty() && env.notes.len() == 1);
    }

    #[test]
    fn profile_env_builds_a_config_line_per_known_pad_and_notes_unknown_ones() {
        let unknown = pad("Mystery Pad", "03000000aaaa0000bbbb000000000000", 0xaaaa, 0xbbbb);
        let env = profile_env(&profile("nintendo"), &[xbox(), ds4(), unknown], false);
        let config = value(&env, "SDL_GAMECONTROLLERCONFIG").unwrap();
        assert_eq!(config.lines().count(), 2);
        assert_eq!(env.notes, vec![note("Mochi has no button map for this controller, so the remap is skipped for it.", Some("Mystery Pad"))]);
    }

    #[test]
    fn remap_without_pads_says_so() {
        let env = profile_env(&profile("nintendo"), &[], false);
        assert!(env.env.is_empty());
        assert_eq!(env.notes.len(), 1);
    }

    #[test]
    fn type_hint_and_ignore_variables() {
        let mut p = profile("xbox");
        p.type_hint = "playstation".into();
        p.ignore_steam_virtual = true;
        let env = profile_env(&p, &[xbox(), ds4()], false);
        assert_eq!(value(&env, "SDL_GAMECONTROLLERTYPE"), Some("0x045e/0x028e=PS5,0x054c/0x09cc=PS4"));
        assert_eq!(value(&env, "SDL_GAMECONTROLLER_IGNORE_DEVICES"), Some("0x28de/0x11ff"));
        p.type_hint = "auto".into();
        assert!(value(&profile_env(&p, &[xbox()], false), "SDL_GAMECONTROLLERTYPE").is_none());
    }

    #[test]
    fn only_this_controller_limits_the_pads_and_replaces_the_ignore_list() {
        let mut p = profile("nintendo");
        p.only_guid = Some(DS4_GUID.into());
        p.ignore_steam_virtual = true;
        let env = profile_env(&p, &[xbox(), ds4()], false);
        assert_eq!(value(&env, "SDL_GAMECONTROLLER_IGNORE_DEVICES_EXCEPT"), Some("0x054c/0x09cc"));
        assert!(value(&env, "SDL_GAMECONTROLLER_IGNORE_DEVICES").is_none());
        assert_eq!(value(&env, "SDL_GAMECONTROLLERCONFIG").unwrap().lines().count(), 1);
        p.only_guid = Some("nonsense".into());
        assert_eq!(profile_env(&p, &[xbox()], false).notes.len(), 2);
    }

    #[test]
    fn hidraw_is_added_for_proton_only() {
        let mut p = profile("xbox");
        p.proton_hidraw = true;
        let native = profile_env(&p, &[], false);
        assert_eq!(value(&native, "SDL_JOYSTICK_HIDAPI"), Some("1"));
        assert!(value(&native, "PROTON_ENABLE_HIDRAW").is_none());
        let proton = profile_env(&p, &[], true);
        assert_eq!(value(&proton, "PROTON_ENABLE_HIDRAW"), Some("1"));
        assert_eq!(value(&proton, "PROTON_PREFER_SDL"), Some("1"));
    }
}
