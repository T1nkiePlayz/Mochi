//! Emulators and ROM libraries: the built-in system table, emulator and RetroArch core detection, the
//! device-local settings (ROM folders, emulator per system) and the argv that starts a ROM. ROM scanning
//! lives in `romscan`. Launching is an argv, never a shell. Everything takes a `Probe` (where tools and apps
//! are looked up) so the tests need no real emulators.

use crate::platform::Os;
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};

/// How an emulator takes its arguments.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Style {
    /// `retroarch [args] -L <core> <rom>`
    RetroArch,
    /// `dolphin-emu [args] -b -e <rom>`
    Dolphin,
    /// `pcsx2-qt [args] -batch -- <rom>` (also DuckStation)
    BatchDashes,
    /// `emulator [args] <rom>`
    Plain,
    /// `mame [args] -rompath <dir> <romname>`
    Mame,
}

pub struct EmulatorDef {
    pub id: &'static str,
    pub name: &'static str,
    style: Style,
    /// Programs on PATH (first found wins).
    commands: &'static [&'static str],
    flatpak: Option<&'static str>,
    /// macOS bundle name and the executable inside `Contents/MacOS`.
    bundle: Option<(&'static str, &'static str)>,
}

/// Discontinued emulators (Citra, Yuzu, Ryujinx) are deliberately not listed.
pub const EMULATORS: &[EmulatorDef] = &[
    EmulatorDef { id: "retroarch", name: "RetroArch", style: Style::RetroArch, commands: &["retroarch"], flatpak: Some("org.libretro.RetroArch"), bundle: Some(("RetroArch.app", "RetroArch")) },
    EmulatorDef { id: "dolphin", name: "Dolphin", style: Style::Dolphin, commands: &["dolphin-emu"], flatpak: Some("org.DolphinEmu.dolphin-emu"), bundle: Some(("Dolphin.app", "Dolphin")) },
    EmulatorDef { id: "pcsx2", name: "PCSX2", style: Style::BatchDashes, commands: &["pcsx2-qt", "pcsx2"], flatpak: Some("net.pcsx2.PCSX2"), bundle: Some(("PCSX2.app", "PCSX2")) },
    EmulatorDef { id: "duckstation", name: "DuckStation", style: Style::BatchDashes, commands: &["duckstation-qt"], flatpak: Some("org.duckstation.DuckStation"), bundle: Some(("DuckStation.app", "DuckStation")) },
    EmulatorDef { id: "ppsspp", name: "PPSSPP", style: Style::Plain, commands: &["ppsspp", "PPSSPPSDL"], flatpak: Some("org.ppsspp.PPSSPP"), bundle: Some(("PPSSPP.app", "PPSSPPSDL")) },
    EmulatorDef { id: "melonds", name: "melonDS", style: Style::Plain, commands: &["melonDS", "melonds"], flatpak: Some("net.kuribo64.melonDS"), bundle: Some(("melonDS.app", "melonDS")) },
    EmulatorDef { id: "mgba", name: "mGBA", style: Style::Plain, commands: &["mgba-qt"], flatpak: Some("io.mgba.mGBA"), bundle: Some(("mGBA.app", "mGBA")) },
    EmulatorDef { id: "flycast", name: "Flycast", style: Style::Plain, commands: &["flycast"], flatpak: Some("org.flycast.Flycast"), bundle: Some(("Flycast.app", "Flycast")) },
    EmulatorDef { id: "mame", name: "MAME", style: Style::Mame, commands: &["mame"], flatpak: Some("org.mamedev.MAME"), bundle: None },
];

pub fn emulator(id: &str) -> Option<&'static EmulatorDef> { EMULATORS.iter().find(|def| def.id == id) }

pub struct System {
    pub id: &'static str,
    pub name: &'static str,
    /// ROM extensions, lowercase, without the dot. Archives are listed only where emulators read them.
    pub exts: &'static [&'static str],
    /// Emulators that run this system, best first.
    pub emulators: &'static [&'static str],
    /// RetroArch core names (`<name>_libretro`), best first.
    pub cores: &'static [&'static str],
    /// Folder names that identify the system in "auto" folders.
    pub hints: &'static [&'static str],
}

const ARCHIVES: [&str; 2] = ["zip", "7z"];

pub const SYSTEMS: &[System] = &[
    System { id: "nes", name: "Nintendo Entertainment System", exts: &["nes", "fds", "unf", "unif", "zip", "7z"], emulators: &["retroarch"], cores: &["mesen", "nestopia", "fceumm"], hints: &["nes", "famicom"] },
    System { id: "snes", name: "Super Nintendo", exts: &["sfc", "smc", "swc", "fig", "zip", "7z"], emulators: &["retroarch"], cores: &["snes9x", "bsnes", "bsnes_mercury_balanced"], hints: &["snes", "sfc", "superfamicom", "supernintendo"] },
    System { id: "n64", name: "Nintendo 64", exts: &["z64", "n64", "v64", "zip", "7z"], emulators: &["retroarch"], cores: &["mupen64plus_next", "parallel_n64"], hints: &["n64", "nintendo64"] },
    System { id: "gb", name: "Game Boy", exts: &["gb", "zip", "7z"], emulators: &["mgba", "retroarch"], cores: &["gambatte", "sameboy", "mgba"], hints: &["gb", "gameboy"] },
    System { id: "gbc", name: "Game Boy Color", exts: &["gbc", "zip", "7z"], emulators: &["mgba", "retroarch"], cores: &["gambatte", "sameboy", "mgba"], hints: &["gbc", "gameboycolor"] },
    System { id: "gba", name: "Game Boy Advance", exts: &["gba", "zip", "7z"], emulators: &["mgba", "retroarch"], cores: &["mgba", "vba_next", "gpsp"], hints: &["gba", "gameboyadvance"] },
    System { id: "nds", name: "Nintendo DS", exts: &["nds", "dsi", "zip", "7z"], emulators: &["melonds", "retroarch"], cores: &["melonds", "desmume"], hints: &["nds", "ds", "nintendods"] },
    System { id: "gamecube", name: "Nintendo GameCube", exts: &["gcm", "gcz", "rvz", "ciso", "iso"], emulators: &["dolphin", "retroarch"], cores: &["dolphin"], hints: &["gc", "gamecube", "ngc"] },
    System { id: "wii", name: "Nintendo Wii", exts: &["wbfs", "wia", "rvz", "wad", "iso"], emulators: &["dolphin", "retroarch"], cores: &["dolphin"], hints: &["wii"] },
    System { id: "ps1", name: "Sony PlayStation", exts: &["cue", "chd", "pbp", "m3u", "iso", "bin", "img"], emulators: &["duckstation", "retroarch"], cores: &["swanstation", "pcsx_rearmed", "mednafen_psx_hw", "mednafen_psx"], hints: &["ps1", "psx", "psone", "playstation"] },
    System { id: "ps2", name: "Sony PlayStation 2", exts: &["iso", "bin", "cue", "chd", "cso", "zso", "gz", "m3u"], emulators: &["pcsx2", "retroarch"], cores: &["pcsx2", "lrps2"], hints: &["ps2", "playstation2"] },
    System { id: "psp", name: "Sony PlayStation Portable", exts: &["iso", "cso", "pbp", "chd"], emulators: &["ppsspp", "retroarch"], cores: &["ppsspp"], hints: &["psp", "playstationportable"] },
    System { id: "genesis", name: "Sega Genesis / Mega Drive", exts: &["md", "gen", "smd", "bin", "zip", "7z"], emulators: &["retroarch"], cores: &["genesis_plus_gx", "picodrive", "blastem"], hints: &["genesis", "megadrive", "md", "segagenesis"] },
    System { id: "sms", name: "Sega Master System", exts: &["sms", "zip", "7z"], emulators: &["retroarch"], cores: &["genesis_plus_gx", "picodrive", "smsplus"], hints: &["sms", "mastersystem"] },
    System { id: "saturn", name: "Sega Saturn", exts: &["cue", "chd", "iso", "mdf", "bin", "m3u"], emulators: &["retroarch"], cores: &["mednafen_saturn", "yabause", "kronos"], hints: &["saturn", "segasaturn"] },
    System { id: "dreamcast", name: "Sega Dreamcast", exts: &["gdi", "cdi", "chd", "cue", "m3u"], emulators: &["flycast", "retroarch"], cores: &["flycast"], hints: &["dreamcast", "dc"] },
    System { id: "arcade", name: "Arcade (MAME)", exts: &ARCHIVES, emulators: &["mame", "retroarch"], cores: &["mame", "fbneo", "mame2003_plus", "fbalpha"], hints: &["arcade", "mame", "fbneo"] },
];

pub fn system(id: &str) -> Option<&'static System> { SYSTEMS.iter().find(|system| system.id == id) }

/// The only system that claims this extension, for folders mapped "auto by extension".
/// Shared extensions (`.iso`, `.zip`, `.bin`, `.chd`, ...) need the folder name or an explicit mapping.
pub fn system_for_extension(ext: &str) -> Option<&'static System> {
    let ext = ext.to_ascii_lowercase();
    let mut found = SYSTEMS.iter().filter(|system| system.exts.contains(&ext.as_str()));
    let first = found.next()?;
    found.next().is_none().then_some(first)
}

/// A system named by a folder (`SNES`, `Sega Genesis`, `psx`), compared without case, spaces and punctuation.
pub fn system_for_folder_name(name: &str) -> Option<&'static System> {
    let key: String = name.chars().filter(|c| c.is_ascii_alphanumeric()).collect::<String>().to_ascii_lowercase();
    if key.is_empty() { return None; }
    SYSTEMS.iter().find(|system| system.id == key || system.hints.contains(&key.as_str()))
}

// ---------------------------------------------------------------------------
// Target: mochi-emu://<system>?rom=<encoded path>
// ---------------------------------------------------------------------------

const TARGET_SCHEME: &str = "mochi-emu://";

pub fn make_target(system: &str, rom: &Path) -> String {
    format!("{TARGET_SCHEME}{system}?rom={}", super::encode(&rom.to_string_lossy()))
}

pub fn parse_target(target: &str) -> Option<(&'static System, PathBuf)> {
    let (system_id, query) = target.strip_prefix(TARGET_SCHEME)?.split_once('?')?;
    let rom = super::percent_decode(query.strip_prefix("rom=")?)?;
    let path = PathBuf::from(rom);
    (path.is_absolute() && !path.to_string_lossy().contains('\0')).then_some(())?;
    Some((system(system_id)?, path))
}

// ---------------------------------------------------------------------------
// Settings (device-local)
// ---------------------------------------------------------------------------

pub const MAX_FOLDERS: usize = 64;
const MAX_PATH_BYTES: usize = 4096;
const MAX_ARGS_BYTES: usize = 1024;

/// A ROM folder; `system` is a system id or "auto" (by folder name, then by extension).
#[derive(Clone, Serialize, Deserialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RomFolder {
    pub path: String,
    pub system: String,
}

/// Per-system choices; empty means "use the default".
#[derive(Clone, Default, Serialize, Deserialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct SystemChoice {
    pub emulator: String,
    /// RetroArch core name (`snes9x`).
    pub core: String,
    /// Extra emulator arguments, shell-style quoting, never run through a shell.
    pub args: String,
}

#[derive(Clone, Default, Serialize, Deserialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub folders: Vec<RomFolder>,
    pub systems: BTreeMap<String, SystemChoice>,
}

impl Settings {
    /// Checks every field and drops choices that are all defaults.
    pub fn validated(mut self) -> Result<Settings, String> {
        if self.folders.len() > MAX_FOLDERS { return Err(format!("At most {MAX_FOLDERS} ROM folders are allowed.")); }
        for folder in &mut self.folders {
            folder.path = folder.path.trim().to_owned();
            let path = Path::new(&folder.path);
            if !path.is_absolute() || folder.path.len() > MAX_PATH_BYTES || folder.path.contains('\0') { return Err(format!("\"{}\" is not a valid folder path.", folder.path)); }
            if folder.system != "auto" && system(&folder.system).is_none() { return Err(format!("Unknown system \"{}\".", folder.system)); }
        }
        let mut seen = std::collections::HashSet::new();
        self.folders.retain(|folder| seen.insert(folder.path.clone()));
        for (id, choice) in &mut self.systems {
            let sys = system(id).ok_or_else(|| format!("Unknown system \"{id}\"."))?;
            choice.emulator = choice.emulator.trim().to_owned();
            choice.core = choice.core.trim().to_owned();
            if !choice.emulator.is_empty() && !sys.emulators.contains(&choice.emulator.as_str()) { return Err(format!("{} cannot run {}.", choice.emulator, sys.name)); }
            if !choice.core.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') || choice.core.len() > 64 { return Err(format!("\"{}\" is not a valid RetroArch core name.", choice.core)); }
            if choice.args.len() > MAX_ARGS_BYTES || choice.args.contains('\0') { return Err("The extra arguments are too long or contain an invalid character.".into()); }
            split_args(&choice.args)?;
        }
        self.systems.retain(|_, choice| *choice != SystemChoice::default());
        Ok(self)
    }
}

pub fn settings_path() -> Option<PathBuf> { crate::modinstance::data_dir().map(|dir| dir.join("emulators.json")) }

pub fn load_settings(path: &Path) -> Settings {
    fs::read(path).ok().and_then(|bytes| serde_json::from_slice::<Settings>(&bytes).ok()).and_then(|settings| settings.validated().ok()).unwrap_or_default()
}

pub fn save_settings(path: &Path, settings: &Settings) -> Result<(), String> {
    if let Some(parent) = path.parent() { fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
    crate::util::fsio::write_atomic_durable(path, &serde_json::to_vec_pretty(settings).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

/// Splits `a "b c" 'd'` into words (quotes group, backslash escapes inside double quotes and outside quotes).
pub fn split_args(text: &str) -> Result<Vec<String>, String> {
    let mut words = Vec::new();
    let mut current = String::new();
    let mut started = false;
    let mut quote: Option<char> = None;
    let mut chars = text.chars();
    while let Some(c) = chars.next() {
        match (quote, c) {
            (Some(q), c) if c == q => quote = None,
            (Some('"'), '\\') | (None, '\\') => { if let Some(next) = chars.next() { current.push(next); started = true; } }
            (Some(_), c) => current.push(c),
            (None, '"') | (None, '\'') => { quote = Some(c); started = true; }
            (None, c) if c.is_whitespace() => { if started { words.push(std::mem::take(&mut current)); started = false; } }
            (None, c) => { current.push(c); started = true; }
        }
    }
    if quote.is_some() { return Err("The extra arguments have an unclosed quote.".into()); }
    if started { words.push(current); }
    Ok(words)
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/// Where tools and apps are looked up; tests supply fakes.
pub struct Probe<'a> {
    pub os: Os,
    pub home: PathBuf,
    pub which: &'a dyn Fn(&str) -> Option<PathBuf>,
    /// System-wide Flatpak app directory (`/var/lib/flatpak/app`).
    pub system_flatpak: PathBuf,
    /// Folders holding `.app` bundles (macOS).
    pub app_dirs: Vec<PathBuf>,
}

impl Probe<'static> {
    pub fn system(home: PathBuf) -> Probe<'static> {
        Probe {
            os: crate::platform::CURRENT_OS,
            app_dirs: vec![PathBuf::from("/Applications"), home.join("Applications")],
            home,
            which: &crate::platform::command_path,
            system_flatpak: PathBuf::from("/var/lib/flatpak/app"),
        }
    }
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub enum Install {
    Native(PathBuf),
    Flatpak(String),
    /// The executable inside a macOS bundle.
    App(PathBuf),
}

impl Install {
    fn via(&self) -> &'static str {
        match self { Install::Native(_) => "native", Install::Flatpak(_) => "flatpak", Install::App(_) => "app" }
    }
}

fn data_home(home: &Path) -> PathBuf {
    std::env::var_os("XDG_DATA_HOME").map(PathBuf::from).filter(|dir| dir.is_absolute()).unwrap_or_else(|| home.join(".local/share"))
}

fn flatpak_installed(probe: &Probe, id: &str) -> bool {
    probe.os == Os::Linux && [probe.system_flatpak.join(id), data_home(&probe.home).join("flatpak/app").join(id)].iter().any(|dir| dir.is_dir())
}

pub fn detect(probe: &Probe, def: &EmulatorDef) -> Option<Install> {
    if let Some(path) = def.commands.iter().find_map(|command| (probe.which)(command)) { return Some(Install::Native(path)); }
    if let Some(id) = def.flatpak.filter(|id| flatpak_installed(probe, id)) { return Some(Install::Flatpak(id.to_owned())); }
    if probe.os == Os::MacOs {
        let (bundle, exec) = def.bundle?;
        return probe.app_dirs.iter().map(|dir| dir.join(bundle).join("Contents/MacOS").join(exec)).find(|path| path.is_file()).map(Install::App);
    }
    None
}

/// Where RetroArch keeps its cores for this install (the Flatpak sandbox cannot see the system ones).
fn core_dirs(probe: &Probe, install: &Install) -> Vec<PathBuf> {
    let home = &probe.home;
    match install {
        Install::Flatpak(id) => vec![home.join(".var/app").join(id).join("config/retroarch/cores")],
        Install::App(_) => vec![home.join("Library/Application Support/RetroArch/cores"), PathBuf::from("/Applications/RetroArch.app/Contents/Resources/cores")],
        Install::Native(_) => {
            let mut dirs = vec![home.join(".config/retroarch/cores"), data_home(home).join("libretro/cores")];
            dirs.extend(["/usr/lib/libretro", "/usr/lib64/libretro", "/usr/lib/x86_64-linux-gnu/libretro", "/usr/lib/aarch64-linux-gnu/libretro", "/usr/local/lib/libretro", "/opt/homebrew/lib/libretro"].map(PathBuf::from));
            dirs.push(home.join("Library/Application Support/RetroArch/cores"));
            dirs
        }
    }
}

/// Installed cores as (name, file), e.g. `snes9x` -> `.../snes9x_libretro.so`.
pub fn retroarch_cores(probe: &Probe, install: &Install) -> BTreeMap<String, PathBuf> {
    let mut cores = BTreeMap::new();
    for dir in core_dirs(probe, install) {
        let Ok(entries) = fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let file = entry.file_name().to_string_lossy().into_owned();
            let Some(stem) = file.strip_suffix("_libretro.so").or_else(|| file.strip_suffix("_libretro.dylib")) else { continue };
            if stem.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') { cores.entry(stem.to_owned()).or_insert_with(|| entry.path()); }
        }
    }
    cores
}

/// The core to use for a system: the user's override if installed, else the first installed preferred core.
fn pick_core(sys: &System, choice: Option<&SystemChoice>, cores: &BTreeMap<String, PathBuf>) -> Result<PathBuf, String> {
    if let Some(name) = choice.map(|choice| choice.core.as_str()).filter(|name| !name.is_empty()) {
        return cores.get(name).cloned().ok_or_else(|| format!("The RetroArch core \"{name}\" is not installed. Pick another in Settings > Emulators."));
    }
    sys.cores.iter().find_map(|name| cores.get(*name).cloned())
        .ok_or_else(|| format!("RetroArch has no core for {}. Install one with RetroArch's Online Updater (Load Core, Download a Core).", sys.name))
}

/// The emulator for a system: the user's choice, else the first installed one in the table's order.
fn pick_emulator(probe: &Probe, sys: &System, choice: Option<&SystemChoice>) -> Result<(&'static EmulatorDef, Install), String> {
    if let Some(id) = choice.map(|choice| choice.emulator.as_str()).filter(|id| !id.is_empty()) {
        let def = emulator(id).filter(|def| sys.emulators.contains(&def.id)).ok_or_else(|| format!("{id} cannot run {}.", sys.name))?;
        return detect(probe, def).map(|install| (def, install)).ok_or_else(|| format!("{} is not installed. Pick another emulator in Settings > Emulators.", def.name));
    }
    sys.emulators.iter().filter_map(|id| emulator(id)).find_map(|def| detect(probe, def).map(|install| (def, install)))
        .ok_or_else(|| format!("No emulator for {} was found. Install one (RetroArch works for most systems) or choose it in Settings > Emulators.", sys.name))
}

// ---------------------------------------------------------------------------
// Launching
// ---------------------------------------------------------------------------

/// The argv for one ROM. `rom_dir` is shared read-only with Flatpak apps.
fn build_argv(def: &EmulatorDef, install: &Install, rom: &Path, core: Option<&Path>, args: &[String]) -> Result<Vec<String>, String> {
    let text = |path: &Path| path.to_string_lossy().into_owned();
    let mut argv: Vec<String> = match install {
        Install::Native(path) | Install::App(path) => vec![text(path)],
        Install::Flatpak(id) => {
            let dir = rom.parent().ok_or("The ROM has no folder.")?;
            let dir = text(dir);
            if dir.contains([':', '\0']) { return Err("Flatpak cannot be given a ROM folder whose path contains a colon. Move the ROM.".into()); }
            vec!["flatpak".into(), "run".into(), format!("--filesystem={dir}:ro"), id.clone()]
        }
    };
    argv.extend(args.iter().cloned());
    match def.style {
        Style::RetroArch => argv.extend(["-L".into(), text(core.ok_or("RetroArch needs a core.")?), text(rom)]),
        Style::Dolphin => argv.extend(["-b".into(), "-e".into(), text(rom)]),
        Style::BatchDashes => argv.extend(["-batch".into(), "--".into(), text(rom)]),
        Style::Plain => argv.push(text(rom)),
        Style::Mame => {
            let dir = rom.parent().ok_or("The ROM has no folder.")?;
            let name = rom.file_stem().ok_or("The ROM has no name.")?;
            argv.extend(["-rompath".into(), text(dir), name.to_string_lossy().into_owned()]);
        }
    }
    Ok(argv)
}

/// The argv for a `mochi-emu://` target using the saved settings; `extra` are the game's own launch arguments.
pub fn resolve_launch(target: &str, extra: &[String], settings: &Settings, probe: &Probe) -> Result<Vec<String>, String> {
    let (sys, rom) = parse_target(target).ok_or("This emulator launch target is not valid.")?;
    if !rom.is_file() { return Err(format!("The ROM \"{}\" no longer exists. Rescan your ROM folders or edit the game.", rom.display())); }
    let choice = settings.systems.get(sys.id);
    let (def, install) = pick_emulator(probe, sys, choice)?;
    let core = if def.style == Style::RetroArch { Some(pick_core(sys, choice, &retroarch_cores(probe, &install))?) } else { None };
    let mut args = split_args(choice.map(|choice| choice.args.as_str()).unwrap_or(""))?;
    args.extend(extra.iter().cloned());
    build_argv(def, &install, &rom, core.as_deref(), &args)
}

/// `resolve_launch` with the real settings file and system probe (what the launcher and the preview call).
pub fn launch_argv(target: &str, extra: &[String]) -> Result<Vec<String>, String> {
    let home = crate::platform::home_dir().ok_or("Unable to determine the home directory.")?;
    let settings = settings_path().map(|path| load_settings(&path)).unwrap_or_default();
    resolve_launch(target, extra, &settings, &Probe::system(home))
}

// ---------------------------------------------------------------------------
// UI overview and commands
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    pub id: &'static str,
    pub name: &'static str,
    pub extensions: Vec<&'static str>,
    /// Emulators that can run it (installed or not), best first.
    pub emulators: Vec<&'static str>,
    /// Installed RetroArch cores known for this system.
    pub cores: Vec<String>,
    pub default_emulator: Option<&'static str>,
    pub default_core: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmulatorInfo {
    pub id: &'static str,
    pub name: &'static str,
    /// "native", "flatpak" or "app"; `None` when not installed.
    pub installed_via: Option<&'static str>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Overview {
    pub systems: Vec<SystemInfo>,
    pub emulators: Vec<EmulatorInfo>,
    pub settings: Settings,
}

pub fn overview(settings: Settings, probe: &Probe) -> Overview {
    let installs: Vec<(&'static EmulatorDef, Option<Install>)> = EMULATORS.iter().map(|def| (def, detect(probe, def))).collect();
    let retroarch = installs.iter().find(|(def, _)| def.id == "retroarch").and_then(|(_, install)| install.clone());
    let cores = retroarch.as_ref().map(|install| retroarch_cores(probe, install)).unwrap_or_default();
    let systems = SYSTEMS.iter().map(|sys| {
        let installed = |id: &str| installs.iter().any(|(def, install)| def.id == id && install.is_some());
        SystemInfo {
            id: sys.id,
            name: sys.name,
            extensions: sys.exts.to_vec(),
            emulators: sys.emulators.to_vec(),
            cores: sys.cores.iter().filter(|name| cores.contains_key(**name)).map(|name| (*name).to_owned()).collect(),
            default_emulator: sys.emulators.iter().copied().find(|id| installed(id)),
            default_core: sys.cores.iter().find(|name| cores.contains_key(**name)).map(|name| (*name).to_owned()),
        }
    }).collect();
    let emulators = installs.iter().map(|(def, install)| EmulatorInfo { id: def.id, name: def.name, installed_via: install.as_ref().map(Install::via) }).collect();
    Overview { systems, emulators, settings }
}

fn current_overview(settings: Settings) -> Result<Overview, String> {
    let home = crate::platform::home_dir().ok_or("Unable to determine the home directory.")?;
    Ok(overview(settings, &Probe::system(home)))
}

#[tauri::command(async)]
pub fn get_emulator_overview() -> Result<Overview, String> {
    current_overview(settings_path().map(|path| load_settings(&path)).unwrap_or_default())
}

#[tauri::command(async)]
pub fn set_emulator_settings(settings: Settings) -> Result<Overview, String> {
    let settings = settings.validated()?;
    save_settings(&settings_path().ok_or("Mochi is still starting.")?, &settings)?;
    current_overview(settings)
}

/// Whether any emulator is installed or any ROM folder is configured (the import source's "installed").
pub fn any_configured(home: &Path) -> bool {
    let settings = settings_path().map(|path| load_settings(&path)).unwrap_or_default();
    let probe = Probe::system(home.to_path_buf());
    !settings.folders.is_empty() || EMULATORS.iter().any(|def| detect(&probe, def).is_some())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sources::testutil::temp_dir;

    fn which_in(names: &'static [&'static str]) -> impl Fn(&str) -> Option<PathBuf> {
        move |name| names.contains(&name).then(|| PathBuf::from(format!("/usr/bin/{name}")))
    }

    fn rom(dir: &Path, name: &str) -> PathBuf {
        let path = dir.join(name);
        fs::write(&path, b"rom").unwrap();
        path
    }

    #[test]
    fn extensions_map_to_one_system_only_when_unambiguous() {
        for (ext, id) in [("nes", "nes"), ("SFC", "snes"), ("z64", "n64"), ("gba", "gba"), ("nds", "nds"), ("gcm", "gamecube"), ("wbfs", "wii"), ("gdi", "dreamcast"), ("smd", "genesis"), ("sms", "sms"), ("mdf", "saturn")] {
            assert_eq!(system_for_extension(ext).map(|s| s.id), Some(id), "{ext}");
        }
        for ext in ["iso", "zip", "7z", "bin", "chd", "cue", "pbp", "rvz", "txt"] { assert!(system_for_extension(ext).is_none(), "{ext}"); }
        assert_eq!(system_for_folder_name("Sega Genesis").map(|s| s.id), Some("genesis"));
        assert_eq!(system_for_folder_name("PSX").map(|s| s.id), Some("ps1"));
        assert_eq!(system_for_folder_name("Mega-Drive").map(|s| s.id), Some("genesis"));
        assert!(system_for_folder_name("Movies").is_none());
        // Every emulator a system names exists, and archives are only where emulators read them.
        for sys in SYSTEMS { for id in sys.emulators { assert!(emulator(id).is_some(), "{id}"); } }
        assert!(!system("ps2").unwrap().exts.contains(&"zip") && system("arcade").unwrap().exts == ["zip", "7z"]);
    }

    #[test]
    fn targets_round_trip_and_reject_bad_input() {
        let target = make_target("snes", Path::new("/roms/Super Metroid (USA).sfc"));
        assert_eq!(target, "mochi-emu://snes?rom=%2Froms%2FSuper%20Metroid%20%28USA%29.sfc");
        let (sys, path) = parse_target(&target).unwrap();
        assert_eq!((sys.id, path), ("snes", PathBuf::from("/roms/Super Metroid (USA).sfc")));
        for bad in ["mochi-emu://nope?rom=%2Fa", "mochi-emu://snes?rom=relative.sfc", "mochi-emu://snes", "mochi-emu://snes?rom=%2Fa%00b", "steam://x"] { assert!(parse_target(bad).is_none(), "{bad}"); }
    }

    #[test]
    fn extra_arguments_split_like_a_shell_without_one() {
        assert_eq!(split_args(r#"-f "two words" 'x y' a\ b"#).unwrap(), ["-f", "two words", "x y", "a b"]);
        assert_eq!(split_args("  ").unwrap(), Vec::<String>::new());
        assert_eq!(split_args(r#""" a"#).unwrap(), ["", "a"]);
        assert!(split_args(r#"-f "open"#).is_err());
    }

    #[test]
    fn settings_are_validated_and_defaults_dropped() {
        let ok = Settings {
            folders: vec![RomFolder { path: " /roms ".into(), system: "auto".into() }, RomFolder { path: "/roms".into(), system: "snes".into() }],
            systems: BTreeMap::from([("snes".to_owned(), SystemChoice::default()), ("ps1".to_owned(), SystemChoice { emulator: "duckstation".into(), core: String::new(), args: "-fullscreen".into() })]),
        }.validated().unwrap();
        assert_eq!(ok.folders.len(), 1);
        assert_eq!(ok.systems.keys().collect::<Vec<_>>(), ["ps1"]);
        let bad = |folders: Vec<(&str, &str)>, systems: Vec<(&str, SystemChoice)>| Settings {
            folders: folders.into_iter().map(|(path, system)| RomFolder { path: path.into(), system: system.into() }).collect(),
            systems: systems.into_iter().map(|(id, choice)| (id.to_owned(), choice)).collect(),
        }.validated().is_err();
        assert!(bad(vec![("relative", "auto")], vec![]));
        assert!(bad(vec![("/roms", "nope")], vec![]));
        assert!(bad(vec![], vec![("snes", SystemChoice { emulator: "dolphin".into(), ..Default::default() })]));
        assert!(bad(vec![], vec![("snes", SystemChoice { core: "../evil".into(), ..Default::default() })]));
        assert!(bad(vec![], vec![("snes", SystemChoice { args: "\"x".into(), ..Default::default() })]));
        let dir = temp_dir("emu-settings");
        let path = dir.join("emulators.json");
        assert_eq!(load_settings(&path), Settings::default());
        save_settings(&path, &ok).unwrap();
        assert_eq!(load_settings(&path), ok);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn emulators_are_found_on_path_in_flatpak_dirs_and_in_app_bundles() {
        let home = temp_dir("emu-detect");
        let which = which_in(&["retroarch", "pcsx2-qt"]);
        let linux = Probe { os: Os::Linux, home: home.clone(), which: &which, system_flatpak: home.join("sys-flatpak"), app_dirs: vec![] };
        fs::create_dir_all(linux.system_flatpak.join("org.ppsspp.PPSSPP")).unwrap();
        fs::create_dir_all(home.join(".local/share/flatpak/app/org.DolphinEmu.dolphin-emu")).unwrap();
        assert_eq!(detect(&linux, emulator("retroarch").unwrap()), Some(Install::Native(PathBuf::from("/usr/bin/retroarch"))));
        assert_eq!(detect(&linux, emulator("pcsx2").unwrap()), Some(Install::Native(PathBuf::from("/usr/bin/pcsx2-qt"))));
        assert_eq!(detect(&linux, emulator("ppsspp").unwrap()), Some(Install::Flatpak("org.ppsspp.PPSSPP".into())));
        assert_eq!(detect(&linux, emulator("duckstation").unwrap()), None);

        let none = which_in(&[]);
        let apps = home.join("Applications");
        fs::create_dir_all(apps.join("Dolphin.app/Contents/MacOS")).unwrap();
        fs::write(apps.join("Dolphin.app/Contents/MacOS/Dolphin"), b"").unwrap();
        let mac = Probe { os: Os::MacOs, home: home.clone(), which: &none, system_flatpak: home.join("sys-flatpak"), app_dirs: vec![PathBuf::from("/nonexistent-apps"), apps.clone()] };
        assert_eq!(detect(&mac, emulator("dolphin").unwrap()), Some(Install::App(apps.join("Dolphin.app/Contents/MacOS/Dolphin"))));
        // Flatpak is never offered on macOS, and MAME has no bundle.
        assert_eq!(detect(&mac, emulator("ppsspp").unwrap()), None);
        assert_eq!(detect(&mac, emulator("mame").unwrap()), None);
        let _ = fs::remove_dir_all(home);
    }

    #[test]
    fn retroarch_cores_come_from_the_install_specific_dirs() {
        let home = temp_dir("emu-cores");
        let none = which_in(&[]);
        let probe = Probe { os: Os::Linux, home: home.clone(), which: &none, system_flatpak: home.join("sys"), app_dirs: vec![] };
        let native = home.join(".config/retroarch/cores");
        let flat = home.join(".var/app/org.libretro.RetroArch/config/retroarch/cores");
        let mac = home.join("Library/Application Support/RetroArch/cores");
        for (dir, file) in [(&native, "snes9x_libretro.so"), (&native, "readme.txt"), (&flat, "mgba_libretro.so"), (&mac, "gambatte_libretro.dylib")] {
            fs::create_dir_all(dir).unwrap();
            fs::write(dir.join(file), b"").unwrap();
        }
        let names = |install: &Install| retroarch_cores(&probe, install).into_keys().collect::<Vec<_>>();
        assert!(names(&Install::Native("/usr/bin/retroarch".into())).contains(&"snes9x".to_owned()));
        assert_eq!(names(&Install::Flatpak("org.libretro.RetroArch".into())), ["mgba"]);
        assert_eq!(names(&Install::App("/Applications/RetroArch.app/Contents/MacOS/RetroArch".into())), ["gambatte"]);
        // Default core is the first preferred one installed; an override must exist.
        let cores = retroarch_cores(&probe, &Install::Native("/x".into()));
        let snes = system("snes").unwrap();
        assert_eq!(pick_core(snes, None, &cores).unwrap(), native.join("snes9x_libretro.so"));
        let missing = SystemChoice { core: "bsnes".into(), ..Default::default() };
        assert!(pick_core(snes, Some(&missing), &cores).is_err());
        assert!(pick_core(system("psp").unwrap(), None, &cores).is_err());
        let _ = fs::remove_dir_all(home);
    }

    fn argv(id: &str, install: Install, rom: &str, core: Option<&str>, args: &[&str]) -> Vec<String> {
        let args: Vec<String> = args.iter().map(|a| (*a).to_owned()).collect();
        build_argv(emulator(id).unwrap(), &install, Path::new(rom), core.map(Path::new), &args).unwrap()
    }

    #[test]
    fn argv_is_built_per_emulator_for_native_installs() {
        let native = |name: &str| Install::Native(PathBuf::from(format!("/usr/bin/{name}")));
        assert_eq!(argv("retroarch", native("retroarch"), "/r/a.sfc", Some("/c/snes9x_libretro.so"), &["-f"]), ["/usr/bin/retroarch", "-f", "-L", "/c/snes9x_libretro.so", "/r/a.sfc"]);
        assert_eq!(argv("dolphin", native("dolphin-emu"), "/r/a.rvz", None, &[]), ["/usr/bin/dolphin-emu", "-b", "-e", "/r/a.rvz"]);
        assert_eq!(argv("pcsx2", native("pcsx2-qt"), "/r/a.iso", None, &[]), ["/usr/bin/pcsx2-qt", "-batch", "--", "/r/a.iso"]);
        assert_eq!(argv("duckstation", native("duckstation-qt"), "/r/-odd.cue", None, &["-fullscreen"]), ["/usr/bin/duckstation-qt", "-fullscreen", "-batch", "--", "/r/-odd.cue"]);
        assert_eq!(argv("ppsspp", native("ppsspp"), "/r/a.iso", None, &[]), ["/usr/bin/ppsspp", "/r/a.iso"]);
        assert_eq!(argv("mame", native("mame"), "/r/arcade/sf2.zip", None, &[]), ["/usr/bin/mame", "-rompath", "/r/arcade", "sf2"]);
        assert_eq!(argv("dolphin", Install::App("/Applications/Dolphin.app/Contents/MacOS/Dolphin".into()), "/r/a.iso", None, &[]), ["/Applications/Dolphin.app/Contents/MacOS/Dolphin", "-b", "-e", "/r/a.iso"]);
    }

    #[test]
    fn flatpak_argv_shares_the_rom_folder_read_only() {
        let flat = |id: &str| Install::Flatpak(id.to_owned());
        assert_eq!(argv("retroarch", flat("org.libretro.RetroArch"), "/r/a.sfc", Some("/h/core.so"), &[]), ["flatpak", "run", "--filesystem=/r:ro", "org.libretro.RetroArch", "-L", "/h/core.so", "/r/a.sfc"]);
        assert_eq!(argv("dolphin", flat("org.DolphinEmu.dolphin-emu"), "/r/a.rvz", None, &[]), ["flatpak", "run", "--filesystem=/r:ro", "org.DolphinEmu.dolphin-emu", "-b", "-e", "/r/a.rvz"]);
        assert_eq!(argv("pcsx2", flat("net.pcsx2.PCSX2"), "/r/a.iso", None, &[]), ["flatpak", "run", "--filesystem=/r:ro", "net.pcsx2.PCSX2", "-batch", "--", "/r/a.iso"]);
        assert!(build_argv(emulator("ppsspp").unwrap(), &flat("org.ppsspp.PPSSPP"), Path::new("/r:x/a.iso"), None, &[]).is_err());
    }

    #[test]
    fn launch_resolves_settings_emulator_core_and_game_arguments() {
        let home = temp_dir("emu-launch");
        let roms = home.join("roms");
        fs::create_dir_all(&roms).unwrap();
        let sfc = rom(&roms, "Mario.sfc");
        let iso = rom(&roms, "Game.iso");
        fs::create_dir_all(home.join(".config/retroarch/cores")).unwrap();
        fs::write(home.join(".config/retroarch/cores/snes9x_libretro.so"), b"").unwrap();
        let which = which_in(&["retroarch", "duckstation-qt"]);
        let probe = Probe { os: Os::Linux, home: home.clone(), which: &which, system_flatpak: home.join("sys"), app_dirs: vec![] };
        let mut settings = Settings::default();
        let line = resolve_launch(&make_target("snes", &sfc), &["-v".to_owned()], &settings, &probe).unwrap();
        assert_eq!(line, ["/usr/bin/retroarch", "-v", "-L", home.join(".config/retroarch/cores/snes9x_libretro.so").to_str().unwrap(), sfc.to_str().unwrap()]);
        settings.systems.insert("ps1".into(), SystemChoice { args: "--fast \"a b\"".into(), ..Default::default() });
        assert_eq!(resolve_launch(&make_target("ps1", &iso), &[], &settings, &probe).unwrap(), ["/usr/bin/duckstation-qt", "--fast", "a b", "-batch", "--", iso.to_str().unwrap()]);
        // No core, no emulator, a missing ROM and an uninstalled choice are explained, not launched.
        assert!(resolve_launch(&make_target("psp", &iso), &[], &settings, &probe).unwrap_err().contains("no core"));
        let nothing = which_in(&[]);
        let bare = Probe { which: &nothing, ..Probe { os: Os::Linux, home: home.clone(), which: &which, system_flatpak: home.join("sys"), app_dirs: vec![] } };
        assert!(resolve_launch(&make_target("psp", &iso), &[], &settings, &bare).unwrap_err().contains("No emulator"));
        assert!(resolve_launch(&make_target("snes", &roms.join("gone.sfc")), &[], &settings, &probe).unwrap_err().contains("no longer exists"));
        settings.systems.insert("ps1".into(), SystemChoice { emulator: "retroarch".into(), ..Default::default() });
        assert!(resolve_launch(&make_target("ps1", &iso), &[], &settings, &probe).unwrap_err().contains("no core"));
        let overview = overview(settings, &probe);
        let snes = overview.systems.iter().find(|s| s.id == "snes").unwrap();
        assert_eq!((snes.default_emulator, snes.default_core.as_deref(), snes.cores.clone()), (Some("retroarch"), Some("snes9x"), vec!["snes9x".to_owned()]));
        assert!(overview.emulators.iter().any(|e| e.id == "duckstation" && e.installed_via == Some("native")));
        let _ = fs::remove_dir_all(home);
    }
}
