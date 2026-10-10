//! Per-game launch options: validation, the final argv and the preview of it. Everything here is pure
//! (tools are looked up through `Tools`), so launching and the editor's preview share one code path and
//! the tests need neither Wine nor gamescope. No shell is ever involved: the result is an argv.

use super::{LaunchConfig, RuntimeInfo};
use serde::Serialize;
use std::path::{Path, PathBuf};

pub const MAX_ENV: usize = 64;
pub const MAX_ARGS: usize = 256;
pub const MAX_GAMESCOPE_ARGS: usize = 64;
pub const MAX_ITEM_BYTES: usize = 4096;
/// The wrappers Mochi can put in front of a program, in the order they are applied.
const WRAPPERS: [(&str, &str); 2] = [("gamemoderun", "GameMode"), ("mangohud", "MangoHud")];

/// Where tools are looked up; tests supply fakes.
pub struct Tools<'a> {
    pub which: &'a dyn Fn(&str) -> Option<PathBuf>,
    pub runtimes: &'a dyn Fn() -> Vec<RuntimeInfo>,
    pub steam_root: &'a dyn Fn() -> Option<PathBuf>,
}

/// How much of the launch options a target can use.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Applies {
    /// A program or app Mochi starts itself: everything applies.
    Full,
    /// `flatpak run`: environment and arguments, as flatpak flags.
    Flatpak,
    /// `steam://`: Steam starts the game, so only a launch option string to paste into Steam helps.
    Steam,
    /// Another launcher starts the game; nothing can be passed through.
    None,
}

pub fn classify(target: &str) -> (Applies, Option<&'static str>) {
    if target.starts_with("steam://") { return (Applies::Steam, Some("Steam starts this game itself. Paste the option string below into the game's Properties, Launch options in Steam.")); }
    if target.starts_with("flatpak://") || target.starts_with("flatpak run ") { return (Applies::Flatpak, Some("Environment variables and arguments are passed to flatpak run. Wrappers, runtimes and the working directory do not apply to Flatpak apps.")); }
    if target.ends_with(".desktop") { return (Applies::None, Some("Launch options cannot be passed through a .desktop entry. Point the launch target at the program itself to use them.")); }
    if crate::sources::prism::parse_instance_target(target).is_some() { return (Applies::None, Some("The Minecraft launcher starts this instance. Set its options in that launcher.")); }
    if target.starts_with("heroic://") || target.starts_with("bottles:run/") || target.starts_with("lutris:") || target.starts_with("itch://") || target.starts_with("legendary://") || target.starts_with("nile://") || crate::sources::battlenet::parse_wine_target(target).is_some() {
        return (Applies::None, Some("Another launcher starts this game, so Mochi's launch options do not apply. Set them in that launcher."));
    }
    (Applies::Full, None)
}

/// Every problem with the options themselves (not with the installed tools). `check_fs` also checks the working directory.
pub fn validate(config: &LaunchConfig, linux: bool, check_fs: bool) -> Vec<String> {
    let mut errors = Vec::new();
    let item = |what: &str, value: &str, errors: &mut Vec<String>| {
        if value.contains('\0') { errors.push(format!("{what} contains an invalid character.")); }
        else if value.len() > MAX_ITEM_BYTES { errors.push(format!("{what} is longer than {MAX_ITEM_BYTES} characters.")); }
    };
    if config.env.len() > MAX_ENV { errors.push(format!("At most {MAX_ENV} environment variables are allowed.")); }
    for (key, value) in &config.env {
        if !super::valid_env_name(key) { errors.push(format!("\"{key}\" is not a valid variable name. Use letters, digits and underscores, not starting with a digit.")); }
        item(&format!("The value of {key}"), value, &mut errors);
    }
    if config.args.len() > MAX_ARGS { errors.push(format!("At most {MAX_ARGS} arguments are allowed.")); }
    for arg in &config.args { item("An argument", arg, &mut errors); }
    if linux && config.gamescope.enabled {
        if config.gamescope.args.len() > MAX_GAMESCOPE_ARGS { errors.push(format!("At most {MAX_GAMESCOPE_ARGS} gamescope arguments are allowed.")); }
        for arg in &config.gamescope.args { item("A gamescope argument", arg, &mut errors); }
    }
    if let Some(dir) = config.working_dir.as_deref().filter(|dir| !dir.is_empty()) {
        item("The working directory", dir, &mut errors);
        if check_fs && !dir.contains('\0') && !Path::new(dir).is_dir() { errors.push(format!("The working directory \"{dir}\" does not exist or is not a folder.")); }
    }
    if let Some(runtime) = &config.runtime { item("The runtime", runtime, &mut errors); }
    errors
}

/// The program, its arguments and the environment a runtime needs (user variables are applied on top).
#[derive(Debug, Default, Clone)]
pub struct Plan {
    pub argv: Vec<String>,
    pub env: Vec<(String, String)>,
    /// Directories that must exist before starting (a Wine or Proton prefix).
    pub create_dirs: Vec<PathBuf>,
}

fn path_string(path: &Path) -> String { path.to_string_lossy().into_owned() }

/// The argv for a file target: [gamescope args --] [gamemoderun] [mangohud] [wine | proton run] program [args].
pub fn plan_file(target: &str, config: &LaunchConfig, tools: &Tools, linux: bool, prefix: Option<&Path>) -> Result<Plan, String> {
    let extension = Path::new(target).extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    let mut plan = Plan::default();
    let mut inner: Vec<String> = Vec::new();
    match extension.as_str() {
        "exe" | "bat" | "msi" | "lnk" if linux => {
            let runtime = config.runtime.as_deref().filter(|id| !id.is_empty()).map(str::to_owned).or_else(|| (tools.which)("wine").map(|_| "wine".to_owned()))
                .ok_or("This Windows program needs Wine or Proton. Pick a runtime in the launch options.")?;
            let known = (tools.runtimes)();
            let selected = known.iter().find(|r| r.kind == "compat" && r.id == runtime).ok_or("The selected runtime is no longer installed.")?;
            if let Some(prefix) = prefix {
                plan.create_dirs.push(prefix.to_path_buf());
                if runtime == "wine" {
                    plan.env.push(("WINEPREFIX".into(), path_string(prefix)));
                } else {
                    plan.env.push(("STEAM_COMPAT_DATA_PATH".into(), path_string(prefix)));
                    let client = (tools.steam_root)().ok_or("Proton needs a Steam installation.")?;
                    plan.env.push(("STEAM_COMPAT_CLIENT_INSTALL_PATH".into(), path_string(&client)));
                }
            }
            inner.push(selected.path.clone());
            if runtime != "wine" { inner.push("run".into()); }
            inner.push(target.into());
        }
        "sh" | "bash" => inner.extend(["sh".into(), target.into()]),
        "command" if !linux => inner.extend(["sh".into(), target.into()]),
        "py" => inner.extend(["python3".into(), target.into()]),
        "js" => inner.extend(["node".into(), target.into()]),
        _ => inner.push(target.into()),
    }
    inner.extend(config.args.iter().cloned());

    if linux {
        if config.gamescope.enabled {
            let path = (tools.which)("gamescope").ok_or("gamescope is not installed.")?;
            plan.argv.push(path_string(&path));
            plan.argv.extend(config.gamescope.args.iter().cloned());
            plan.argv.push("--".into());
        }
        for id in &config.wrappers {
            if !WRAPPERS.iter().any(|(command, _)| command == id) { return Err(format!("Unknown launch wrapper '{id}'.")); }
        }
        for (command, name) in WRAPPERS {
            if config.wrappers.iter().any(|id| id == command) {
                plan.argv.push(path_string(&(tools.which)(command).ok_or_else(|| format!("{name} is not installed."))?));
            }
        }
    }
    plan.argv.extend(inner);
    Ok(plan)
}

/// `flatpak run [--env=K=V ...] id [args]`: flatpak scrubs the environment, so variables travel as flags.
pub fn flatpak_argv(id: &str, config: &LaunchConfig) -> Vec<String> {
    let mut argv = vec!["flatpak".to_owned(), "run".into()];
    argv.extend(config.env.iter().map(|(key, value)| format!("--env={key}={value}")));
    argv.push(id.into());
    argv.extend(config.args.iter().cloned());
    argv
}

/// Quotes one word for display (and for pasting into a shell or Steam's launch options).
pub fn shell_quote(word: &str) -> String {
    if !word.is_empty() && word.chars().all(|c| c.is_ascii_alphanumeric() || "_@%+=:,./-".contains(c)) { return word.to_owned(); }
    format!("'{}'", word.replace('\'', "'\\''"))
}

/// The line to paste into a game's Steam launch options: `K=V gamescope .. -- gamemoderun mangohud %command% args`.
pub fn steam_options(config: &LaunchConfig, linux: bool) -> String {
    let mut words: Vec<String> = config.env.iter().map(|(key, value)| format!("{key}={}", shell_quote(value))).collect();
    if linux && config.gamescope.enabled {
        words.push("gamescope".into());
        words.extend(config.gamescope.args.iter().map(|arg| shell_quote(arg)));
        words.push("--".into());
    }
    if linux { for (command, _) in WRAPPERS { if config.wrappers.iter().any(|id| id == command) { words.push(command.into()); } } }
    words.push("%command%".into());
    words.extend(config.args.iter().map(|arg| shell_quote(arg)));
    words.join(" ")
}

/// What the editor shows: the same argv, environment and directory a launch would use.
#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LaunchPreview {
    pub applies: Option<Applies>,
    pub note: Option<String>,
    pub argv: Vec<String>,
    pub env: Vec<(String, String)>,
    pub cwd: Option<String>,
    /// `cd DIR && K=V program args`, quoted for reading; never run through a shell.
    pub command: Option<String>,
    pub steam_options: Option<String>,
    pub errors: Vec<String>,
}

fn display_command(argv: &[String], env: &[(String, String)], cwd: Option<&str>) -> String {
    let mut parts: Vec<String> = Vec::new();
    if let Some(dir) = cwd { parts.push(format!("cd {} &&", shell_quote(dir))); }
    parts.extend(env.iter().map(|(key, value)| format!("{key}={}", shell_quote(value))));
    parts.extend(argv.iter().map(|word| shell_quote(word)));
    parts.join(" ")
}

pub fn preview(target: &str, config: &LaunchConfig, tools: &Tools, linux: bool, prefix: Option<&Path>) -> LaunchPreview {
    let target = target.trim();
    let (applies, note) = classify(target);
    let mut out = LaunchPreview { applies: Some(applies), note: note.map(str::to_owned), ..Default::default() };
    if target.is_empty() { out.errors.push("Set a launch target first.".into()); return out; }
    out.errors = validate(config, linux, true);
    match applies {
        Applies::None => { out.errors.clear(); }
        Applies::Steam => { if out.errors.is_empty() { out.steam_options = Some(steam_options(config, linux)); } }
        Applies::Flatpak => {
            let id = target.strip_prefix("flatpak://").or_else(|| target.strip_prefix("flatpak run ")).unwrap_or("").trim();
            if out.errors.is_empty() { out.argv = flatpak_argv(id, config); out.command = Some(display_command(&out.argv, &[], None)); }
        }
        Applies::Full => {
            if out.errors.is_empty() {
                match plan_file(target, config, tools, linux, prefix) {
                    Ok(plan) => {
                        let mut env = plan.env;
                        for (key, value) in &config.env { env.retain(|(existing, _)| existing != key); env.push((key.clone(), value.clone())); }
                        out.cwd = config.working_dir.clone().filter(|dir| !dir.is_empty());
                        out.command = Some(display_command(&plan.argv, &env, out.cwd.as_deref()));
                        out.argv = plan.argv;
                        out.env = env;
                    }
                    Err(error) => out.errors.push(error),
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    fn runtimes() -> Vec<RuntimeInfo> {
        vec![
            RuntimeInfo { id: "wine".into(), name: "Wine".into(), kind: "compat".into(), path: "/usr/bin/wine".into() },
            RuntimeInfo { id: "proton:/p/GE/proton".into(), name: "GE".into(), kind: "compat".into(), path: "/p/GE/proton".into() },
        ]
    }
    fn which_all(name: &str) -> Option<PathBuf> { Some(PathBuf::from(format!("/usr/bin/{name}"))) }
    fn which_none(_: &str) -> Option<PathBuf> { None }
    fn steam() -> Option<PathBuf> { Some(PathBuf::from("/home/u/.steam/steam")) }
    fn full() -> Tools<'static> { Tools { which: &which_all, runtimes: &runtimes, steam_root: &steam } }
    fn bare() -> Tools<'static> { Tools { which: &which_none, runtimes: &|| Vec::new(), steam_root: &|| None } }
    fn config() -> LaunchConfig {
        LaunchConfig { args: vec!["-fullscreen".into(), "two words".into()], env: BTreeMap::from([("A".to_owned(), "1".to_owned())]), ..Default::default() }
    }

    #[test]
    fn plain_native_program_gets_only_its_arguments() {
        let plan = plan_file("/g/game.x86_64", &config(), &full(), true, None).unwrap();
        assert_eq!(plan.argv, ["/g/game.x86_64", "-fullscreen", "two words"]);
        assert!(plan.env.is_empty());
    }

    #[test]
    fn wrappers_nest_in_the_documented_order() {
        let mut c = config();
        c.wrappers = vec!["mangohud".into(), "gamemoderun".into()];
        c.gamescope.enabled = true;
        c.gamescope.args = vec!["-W".into(), "1920".into()];
        let plan = plan_file("/g/run.sh", &c, &full(), true, None).unwrap();
        assert_eq!(plan.argv, ["/usr/bin/gamescope", "-W", "1920", "--", "/usr/bin/gamemoderun", "/usr/bin/mangohud", "sh", "/g/run.sh", "-fullscreen", "two words"]);
    }

    #[test]
    fn every_wrapper_combination_keeps_the_program_last() {
        for mask in 0..8u8 {
            let mut c = LaunchConfig::default();
            c.gamescope.enabled = mask & 1 != 0;
            if mask & 2 != 0 { c.wrappers.push("gamemoderun".into()); }
            if mask & 4 != 0 { c.wrappers.push("mangohud".into()); }
            let argv = plan_file("/g/bin", &c, &full(), true, None).unwrap().argv;
            assert_eq!(argv.last().unwrap(), "/g/bin");
            assert_eq!(argv.len(), 1 + (mask & 2 != 0) as usize + (mask & 4 != 0) as usize + if mask & 1 != 0 { 2 } else { 0 });
            assert_eq!(argv.iter().any(|a| a == "--"), mask & 1 != 0);
        }
    }

    #[test]
    fn wine_and_proton_set_their_prefix_variables() {
        let prefix = Path::new("/data/prefixes/g");
        let mut c = LaunchConfig { runtime: Some("wine".into()), ..Default::default() };
        let wine = plan_file("/g/a.exe", &c, &full(), true, Some(prefix)).unwrap();
        assert_eq!(wine.argv, ["/usr/bin/wine", "/g/a.exe"]);
        assert_eq!(wine.env, [("WINEPREFIX".to_owned(), "/data/prefixes/g".to_owned())]);
        assert_eq!(wine.create_dirs, [prefix.to_path_buf()]);
        c.runtime = Some("proton:/p/GE/proton".into());
        c.wrappers = vec!["gamemoderun".into()];
        let proton = plan_file("/g/a.exe", &c, &full(), true, Some(prefix)).unwrap();
        assert_eq!(proton.argv, ["/usr/bin/gamemoderun", "/p/GE/proton", "run", "/g/a.exe"]);
        assert!(proton.env.contains(&("STEAM_COMPAT_DATA_PATH".to_owned(), "/data/prefixes/g".to_owned())));
        assert!(proton.env.contains(&("STEAM_COMPAT_CLIENT_INSTALL_PATH".to_owned(), "/home/u/.steam/steam".to_owned())));
    }

    #[test]
    fn windows_programs_default_to_wine_and_fail_clearly_without_it() {
        let plan = plan_file("/g/a.exe", &LaunchConfig::default(), &full(), true, None).unwrap();
        assert_eq!(plan.argv[0], "/usr/bin/wine");
        assert!(plan_file("/g/a.exe", &LaunchConfig::default(), &bare(), true, None).unwrap_err().contains("Wine or Proton"));
        let gone = LaunchConfig { runtime: Some("proton:/gone/proton".into()), ..Default::default() };
        assert!(plan_file("/g/a.exe", &gone, &full(), true, None).unwrap_err().contains("no longer installed"));
    }

    #[test]
    fn missing_wrappers_are_reported_by_name() {
        let mut c = LaunchConfig { wrappers: vec!["mangohud".into()], ..Default::default() };
        assert_eq!(plan_file("/g/b", &c, &bare(), true, None).unwrap_err(), "MangoHud is not installed.");
        c.wrappers = vec!["sh -c".into()];
        assert!(plan_file("/g/b", &c, &full(), true, None).unwrap_err().contains("Unknown launch wrapper"));
        c.wrappers.clear();
        c.gamescope.enabled = true;
        assert_eq!(plan_file("/g/b", &c, &bare(), true, None).unwrap_err(), "gamescope is not installed.");
    }

    #[test]
    fn macos_ignores_linux_only_wrappers() {
        let mut c = config();
        c.wrappers = vec!["gamemoderun".into()];
        c.gamescope.enabled = true;
        assert_eq!(plan_file("/g/b", &c, &bare(), false, None).unwrap().argv, ["/g/b", "-fullscreen", "two words"]);
    }

    #[test]
    fn arguments_stay_separate_words_and_are_never_shell_interpreted() {
        let c = LaunchConfig { args: vec!["$(rm -rf ~)".into(), "a;b".into(), "x y".into()], ..Default::default() };
        let plan = plan_file("/g/b", &c, &full(), true, None).unwrap();
        assert_eq!(plan.argv, ["/g/b", "$(rm -rf ~)", "a;b", "x y"]);
        assert_eq!(display_command(&plan.argv, &[], None), "/g/b '$(rm -rf ~)' 'a;b' 'x y'");
    }

    #[test]
    fn validation_rejects_bad_options() {
        let mut c = LaunchConfig::default();
        c.env.insert("1BAD".into(), "x".into());
        c.env.insert("OK".into(), "a\0b".into());
        c.env.insert("HAS-DASH".into(), "x".into());
        c.args = vec!["fine".into(), "nul\0".into(), "x".repeat(MAX_ITEM_BYTES + 1)];
        c.working_dir = Some("/definitely/not/a/mochi/dir".into());
        let errors = validate(&c, true, true);
        assert_eq!(errors.len(), 6, "{errors:?}");
        assert!(errors.iter().any(|e| e.contains("1BAD")) && errors.iter().any(|e| e.contains("HAS-DASH")));
        assert!(errors.iter().any(|e| e.contains("working directory")));
        assert!(validate(&LaunchConfig { working_dir: Some("/".into()), ..Default::default() }, true, true).is_empty());
        assert!(validate(&LaunchConfig { working_dir: Some("/etc/hostname".into()), ..Default::default() }, true, true).len() <= 1);
    }

    #[test]
    fn validation_enforces_size_caps() {
        let mut c = LaunchConfig::default();
        for i in 0..=MAX_ENV { c.env.insert(format!("K{i}"), "v".into()); }
        c.args = vec!["a".into(); MAX_ARGS + 1];
        c.gamescope.enabled = true;
        c.gamescope.args = vec!["a".into(); MAX_GAMESCOPE_ARGS + 1];
        assert_eq!(validate(&c, true, false).len(), 3);
        c.gamescope.enabled = false;
        assert_eq!(validate(&c, true, false).len(), 2);
    }

    #[test]
    fn flatpak_gets_env_flags_before_the_app_id() {
        let argv = flatpak_argv("com.example.Game", &config());
        assert_eq!(argv, ["flatpak", "run", "--env=A=1", "com.example.Game", "-fullscreen", "two words"]);
        let mut c = LaunchConfig::default();
        c.env.insert("P".into(), "a=b c".into());
        assert_eq!(flatpak_argv("x.Y", &c), ["flatpak", "run", "--env=P=a=b c", "x.Y"]);
    }

    #[test]
    fn steam_option_string_orders_env_wrappers_and_args() {
        let mut c = config();
        c.env.insert("DXVK_HUD".into(), "fps, frametimes".into());
        c.wrappers = vec!["mangohud".into(), "gamemoderun".into()];
        assert_eq!(steam_options(&c, true), "A=1 DXVK_HUD='fps, frametimes' gamemoderun mangohud %command% -fullscreen 'two words'");
        c.gamescope.enabled = true;
        c.gamescope.args = vec!["-f".into()];
        assert_eq!(steam_options(&c, true), "A=1 DXVK_HUD='fps, frametimes' gamescope -f -- gamemoderun mangohud %command% -fullscreen 'two words'");
        assert_eq!(steam_options(&c, false), "A=1 DXVK_HUD='fps, frametimes' %command% -fullscreen 'two words'");
        assert_eq!(steam_options(&LaunchConfig::default(), true), "%command%");
    }

    #[test]
    fn quoting_handles_single_quotes_and_empty_words() {
        assert_eq!(shell_quote(""), "''");
        assert_eq!(shell_quote("it's"), "'it'\\''s'");
        assert_eq!(shell_quote("--a=b/c.d"), "--a=b/c.d");
    }

    #[test]
    fn classification_decides_what_applies() {
        assert_eq!(classify("/g/bin").0, Applies::Full);
        assert_eq!(classify("steam://rungameid/1").0, Applies::Steam);
        assert_eq!(classify("flatpak://a.B").0, Applies::Flatpak);
        assert_eq!(classify("/x/game.desktop").0, Applies::None);
        assert_eq!(classify("heroic://launch/x").0, Applies::None);
        assert_eq!(classify("lutris:rungameid/3").0, Applies::None);
        assert_eq!(classify("legendary://launch/Sugar").0, Applies::None);
        assert_eq!(classify("nile://launch/amzn1.x").0, Applies::None);
    }

    #[test]
    fn preview_matches_the_launch_argv_and_user_env_wins() {
        let mut c = config();
        c.runtime = Some("wine".into());
        c.env.insert("WINEPREFIX".into(), "/mine".into());
        c.working_dir = Some("/".into());
        let p = preview("/g/a.exe", &c, &full(), true, Some(Path::new("/data/prefixes/g")));
        assert!(p.errors.is_empty(), "{:?}", p.errors);
        let direct = plan_file("/g/a.exe", &c, &full(), true, Some(Path::new("/data/prefixes/g"))).unwrap();
        assert_eq!(p.argv, direct.argv);
        assert_eq!(p.env.iter().filter(|(k, _)| k == "WINEPREFIX").count(), 1);
        assert!(p.env.contains(&("WINEPREFIX".to_owned(), "/mine".to_owned())));
        assert_eq!(p.command.unwrap(), "cd / && A=1 WINEPREFIX=/mine /usr/bin/wine /g/a.exe -fullscreen 'two words'");
    }

    #[test]
    fn preview_for_other_targets() {
        let steam = preview("steam://rungameid/1", &config(), &full(), true, None);
        assert_eq!(steam.steam_options.as_deref(), Some("A=1 %command% -fullscreen 'two words'"));
        assert!(steam.argv.is_empty());
        let flat = preview("flatpak://a.B", &config(), &full(), true, None);
        assert_eq!(flat.command.as_deref(), Some("flatpak run --env=A=1 a.B -fullscreen 'two words'"));
        let desktop = preview("/x/y.desktop", &config(), &full(), true, None);
        assert!(desktop.command.is_none() && desktop.note.is_some() && desktop.errors.is_empty());
        let bad = preview("/g/b", &LaunchConfig { env: BTreeMap::from([("9".to_owned(), "".to_owned())]), ..Default::default() }, &full(), true, None);
        assert_eq!(bad.errors.len(), 1);
        assert!(bad.command.is_none());
    }
}
