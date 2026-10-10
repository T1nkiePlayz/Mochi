//! Finds installed game launchers however they were installed (distro package, Flatpak, Snap,
//! `.app` bundle, a known install folder, or a desktop entry / bundle found by name or id) and
//! reports each launcher once. Detectors only talk to the injected `Env`, so every method is
//! unit-tested with a fake system.
#![cfg_attr(not(any(target_os = "linux", target_os = "macos")), allow(dead_code))]

use super::{classify, make_launcher, ImportKind, ImportedGame};
use crate::util::MutexExt;
use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

/// How a launcher was found. The order is the dedupe preference (first wins): a desktop entry or
/// bundle that was scanned, then a native binary, a known install path, Flatpak, and Snap last.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub enum Method { #[cfg_attr(not(target_os = "linux"), allow(dead_code))] Desktop, AppBundle, Binary, KnownPath, Flatpak, Snap }

/// Where one launcher can be installed. Names, desktop ids and bundle ids live in `classify::LAUNCHERS`.
pub struct Detect {
    pub id: &'static str,
    /// Executables on `PATH`.
    pub bins: &'static [&'static str],
    /// Flatpak application ids.
    pub flatpaks: &'static [&'static str],
    /// Snap names (`/snap/bin/<name>`).
    pub snaps: &'static [&'static str],
    /// macOS bundle folder names inside `/Applications` or `~/Applications`.
    pub apps: &'static [&'static str],
    /// Known executable locations; `~/` is the home folder.
    pub paths: &'static [&'static str],
}

macro_rules! detect {
    ($id:expr, bins: [$($b:expr),*], flatpaks: [$($f:expr),*], snaps: [$($s:expr),*], apps: [$($a:expr),*], paths: [$($p:expr),*]) => {
        Detect { id: $id, bins: &[$($b),*], flatpaks: &[$($f),*], snaps: &[$($s),*], apps: &[$($a),*], paths: &[$($p),*] }
    };
}

pub const DETECTORS: &[Detect] = &[
    detect!("steam", bins: ["steam"], flatpaks: ["com.valvesoftware.Steam"], snaps: ["steam"], apps: ["Steam.app"], paths: ["/usr/games/steam"]),
    detect!("lutris", bins: ["lutris"], flatpaks: ["net.lutris.Lutris"], snaps: [], apps: [], paths: []),
    detect!("heroic", bins: ["heroic"], flatpaks: ["com.heroicgameslauncher.hgl"], snaps: [], apps: ["Heroic Games Launcher.app"], paths: ["/opt/Heroic/heroic"]),
    detect!("bottles", bins: ["bottles"], flatpaks: ["com.usebottles.bottles"], snaps: [], apps: [], paths: []),
    detect!("itch", bins: ["itch", "itch-setup"], flatpaks: ["io.itch.itch"], snaps: [], apps: ["itch.app"], paths: ["~/.itch/itch-setup"]),
    detect!("epic", bins: [], flatpaks: [], snaps: [], apps: ["Epic Games Launcher.app"], paths: []),
    detect!("gog", bins: [], flatpaks: [], snaps: [], apps: ["GOG Galaxy.app"], paths: []),
    detect!("battlenet", bins: [], flatpaks: [], snaps: [], apps: ["Battle.net.app"], paths: []),
    detect!("jagex", bins: ["bolt-launcher", "jagex-launcher"], flatpaks: ["com.adamcake.Bolt"], snaps: [], apps: [], paths: []),
    detect!("minecraft-bedrock", bins: ["mcpelauncher-ui-qt"], flatpaks: ["io.mrarm.mcpelauncher"], snaps: [], apps: [], paths: []),
    detect!("minecraft", bins: ["minecraft-launcher"], flatpaks: ["com.mojang.Minecraft"], snaps: [], apps: ["Minecraft Launcher.app"], paths: ["/opt/minecraft-launcher/minecraft-launcher"]),
    detect!("prism", bins: ["prismlauncher"], flatpaks: ["org.prismlauncher.PrismLauncher"], snaps: [], apps: ["Prism Launcher.app"], paths: []),
    detect!("multimc", bins: ["multimc"], flatpaks: [], snaps: [], apps: ["MultiMC.app"], paths: []),
    detect!("polymc", bins: ["polymc"], flatpaks: ["org.polymc.PolyMC"], snaps: [], apps: ["PolyMC.app"], paths: []),
    detect!("fjord", bins: ["fjordlauncher"], flatpaks: ["io.github.unmojang.FjordLauncher"], snaps: [], apps: ["Fjord Launcher.app"], paths: []),
    detect!("modrinth-app", bins: ["modrinth-app"], flatpaks: ["com.modrinth.ModrinthApp"], snaps: [], apps: ["Modrinth App.app"], paths: []),
    detect!("curseforge", bins: ["curseforge"], flatpaks: [], snaps: [], apps: ["CurseForge.app"], paths: []),
    detect!("gdlauncher", bins: ["gdlauncher"], flatpaks: [], snaps: [], apps: ["GDLauncher.app"], paths: []),
    detect!("atlauncher", bins: ["atlauncher"], flatpaks: ["com.atlauncher.ATLauncher"], snaps: [], apps: ["ATLauncher.app"], paths: []),
    detect!("hytale", bins: ["hytale-launcher"], flatpaks: ["com.hypixel.HytaleLauncher"], snaps: [], apps: ["Hytale Launcher.app"], paths: []),
    detect!("crossover", bins: [], flatpaks: [], snaps: [], apps: ["CrossOver.app"], paths: []),
    detect!("whisky", bins: [], flatpaks: [], snaps: [], apps: ["Whisky.app"], paths: []),
    detect!("retroarch", bins: ["retroarch"], flatpaks: ["org.libretro.RetroArch"], snaps: ["retroarch"], apps: ["RetroArch.app"], paths: []),
    detect!("esde", bins: ["es-de"], flatpaks: ["org.es_de.frontend"], snaps: [], apps: ["ES-DE.app"], paths: []),
    detect!("pegasus", bins: ["pegasus-fe"], flatpaks: ["org.pegasus_frontend.Pegasus"], snaps: [], apps: ["Pegasus.app"], paths: []),
    detect!("minigalaxy", bins: ["minigalaxy"], flatpaks: ["io.github.sharkwouter.Minigalaxy"], snaps: [], apps: [], paths: []),
    detect!("rare", bins: [], flatpaks: ["io.github.dummerle.rare"], snaps: [], apps: [], paths: []),
    detect!("faugus", bins: ["faugus-launcher"], flatpaks: ["io.github.Faugus.faugus-launcher"], snaps: [], apps: [], paths: []),
    detect!("cartridges", bins: ["cartridges"], flatpaks: ["page.kramo.Cartridges"], snaps: [], apps: [], paths: []),
    detect!("playonlinux", bins: ["playonlinux"], flatpaks: [], snaps: [], apps: [], paths: []),
    detect!("gamehub", bins: ["gamehub"], flatpaks: [], snaps: [], apps: [], paths: []),
    detect!("sober", bins: [], flatpaks: ["org.vinegarhq.Sober"], snaps: [], apps: [], paths: []),
    detect!("vinegar", bins: ["vinegar"], flatpaks: ["org.vinegarhq.Vinegar"], snaps: [], apps: [], paths: []),
];

/// Folders holding Snap launchers (`/snap` is a symlink to the second one on Arch and Fedora).
const SNAP_BIN_DIRS: &[&str] = &["/snap/bin", "/var/lib/snapd/snap/bin"];
/// Where Flatpak keeps installed applications (system and per-user).
const FLATPAK_APP_DIRS: &[&str] = &["/var/lib/flatpak/app", "~/.local/share/flatpak/app"];
const APP_DIRS: &[&str] = &["/Applications", "~/Applications"];

/// The system as the detectors see it.
pub trait Env {
    fn home(&self) -> PathBuf;
    /// An executable on `PATH`.
    fn binary(&self, name: &str) -> Option<PathBuf>;
    fn exists(&self, path: &Path) -> bool;
    /// Installed Flatpak applications as (id, name).
    fn flatpaks(&self) -> &[(String, String)];
    /// Launcher entries already found by scanning desktop entries or `.app` bundles, with the method that found them.
    fn scanned(&self) -> &[(Method, ImportedGame)];
}

#[derive(Clone, Debug)]
pub struct DetectedLauncher {
    pub def_id: &'static str,
    /// Stable id of the import item.
    pub id: String,
    pub name: String,
    /// The method that won the dedupe.
    pub method: Method,
    /// Every method that found this launcher (sorted by preference).
    pub methods: Vec<Method>,
    pub launch_target: String,
    pub install_path: Option<String>,
    pub icon_path: Option<String>,
}

impl DetectedLauncher {
    /// The import item for this launcher in `source`.
    pub fn to_item(&self, source: &str) -> ImportedGame {
        let mut item = make_launcher(self.id.clone(), self.name.clone(), source, self.launch_target.clone(), self.def_id);
        item.install_path = self.install_path.clone();
        item.icon_path = self.icon_path.clone();
        debug_assert!(item.kind == ImportKind::Launcher);
        item
    }
}

fn expand(path: &str, home: &Path) -> PathBuf { path.strip_prefix("~/").map(|rest| home.join(rest)).unwrap_or_else(|| PathBuf::from(path)) }

fn flatpak_installed(env: &dyn Env, id: &str, home: &Path) -> bool {
    env.flatpaks().iter().any(|(app, _)| app.eq_ignore_ascii_case(id)) || FLATPAK_APP_DIRS.iter().any(|dir| env.exists(&expand(dir, home).join(id)))
}

fn candidate(def: &'static classify::LauncherDef, method: Method, id: String, target: String, install: Option<String>) -> DetectedLauncher {
    DetectedLauncher { def_id: def.id, id, name: def.name.into(), method, methods: Vec::new(), launch_target: target, install_path: install, icon_path: None }
}

/// Runs every detector and returns one entry per launcher.
///
/// Dedupe rule: all hits for a launcher id are merged into the best one by `Method` order
/// (desktop entry / app bundle, native binary, known path, Flatpak, Snap); ties keep the first
/// hit, so a scanned entry (with its own name and icon) beats a table hit. `methods` lists every
/// method that found it.
pub fn detect_launchers(env: &dyn Env) -> Vec<DetectedLauncher> {
    let home_dir = env.home();
    let home = home_dir.as_path();
    let mut found: Vec<DetectedLauncher> = Vec::new();
    for (method, item) in env.scanned() {
        let Some(def) = item.launcher_id.as_deref().and_then(classify::launcher_def) else { continue };
        let mut hit = candidate(def, *method, item.id.clone(), item.launch_target.clone(), item.install_path.clone());
        hit.name = item.name.clone();
        hit.icon_path = item.icon_path.clone();
        found.push(hit);
    }
    for detect in DETECTORS {
        let Some(def) = classify::launcher_def(detect.id) else { continue };
        let id = format!("launcher:{}", def.id);
        if let Some(path) = detect.bins.iter().find_map(|bin| env.binary(bin)) { found.push(candidate(def, Method::Binary, id.clone(), path.to_string_lossy().into_owned(), None)); }
        if let Some(path) = detect.paths.iter().map(|path| expand(path, home)).find(|path| env.exists(path)) { found.push(candidate(def, Method::KnownPath, id.clone(), path.to_string_lossy().into_owned(), None)); }
        if let Some(flatpak) = detect.flatpaks.iter().find(|flatpak| flatpak_installed(env, flatpak, home)) { found.push(candidate(def, Method::Flatpak, format!("flatpak:{flatpak}"), format!("flatpak://{flatpak}"), None)); }
        if let Some(path) = detect.snaps.iter().flat_map(|snap| SNAP_BIN_DIRS.iter().map(move |dir| Path::new(dir).join(snap))).find(|path| env.exists(path)) {
            found.push(candidate(def, Method::Snap, id.clone(), path.to_string_lossy().into_owned(), None));
        }
        if let Some(path) = detect.apps.iter().flat_map(|app| APP_DIRS.iter().map(move |dir| expand(dir, home).join(app))).find(|path| env.exists(path)) {
            let text = path.to_string_lossy().into_owned();
            found.push(candidate(def, Method::AppBundle, format!("apps:{text}"), text.clone(), Some(text)));
        }
    }
    // Flatpaks recognised by id or display name (launchers the table has no Flatpak id for).
    for (app, name) in env.flatpaks() {
        if let Some(def) = classify::classify_launcher(&[app], name, None) {
            found.push(candidate(def, Method::Flatpak, format!("flatpak:{app}"), format!("flatpak://{app}"), None));
        }
    }
    dedupe(found)
}

fn dedupe(found: Vec<DetectedLauncher>) -> Vec<DetectedLauncher> {
    let mut out: Vec<DetectedLauncher> = Vec::new();
    for hit in found {
        match out.iter_mut().find(|best| best.def_id == hit.def_id) {
            Some(best) => {
                let mut methods = std::mem::take(&mut best.methods);
                methods.push(hit.method);
                if hit.method < best.method { *best = hit; }
                best.methods = methods;
            }
            None => { let mut hit = hit; hit.methods = vec![hit.method]; out.push(hit); }
        }
    }
    for launcher in &mut out { launcher.methods.sort(); launcher.methods.dedup(); }
    out
}

/// Launchers whose own source already lists them (Steam) are never emitted as generic launcher entries.
pub fn emittable(launcher: &DetectedLauncher) -> bool { !classify::SOURCE_OWNED_LAUNCHERS.contains(&launcher.def_id) }

/// A result computed once and reused for a few seconds, so the sources that scan in parallel
/// (and `is_installed`) share one desktop-entry walk and one `flatpak list`.
pub struct Memo<T>(Mutex<Option<(Instant, Arc<T>)>>);

impl<T> Memo<T> {
    pub const fn new() -> Self { Memo(Mutex::new(None)) }

    pub fn get(&self, build: impl FnOnce() -> T) -> Arc<T> {
        const TTL: Duration = Duration::from_secs(4);
        let mut slot = self.0.lock_recover();
        if let Some((_, value)) = slot.as_ref().filter(|(at, _)| at.elapsed() < TTL) { return value.clone(); }
        let value = Arc::new(build());
        *slot = Some((Instant::now(), value.clone()));
        value
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::{HashMap, HashSet};

    #[derive(Default)]
    struct Fake {
        bins: HashMap<&'static str, &'static str>,
        paths: HashSet<PathBuf>,
        flatpaks: Vec<(String, String)>,
        scanned: Vec<(Method, ImportedGame)>,
    }

    impl Env for Fake {
        fn home(&self) -> PathBuf { PathBuf::from("/home/u") }
        fn binary(&self, name: &str) -> Option<PathBuf> { self.bins.get(name).map(PathBuf::from) }
        fn exists(&self, path: &Path) -> bool { self.paths.contains(path) }
        fn flatpaks(&self) -> &[(String, String)] { &self.flatpaks }
        fn scanned(&self) -> &[(Method, ImportedGame)] { &self.scanned }
    }

    fn fake() -> Fake { Fake::default() }
    fn with_path(mut env: Fake, path: &str) -> Fake { env.paths.insert(PathBuf::from(path)); env }
    fn steam(env: &Fake) -> DetectedLauncher { detect_launchers(env).into_iter().find(|l| l.def_id == "steam").expect("steam") }
    fn flatpak(id: &str, name: &str) -> (String, String) { (id.into(), name.into()) }

    #[test]
    fn steam_as_a_distro_package() {
        let mut env = fake();
        env.bins.insert("steam", "/usr/bin/steam");
        let found = steam(&env);
        assert_eq!((found.method, found.launch_target.as_str()), (Method::Binary, "/usr/bin/steam"));
        assert_eq!(steam(&with_path(fake(), "/usr/games/steam")).method, Method::KnownPath);
    }

    #[test]
    fn steam_only_as_flatpak() {
        let mut env = fake();
        env.flatpaks.push(flatpak("com.valvesoftware.Steam", "Steam"));
        let found = steam(&env);
        assert_eq!((found.method, found.launch_target.as_str(), found.methods.len()), (Method::Flatpak, "flatpak://com.valvesoftware.Steam", 1));
        // Found by its install folder when `flatpak list` is unavailable.
        assert_eq!(steam(&with_path(fake(), "/var/lib/flatpak/app/com.valvesoftware.Steam")).method, Method::Flatpak);
        assert_eq!(steam(&with_path(fake(), "/home/u/.local/share/flatpak/app/com.valvesoftware.Steam")).method, Method::Flatpak);
    }

    #[test]
    fn steam_only_as_snap() {
        let found = steam(&with_path(fake(), "/snap/bin/steam"));
        assert_eq!((found.method, found.launch_target.as_str()), (Method::Snap, "/snap/bin/steam"));
        assert_eq!(steam(&with_path(fake(), "/var/lib/snapd/snap/bin/steam")).method, Method::Snap);
    }

    #[test]
    fn macos_app_bundles_are_found_by_name_and_by_scan() {
        assert_eq!(steam(&with_path(fake(), "/Applications/Steam.app")).method, Method::AppBundle);
        let home = steam(&with_path(fake(), "/home/u/Applications/Steam.app"));
        assert_eq!(home.launch_target, "/home/u/Applications/Steam.app");
        // The scanned bundle (renamed on disk) and the by-name hit for the same launcher collapse into one entry.
        let mut env = with_path(fake(), "/Applications/Heroic Games Launcher.app");
        let mut scanned = make_launcher("apps:/Applications/Heroic.app".into(), "Heroic".into(), "apps", "/Applications/Heroic.app".into(), "heroic");
        scanned.icon_path = Some("/icon.icns".into());
        env.scanned.push((Method::AppBundle, scanned));
        let all = detect_launchers(&env);
        let heroic: Vec<_> = all.iter().filter(|l| l.def_id == "heroic").collect();
        assert_eq!(heroic.len(), 1);
        assert_eq!((heroic[0].launch_target.as_str(), heroic[0].icon_path.as_deref()), ("/Applications/Heroic.app", Some("/icon.icns")));
    }

    #[test]
    fn steam_deb_and_flatpak_and_snap_make_one_entry_preferring_native() {
        let mut env = with_path(fake(), "/snap/bin/steam");
        env.bins.insert("steam", "/usr/bin/steam");
        env.flatpaks.push(flatpak("com.valvesoftware.Steam", "Steam"));
        let all = detect_launchers(&env);
        assert_eq!(all.iter().filter(|l| l.def_id == "steam").count(), 1);
        let found = steam(&env);
        assert_eq!((found.method, found.launch_target.as_str()), (Method::Binary, "/usr/bin/steam"));
        assert_eq!(found.methods, vec![Method::Binary, Method::Flatpak, Method::Snap]);
    }

    #[test]
    fn desktop_entry_beats_binary_and_flatpak_beats_snap() {
        let mut env = fake();
        env.bins.insert("lutris", "/usr/bin/lutris");
        env.scanned.push((Method::Desktop, make_launcher("apps:lutris.desktop".into(), "Lutris".into(), "apps", "/usr/share/applications/net.lutris.Lutris.desktop".into(), "lutris")));
        let lutris = detect_launchers(&env).into_iter().find(|l| l.def_id == "lutris").unwrap();
        assert_eq!((lutris.method, lutris.id.as_str(), lutris.methods.clone()), (Method::Desktop, "apps:lutris.desktop", vec![Method::Desktop, Method::Binary]));
        let mut env = with_path(fake(), "/snap/bin/retroarch");
        env.flatpaks.push(flatpak("org.libretro.RetroArch", "RetroArch"));
        let retro = detect_launchers(&env).into_iter().find(|l| l.def_id == "retroarch").unwrap();
        assert_eq!(retro.method, Method::Flatpak);
    }

    #[test]
    fn flatpaks_are_matched_by_name_when_the_table_has_no_id() {
        let mut env = fake();
        env.flatpaks.push(flatpak("io.example.SomethingElse", "Hello Minecraft! Launcher"));
        env.flatpaks.push(flatpak("org.gnome.Calculator", "Calculator"));
        let all = detect_launchers(&env);
        assert_eq!(all.len(), 1);
        assert_eq!((all[0].def_id, all[0].launch_target.as_str()), ("hmcl", "flatpak://io.example.SomethingElse"));
    }

    #[test]
    fn known_paths_expand_home_and_nothing_is_invented() {
        let found = detect_launchers(&with_path(fake(), "/home/u/.itch/itch-setup"));
        assert_eq!((found[0].def_id, found[0].method, found[0].launch_target.as_str()), ("itch", Method::KnownPath, "/home/u/.itch/itch-setup"));
        assert!(detect_launchers(&fake()).is_empty());
    }

    #[test]
    fn steam_is_not_emitted_as_a_generic_launcher() {
        let mut env = fake();
        env.bins.insert("steam", "/usr/bin/steam");
        env.bins.insert("lutris", "/usr/bin/lutris");
        let emitted: Vec<_> = detect_launchers(&env).into_iter().filter(emittable).map(|l| l.def_id).collect();
        assert_eq!(emitted, vec!["lutris"]);
    }

    #[test]
    fn every_detector_points_at_a_known_launcher() {
        for detect in DETECTORS { assert!(classify::launcher_def(detect.id).is_some(), "{}", detect.id); }
    }

    #[test]
    fn memo_reuses_a_fresh_value() {
        let memo = Memo::new();
        let calls = std::cell::Cell::new(0);
        let build = || { calls.set(calls.get() + 1); 7 };
        assert_eq!((*memo.get(build), *memo.get(build)), (7, 7));
        assert_eq!(calls.get(), 1);
    }
}
