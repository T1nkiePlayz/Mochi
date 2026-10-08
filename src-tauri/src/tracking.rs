//! Decides which running processes belong to a launched game.
//!
//! Everything here is pure: it works on a process-table snapshot (`ProcessInfo`
//! values) and optional environment text, so every launcher layout (Steam on
//! Linux/macOS, Proton, Heroic, Lutris, Flatpak, `.app` bundles) is covered by
//! fixture tests that run on any OS. The I/O (reading `/proc`, running `ps`)
//! lives in `process.rs`.

use crate::process::ProcessInfo;
use std::collections::{HashMap, HashSet};

/// Programs that mention a game's path or id but are never the game: launchers
/// handing off, shells wrapping a command, file managers, pagers and the Steam
/// client's own helpers. Compared with the base name of `argv[0]`.
const NEVER_THE_GAME: &[&str] = &[
    "open", "xdg-open", "gio", "gtk-launch", "kioclient", "kioclient5", "kde-open", "steam", "steamwebhelper", "gameoverlayui",
    "steam_osx", "ipcserver", "mochi", "tail", "cat", "less", "more", "head", "vim", "nvim", "vi", "nano", "emacs", "code", "ls",
    "du", "find", "grep", "rg", "rsync", "cp", "mv", "rm", "tar", "unzip", "zip", "ps", "pgrep", "pkill", "lsof", "file", "stat",
    "nautilus", "dolphin", "thunar", "nemo", "pcmanfm", "caja", "finder", "mdworker", "mdworker_shared", "fseventsd", "quicklookd",
    "qlmanage", "mds", "xattr", "codesign", "spctl", "chmod", "chown", "ln", "touch", "wc", "sort", "awk", "sed", "osascript",
];

const SHELLS: &[&str] = &["sh", "bash", "zsh", "fish", "dash"];

/// Lowercase and use forward slashes so Wine's `Z:\games\Foo` equals `/games/foo`.
pub fn normalise(text: &str) -> String {
    text.to_lowercase().replace('\\', "/")
}

fn base_name(path: &str) -> &str {
    path.rsplit(['/', '\\']).next().unwrap_or(path)
}

/// True for a process that can never be the game itself.
fn is_helper(info: &ProcessInfo) -> bool {
    let name = base_name(&info.argv0).to_lowercase();
    if NEVER_THE_GAME.contains(&name.as_str()) { return true; }
    // `sh -c "..."` style wrappers; a shell running a game's own script is fine.
    SHELLS.contains(&name.as_str()) && info.cmdline.split_whitespace().any(|part| part == "-c")
}

/// What identifies one launched game.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Matcher {
    /// Steam app ids that may appear in `AppId=` arguments or `SteamAppId`-style environment variables.
    steam_ids: Vec<String>,
    /// Lowercase path prefixes, each ending in `/` (install folders and `.app` bundles).
    needles: Vec<String>,
    /// Flatpak application id (matches `FLATPAK_ID` and `flatpak run <id>`).
    flatpak_id: Option<String>,
}

/// Folders too broad to identify one game ("/", "/home/me", "/Applications", ...).
fn too_broad(normalised: &str, min_components: usize) -> bool {
    let components = normalised.split('/').filter(|part| !part.is_empty()).count();
    components < min_components
        || matches!(normalised.trim_end_matches('/'), "/usr/bin" | "/usr/local/bin" | "/usr/share" | "/usr/lib" | "/opt" | "/bin" | "/tmp" | "/applications" | "/system/applications" | "/users/shared")
}

fn needle_for(path: &str, min_components: usize) -> Option<String> {
    let path = normalise(path.trim());
    let path = path.trim_end_matches('/');
    if path.is_empty() || !path.starts_with('/') || too_broad(path, min_components) { return None; }
    Some(format!("{path}/"))
}

/// Steam ids to look for. Non-Steam shortcuts use `(appid << 32) | 0x02000000`, and
/// Steam exposes either form depending on the component.
fn steam_ids(id: &str) -> Vec<String> {
    let Ok(value) = id.parse::<u64>() else { return Vec::new() };
    if value == 0 { return Vec::new(); }
    let mut ids = vec![value.to_string()];
    if value > u64::from(u32::MAX) { ids.push((value >> 32).to_string()); }
    ids
}

impl Matcher {
    /// Builds a matcher from the launch target (`steam://rungameid/N`, `/path/App.app`,
    /// `flatpak://id`, a file path, ...) and the game's install folder. `None` when nothing
    /// reliable identifies the game, in which case Mochi does not guess.
    pub fn new(target: &str, install_path: Option<&str>) -> Option<Matcher> {
        let target = target.trim();
        let mut matcher = Matcher::default();

        if let Some(id) = target.strip_prefix("steam://rungameid/") { matcher.steam_ids = steam_ids(id.trim_matches('/')); }
        if let Some(id) = target.strip_prefix("flatpak://").or_else(|| target.strip_prefix("flatpak run ")) {
            let id = id.trim();
            if !id.is_empty() { matcher.flatpak_id = Some(id.to_string()); }
        }
        let trimmed = target.trim_end_matches('/');
        if trimmed.to_lowercase().ends_with(".app") {
            matcher.needles.extend(needle_for(trimmed, 2));
        }
        if let Some(path) = install_path.map(str::trim).filter(|path| !path.is_empty()) {
            matcher.add_install_dir(path);
        } else if target.starts_with('/') && !trimmed.to_lowercase().ends_with(".app") {
            // Only a file's folder is known (a script or binary): it must be specific enough.
            if let Some(parent) = std::path::Path::new(trimmed).parent().and_then(|parent| parent.to_str()) {
                matcher.needles.extend(needle_for(parent, 4));
            }
        }
        matcher.needles.sort();
        matcher.needles.dedup();
        (!matcher.steam_ids.is_empty() || !matcher.needles.is_empty() || matcher.flatpak_id.is_some()).then_some(matcher)
    }

    fn add_install_dir(&mut self, path: &str) {
        let Some(needle) = needle_for(path, 3) else { return };
        // The same Steam library can be mounted elsewhere inside a sandbox (Flatpak Steam,
        // pressure-vessel), so also match from `/steamapps/common/<game>/` on.
        if let Some(index) = needle.find("/steamapps/common/") {
            let tail = &needle[index..];
            if tail.len() > "/steamapps/common/".len() + 1 { self.needles.push(tail.to_string()); }
        }
        self.needles.push(needle);
    }

    /// True when `text` (a command line or working directory) mentions one of the install folders.
    fn mentions_path(&self, text: &str) -> bool {
        let text = normalise(text);
        self.needles.iter().any(|needle| {
            let bare = &needle[..needle.len() - 1];
            text.contains(needle.as_str()) || text.ends_with(bare) || text.contains(&format!("{bare}\"")) || text.contains(&format!("{bare}'"))
        })
    }

    /// Steam's `reaper SteamLaunch AppId=N -- ...` and `-gameidlaunch N` forms.
    fn mentions_steam_id(&self, cmdline: &str) -> bool {
        if self.steam_ids.is_empty() { return false; }
        let mut parts = cmdline.split_whitespace();
        while let Some(part) = parts.next() {
            let lower = part.to_ascii_lowercase();
            if let Some(id) = lower.strip_prefix("appid=") {
                if self.steam_ids.iter().any(|known| known == id) { return true; }
            }
            if lower == "-gameidlaunch" || lower == "--appid" {
                if let Some(id) = parts.next() { if self.steam_ids.iter().any(|known| known == id) { return true; } }
            }
        }
        false
    }

    fn mentions_flatpak(&self, cmdline: &str) -> bool {
        let Some(id) = &self.flatpak_id else { return false };
        let tokens: Vec<&str> = cmdline.split_whitespace().collect();
        let Some(position) = tokens.iter().position(|token| base_name(token) == "flatpak") else { return false };
        if tokens.get(position + 1) != Some(&"run") { return false; }
        // `flatpak run [--opts] <id> [args]`: the id is the first word that is not an option.
        tokens[position + 2..].iter().find(|word| !word.starts_with('-')) == Some(&id.as_str())
    }

    /// Decides from the command line alone.
    pub fn cmdline_matches(&self, info: &ProcessInfo) -> bool {
        !is_helper(info) && (self.mentions_steam_id(&info.cmdline) || self.mentions_path(&info.cmdline) || self.mentions_flatpak(&info.cmdline))
    }

    /// Decides from the process environment (`NAME=value` entries separated by NUL).
    pub fn environment_matches(&self, environ: &str) -> bool {
        environ.split('\0').any(|entry| {
            let Some((name, value)) = entry.split_once('=') else { return false };
            match name {
                "SteamAppId" | "SteamGameId" | "STEAM_COMPAT_APP_ID" => self.steam_ids.iter().any(|id| id == value),
                "FLATPAK_ID" => self.flatpak_id.as_deref() == Some(value),
                _ => false,
            }
        })
    }

    /// Whether the environment can ever identify this game (saves reading it otherwise).
    pub fn uses_environment(&self) -> bool { !self.steam_ids.is_empty() || self.flatpak_id.is_some() }

    pub fn has_steam_id(&self) -> bool { !self.steam_ids.is_empty() }

    /// Every process of the game: the ones identified directly plus everything they started.
    /// `env_matches` is asked only about processes that survived the cheap command-line check
    /// and that `is_candidate` (e.g. started after the launch) allows.
    pub fn select(
        &self,
        table: &HashMap<u32, ProcessInfo>,
        own_pid: u32,
        is_candidate: &dyn Fn(&ProcessInfo) -> bool,
        env_matches: &mut dyn FnMut(&ProcessInfo) -> bool,
    ) -> HashSet<u32> {
        let mut found: HashSet<u32> = HashSet::new();
        for info in table.values() {
            if info.pid == own_pid || is_helper(info) { continue; }
            if self.cmdline_matches(info) || (self.uses_environment() && is_candidate(info) && env_matches(info)) {
                found.insert(info.pid);
            }
        }
        // Children of the game belong to it (reaper -> proton -> wine -> game.exe).
        let mut children: HashMap<u32, Vec<u32>> = HashMap::new();
        for info in table.values() { children.entry(info.ppid).or_default().push(info.pid); }
        let mut queue: Vec<u32> = found.iter().copied().collect();
        while let Some(pid) = queue.pop() {
            for child in children.get(&pid).into_iter().flatten() {
                let Some(info) = table.get(child) else { continue };
                if *child != own_pid && !is_helper(info) && found.insert(*child) { queue.push(*child); }
            }
        }
        found
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn proc(pid: u32, ppid: u32, cmdline: &str) -> ProcessInfo {
        let argv0 = cmdline.split_whitespace().next().unwrap_or("").to_string();
        ProcessInfo { pid, ppid, pgid: pid, cmdline: cmdline.into(), argv0, start_time: 0 }
    }

    fn table(list: Vec<ProcessInfo>) -> HashMap<u32, ProcessInfo> { list.into_iter().map(|p| (p.pid, p)).collect() }

    fn select(matcher: &Matcher, table: &HashMap<u32, ProcessInfo>) -> Vec<u32> {
        let mut pids: Vec<u32> = matcher.select(table, 1, &|_| true, &mut |_| false).into_iter().collect();
        pids.sort_unstable();
        pids
    }

    #[test]
    fn matcher_needs_something_reliable() {
        assert!(Matcher::new("", None).is_none());
        assert!(Matcher::new("lutris:rungameid/5", None).is_none());
        // A game in the home folder or /usr/bin must not match everything under it.
        assert!(Matcher::new("/usr/bin/game", None).is_none());
        assert!(Matcher::new("lutris:rungameid/5", Some("/home/me")).is_none());
        assert!(Matcher::new("heroic://launch", Some("/")).is_none());
        assert!(Matcher::new("lutris:rungameid/5", Some("/home/me/Games/Foo")).is_some());
        assert!(Matcher::new("/home/me/Games/Foo/start.sh", None).is_some());
    }

    #[test]
    fn steam_native_game_is_found_by_install_dir() {
        let matcher = Matcher::new("steam://rungameid/620", Some("/home/me/.local/share/Steam/steamapps/common/Portal 2")).unwrap();
        let processes = table(vec![
            proc(10, 1, "/home/me/.local/share/Steam/ubuntu12_32/steam"),
            proc(11, 10, "steam steam://rungameid/620"),
            proc(20, 10, "/home/me/.local/share/Steam/steamapps/common/Portal 2/portal2_linux -game portal2"),
            proc(30, 1, "vim /home/me/.local/share/Steam/steamapps/common/Portal 2/notes.txt"),
            proc(31, 1, "/usr/lib/firefox/firefox"),
        ]);
        assert_eq!(select(&matcher, &processes), vec![20]);
    }

    #[test]
    fn proton_chain_is_followed_through_reaper_and_wine() {
        let matcher = Matcher::new("steam://rungameid/1245620", Some("/games/steamapps/common/ELDEN RING")).unwrap();
        let processes = table(vec![
            proc(10, 1, "/home/me/.steam/steam/ubuntu12_32/steam -bigpicture"),
            proc(40, 10, "/home/me/.steam/ubuntu12_32/reaper SteamLaunch AppId=1245620 -- /home/me/.steam/steamapps/common/Proton 9.0/proton waitforexitandrun /games/steamapps/common/ELDEN RING/Game/eldenring.exe"),
            proc(41, 40, "python3 /home/me/.steam/steamapps/common/Proton 9.0/proton waitforexitandrun /games/steamapps/common/ELDEN RING/Game/eldenring.exe"),
            proc(42, 41, "C:\\windows\\system32\\services.exe"),
            proc(43, 42, "wineserver -p"),
            proc(44, 41, "Z:\\games\\steamapps\\common\\ELDEN RING\\Game\\eldenring.exe"),
            proc(50, 1, "reaper SteamLaunch AppId=9999 -- something-else"),
        ]);
        assert_eq!(select(&matcher, &processes), vec![40, 41, 42, 43, 44]);
    }

    #[test]
    fn steam_app_id_in_environment_catches_launchers_without_paths() {
        let matcher = Matcher::new("steam://rungameid/440", None).unwrap();
        let processes = table(vec![proc(60, 1, "/usr/bin/bwrap --args 40 -- /opt/runtime/wrapper"), proc(61, 60, "game_launcher")]);
        let mut asked = Vec::new();
        let found = matcher.select(&processes, 1, &|p| p.pid == 60, &mut |p| { asked.push(p.pid); p.pid == 60 });
        assert_eq!(asked, vec![60]);
        assert_eq!(found, HashSet::from([60, 61]));
        assert!(matcher.environment_matches("HOME=/home/me\0SteamAppId=440\0PATH=/bin"));
        assert!(!matcher.environment_matches("SteamAppId=4400\0STEAM_COMPAT_APP_ID=44"));
        assert!(matcher.environment_matches("STEAM_COMPAT_APP_ID=440"));
    }

    #[test]
    fn app_ids_are_compared_exactly() {
        let matcher = Matcher::new("steam://rungameid/10", None).unwrap();
        assert!(matcher.cmdline_matches(&proc(2, 1, "reaper SteamLaunch AppId=10 -- x")));
        assert!(!matcher.cmdline_matches(&proc(3, 1, "reaper SteamLaunch AppId=100 -- x")));
        assert!(!matcher.cmdline_matches(&proc(4, 1, "reaper SteamLaunch AppId=1 -- x")));
    }

    #[test]
    fn non_steam_shortcut_ids_match_both_forms() {
        let id = (3_000_000_000u64 << 32) | 0x0200_0000;
        let matcher = Matcher::new(&format!("steam://rungameid/{id}"), None).unwrap();
        assert!(matcher.environment_matches("SteamAppId=3000000000"));
        assert!(matcher.environment_matches(&format!("SteamGameId={id}")));
        assert!(matcher.cmdline_matches(&proc(2, 1, "reaper SteamLaunch AppId=3000000000 -- x")));
    }

    #[test]
    fn flatpak_apps_match_by_command_and_environment() {
        let matcher = Matcher::new("flatpak://org.supertuxproject.SuperTux", None).unwrap();
        assert!(matcher.cmdline_matches(&proc(2, 1, "flatpak run org.supertuxproject.SuperTux")));
        assert!(matcher.cmdline_matches(&proc(3, 1, "/usr/bin/flatpak run --branch=stable org.supertuxproject.SuperTux --fullscreen")));
        assert!(!matcher.cmdline_matches(&proc(4, 1, "flatpak run org.other.App")));
        assert!(!matcher.cmdline_matches(&proc(5, 1, "flatpak list")));
        assert!(matcher.environment_matches("FLATPAK_ID=org.supertuxproject.SuperTux\0A=b"));
        assert!(!matcher.environment_matches("FLATPAK_ID=org.other.App"));
    }

    #[test]
    fn flatpak_steam_sees_the_library_through_a_different_mount() {
        let matcher = Matcher::new("steam://rungameid/70", Some("/home/me/.var/app/com.valvesoftware.Steam/.local/share/Steam/steamapps/common/Half-Life")).unwrap();
        // Inside the sandbox the library is mounted at the usual place.
        assert!(matcher.cmdline_matches(&proc(2, 1, "/home/me/.local/share/Steam/steamapps/common/Half-Life/hl.sh -game valve")));
        assert!(!matcher.cmdline_matches(&proc(3, 1, "/home/me/.local/share/Steam/steamapps/common/Half-Life 2/hl2.sh")));
    }

    #[test]
    fn heroic_wine_paths_with_windows_separators_match() {
        let matcher = Matcher::new("heroic://launch?appName=Sugar&runner=legendary", Some("/home/me/Games/Heroic/Celeste")).unwrap();
        let processes = table(vec![
            proc(70, 1, "/usr/bin/heroic --no-sandbox"),
            proc(71, 70, "/home/me/.config/heroic/tools/wine/Wine-GE/bin/wine64 Z:\\home\\me\\Games\\Heroic\\Celeste\\Celeste.exe"),
            proc(72, 71, "C:\\windows\\system32\\winedevice.exe"),
            proc(73, 1, "/home/me/Games/Heroic/Celeste Classic/celeste"),
        ]);
        assert_eq!(select(&matcher, &processes), vec![71, 72]);
    }

    #[test]
    fn lutris_and_bottles_games_match_by_install_dir_or_cwd_argument() {
        let matcher = Matcher::new("lutris:rungameid/12", Some("/home/me/Games/gog/witcher3")).unwrap();
        assert!(matcher.cmdline_matches(&proc(2, 1, "wine /home/me/Games/gog/witcher3/bin/x64/witcher3.exe")));
        assert!(matcher.cmdline_matches(&proc(3, 1, "/opt/tool --chdir \"/home/me/Games/gog/witcher3\"")));
        assert!(!matcher.cmdline_matches(&proc(4, 1, "wine /home/me/Games/gog/witcher3-mod/x.exe")));
    }

    #[test]
    fn macos_app_bundles_match_the_bundle_only() {
        let matcher = Matcher::new("/Applications/Hades.app", Some("/Applications/Hades.app")).unwrap();
        let processes = table(vec![
            proc(80, 1, "/usr/bin/open -a /Applications/Hades.app"),
            proc(81, 1, "/Applications/Hades.app/Contents/MacOS/Hades"),
            proc(82, 81, "/Applications/Hades.app/Contents/Frameworks/Helper.app/Contents/MacOS/Helper"),
            proc(83, 1, "/Applications/Hades Tools.app/Contents/MacOS/Tools"),
            proc(84, 1, "/Applications/Safari.app/Contents/MacOS/Safari"),
        ]);
        assert_eq!(select(&matcher, &processes), vec![81, 82]);
        // Names with spaces and different case.
        let spaced = Matcher::new("/Applications/Dead Cells.app/", None).unwrap();
        assert!(spaced.cmdline_matches(&proc(2, 1, "/Applications/Dead Cells.app/Contents/MacOS/Dead Cells")));
    }

    #[test]
    fn macos_steam_game_is_found_in_the_steam_library() {
        let matcher = Matcher::new("steam://rungameid/105600", Some("/Users/me/Library/Application Support/Steam/steamapps/common/Terraria")).unwrap();
        assert!(matcher.cmdline_matches(&proc(2, 1, "/Users/me/Library/Application Support/Steam/steamapps/common/Terraria/Terraria.app/Contents/MacOS/Terraria")));
        assert!(!matcher.cmdline_matches(&proc(3, 1, "/Applications/Steam.app/Contents/MacOS/steam_osx")));
    }

    #[test]
    fn helpers_and_wrappers_are_never_the_game() {
        let matcher = Matcher::new("lutris:rungameid/1", Some("/mnt/games/foo")).unwrap();
        assert!(!matcher.cmdline_matches(&proc(2, 1, "xdg-open /mnt/games/foo/readme.html")));
        assert!(!matcher.cmdline_matches(&proc(3, 1, "bash -c cd /mnt/games/foo/ && ./run")));
        assert!(!matcher.cmdline_matches(&proc(4, 1, "nautilus /mnt/games/foo")));
        assert!(!matcher.cmdline_matches(&proc(5, 1, "/usr/bin/open /mnt/games/foo/Foo.app")));
        assert!(matcher.cmdline_matches(&proc(6, 1, "bash /mnt/games/foo/start.sh")));
        // The process that is Mochi itself is skipped even when it matches.
        let processes = table(vec![proc(1, 0, "/mnt/games/foo/mochi-test")]);
        assert!(select(&matcher, &processes).is_empty());
    }

    #[test]
    fn an_exited_game_yields_nothing() {
        let matcher = Matcher::new("steam://rungameid/620", Some("/lib/steamapps/common/Portal 2")).unwrap();
        let processes = table(vec![proc(10, 1, "steam"), proc(11, 10, "steamwebhelper -lang=en")]);
        assert!(select(&matcher, &processes).is_empty());
    }
}
