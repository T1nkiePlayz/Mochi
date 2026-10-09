use super::{
    command_exists, command_path, home_dir, safe_launch_id, user_dir, FlatpakApp, LaunchConfig, PlatformCapabilities, Prepared,
    RuntimeInfo, UserDir,
};
use std::{
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
    process::Command,
};

const APP_ID: &str = "dev.sidequestgames.Mochilauncher";
/// Autostart entry name (kept stable so existing "start at login" settings keep working).
const AUTOSTART_FILE: &str = "mochi.desktop";
/// Wayland compositors match a window to its launcher by app id, which is the bundle identifier.
const DESKTOP_FILE: &str = "dev.sidequestgames.Mochilauncher.desktop";
/// Name used by earlier versions for the application-menu entry.
const LEGACY_DESKTOP_FILE: &str = "mochi.desktop";
const DESKTOP_SCHEME: &str = "mochi";
const AUTOSTART_DIRECTORY: &str = "autostart";
const ICON_PNG: &[u8] = include_bytes!("../../icons/icon.png");
const STEAM_FLATPAK: &str = "com.valvesoftware.Steam";
const LUTRIS_FLATPAK: &str = "net.lutris.Lutris";
const WRAPPERS: [(&str, &str); 2] = [("gamemoderun", "GameMode"), ("mangohud", "MangoHud")];

pub fn capabilities() -> PlatformCapabilities {
    PlatformCapabilities {
        platform: "linux".into(),
        display_name: "Linux".into(),
        launch_methods: vec!["file".into(), "flatpak".into(), "custom".into()],
        supports_flatpak: true,
        supports_app_bundles: false,
        supports_startup: true,
        supports_system_notifications: true,
        supports_shortcuts: true,
        is_steam_deck: false,
        is_gamescope: false,
    }
}

fn data_home() -> Option<PathBuf> { user_dir(UserDir::Data) }

fn config_home() -> Option<PathBuf> { user_dir(UserDir::Config) }

// ---------------------------------------------------------------------------
// Flatpak
// ---------------------------------------------------------------------------

/// Reads the `Categories=` line of a Flatpak's exported desktop entry, which is
/// far cheaper than running `flatpak info` once per application.
fn flatpak_is_game(id: &str) -> bool {
    let mut roots = vec![PathBuf::from("/var/lib/flatpak/exports/share/applications")];
    if let Some(data) = data_home() { roots.push(data.join("flatpak/exports/share/applications")); }
    roots.iter().filter_map(|root| fs::read_to_string(root.join(format!("{id}.desktop"))).ok()).any(|text| {
        text.lines().filter_map(|line| line.strip_prefix("Categories=")).any(|categories| {
            categories.split(';').any(|value| value.eq_ignore_ascii_case("Game") || value.eq_ignore_ascii_case("Games"))
        })
    })
}

pub fn list_flatpaks() -> Result<Vec<FlatpakApp>, String> {
    let output = Command::new("flatpak")
        .args(["list", "--app", "--columns=application,name"])
        .output()
        .map_err(|e| format!("Unable to query installed Flatpaks: {e}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    let mut apps: Vec<FlatpakApp> = String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| {
            let mut fields = line.splitn(2, '\t');
            let id = fields.next().map(str::trim).filter(|value| !value.is_empty())?;
            let name = fields.next().map(str::trim).filter(|value| !value.is_empty()).unwrap_or(id);
            Some(FlatpakApp { id: id.into(), name: name.into(), category: if flatpak_is_game(id) { "Games" } else { "Other" }.into() })
        })
        .collect();
    apps.sort_by_key(|app| (app.category != "Games", app.name.to_lowercase()));
    Ok(apps)
}

fn flatpak_installed(id: &str) -> bool {
    command_exists("flatpak") && Command::new("flatpak").args(["info", id]).output().map(|o| o.status.success()).unwrap_or(false)
}

fn valid_flatpak_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 255 && id.contains('.') && id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

// ---------------------------------------------------------------------------
// Runtimes
// ---------------------------------------------------------------------------

fn steam_roots() -> Vec<PathBuf> {
    let Some(home) = home_dir() else { return Vec::new() };
    let mut roots = vec![home.join(".steam/steam"), home.join(".local/share/Steam"), home.join(".var/app/com.valvesoftware.Steam/.local/share/Steam")];
    roots.retain(|root| root.is_dir());
    roots
}

fn proton_installs() -> Vec<RuntimeInfo> {
    let mut found = Vec::new();
    for root in steam_roots() {
        for (parent, label) in [(root.join("compatibilitytools.d"), "custom"), (root.join("steamapps/common"), "Steam")] {
            let Ok(entries) = fs::read_dir(&parent) else { continue };
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().into_owned();
                let script = entry.path().join("proton");
                if (label == "Steam" && !name.starts_with("Proton")) || !script.is_file() { continue; }
                let path = script.to_string_lossy().into_owned();
                if found.iter().any(|runtime: &RuntimeInfo| runtime.path == path) { continue; }
                found.push(RuntimeInfo { id: format!("proton:{path}"), name: format!("{name} ({label})"), kind: "compat".into(), path });
            }
        }
    }
    found.sort_by(|a, b| b.name.cmp(&a.name));
    found
}

pub fn list_runtimes() -> Vec<RuntimeInfo> {
    let mut runtimes = Vec::new();
    if let Some(path) = command_path("wine") {
        runtimes.push(RuntimeInfo { id: "wine".into(), name: "Wine".into(), kind: "compat".into(), path: path.to_string_lossy().into_owned() });
    }
    runtimes.extend(proton_installs());
    for (command, name) in WRAPPERS {
        if let Some(path) = command_path(command) {
            runtimes.push(RuntimeInfo { id: command.into(), name: name.into(), kind: "wrapper".into(), path: path.to_string_lossy().into_owned() });
        }
    }
    runtimes
}

// ---------------------------------------------------------------------------
// Launching
// ---------------------------------------------------------------------------

fn opener(url: impl Into<OsString>) -> Command {
    let mut command = Command::new("xdg-open");
    command.arg(url.into());
    command
}

fn handoff(command: Command) -> Result<Prepared, String> { Ok(Prepared { command, direct: false }) }

fn flatpak_run(id: &str, extra: &[String]) -> Command {
    let mut command = Command::new("flatpak");
    command.args(["run", id]).args(extra);
    command
}

pub fn prepare_launch(target: &str, config: &LaunchConfig) -> Result<Prepared, String> {
    // `steam://open/main` starts the Steam client itself (a launcher entry).
    if let Some((scheme, id)) = ["steam://rungameid/", "steam://open/"].iter().find_map(|scheme| target.strip_prefix(scheme).map(|id| (*scheme, id))) {
        let uri = format!("{scheme}{}", safe_launch_id(id)?);
        return handoff(if command_exists("steam") {
            let mut command = Command::new("steam");
            command.arg(uri);
            command
        } else if flatpak_installed(STEAM_FLATPAK) {
            flatpak_run(STEAM_FLATPAK, &[uri])
        } else {
            opener(uri)
        });
    }
    if target.starts_with("heroic://") || target.starts_with("bottles:run/") { return handoff(opener(target)); }
    if let Some(id) = target.strip_prefix("lutris:rungameid/") {
        let uri = format!("lutris:rungameid/{}", safe_launch_id(id)?);
        return handoff(if command_exists("lutris") {
            let mut command = Command::new("lutris");
            command.arg(uri);
            command
        } else if flatpak_installed(LUTRIS_FLATPAK) {
            flatpak_run(LUTRIS_FLATPAK, &[uri])
        } else {
            opener(uri)
        });
    }
    if let Some(id) = target.strip_prefix("itch://run-game/") {
        let id = safe_launch_id(id)?;
        let bundled = home_dir().map(|home| home.join(".itch/itch-setup")).filter(|path| path.is_file());
        return handoff(if let Some(path) = command_path("itch-setup").or(bundled) {
            let mut command = Command::new(path);
            command.args(["--run-game", id]);
            command
        } else {
            opener(format!("itch://install?game_id={id}&launch"))
        });
    }
    if let Some(id) = target.strip_prefix("flatpak://").or_else(|| target.strip_prefix("flatpak run ")) {
        let id = id.trim();
        if !valid_flatpak_id(id) { return Err("Enter a valid Flatpak application ID, such as com.example.Game.".into()); }
        return Ok(Prepared { command: flatpak_run(id, &config.args), direct: true });
    }
    if let Some((launcher, id)) = crate::sources::prism::parse_instance_target(target) {
        let args = vec!["--launch".to_owned(), id];
        if let Some(program) = launcher.commands.iter().find(|program| command_exists(program)) {
            let mut command = Command::new(program);
            command.args(&args);
            return handoff(command);
        }
        if let Some(flatpak) = launcher.flatpak.filter(|id| flatpak_installed(id)) { return handoff(flatpak_run(flatpak, &args)); }
        return Err(format!("{} is not installed, so this Minecraft instance cannot be started.", launcher.name));
    }
    if let Some((prefix, code)) = crate::sources::battlenet::parse_wine_target(target) {
        return handoff(battlenet_wine_command(&prefix, &code)?);
    }
    if target.ends_with(".desktop") {
        let mut command = if command_exists("gio") { let mut c = Command::new("gio"); c.arg("launch"); c } else { Command::new("xdg-open") };
        command.arg(target);
        return handoff(command);
    }
    prepare_file(target, config)
}

/// Starts Battle.net inside its Wine prefix and asks it to launch one game (`--exec="launch CODE"`).
/// Uses the system `wine`: games set up through Lutris are better started from their Lutris entry.
fn battlenet_wine_command(prefix: &Path, code: &str) -> Result<Command, String> {
    let client = crate::sources::battlenet::PREFIX_CLIENTS.iter().map(|path| prefix.join(path)).find(|path| path.is_file())
        .ok_or("Battle.net is no longer installed in this Wine prefix.")?;
    let wine = command_path("wine").ok_or("Battle.net games in a Wine prefix need Wine. Install Wine, or start the game from Lutris or Bottles.")?;
    let mut command = Command::new(wine);
    command.env("WINEPREFIX", prefix).arg(client).arg(format!("--exec=launch {code}"));
    Ok(command)
}

fn wrapper_path(id: &str) -> Result<PathBuf, String> {
    let (command, name) = WRAPPERS.iter().find(|(command, _)| *command == id).ok_or_else(|| format!("Unknown launch wrapper '{id}'."))?;
    command_path(command).ok_or_else(|| format!("{name} is not installed."))
}

fn prepare_file(target: &str, config: &LaunchConfig) -> Result<Prepared, String> {
    let extension = Path::new(target).extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    let mut argv: Vec<OsString> = Vec::new();
    let mut envs: Vec<(String, OsString)> = Vec::new();

    match extension.as_str() {
        "exe" | "bat" | "msi" | "lnk" => {
            let runtime = config.runtime.as_deref().filter(|id| !id.is_empty()).map(str::to_owned).or_else(|| command_exists("wine").then(|| "wine".to_owned()))
                .ok_or("This Windows program needs Wine or Proton. Pick a runtime in the Tofu settings.")?;
            let known = list_runtimes();
            let selected = known.iter().find(|r| r.kind == "compat" && r.id == runtime).ok_or("The selected runtime is no longer installed.")?;
            if let Some(prefix) = &config.prefix_dir {
                fs::create_dir_all(prefix).map_err(|e| format!("Unable to create the runtime prefix: {e}"))?;
                if runtime == "wine" {
                    envs.push(("WINEPREFIX".into(), prefix.clone().into()));
                } else {
                    envs.push(("STEAM_COMPAT_DATA_PATH".into(), prefix.clone().into()));
                    let client = steam_roots().into_iter().next().ok_or("Proton needs a Steam installation.")?;
                    envs.push(("STEAM_COMPAT_CLIENT_INSTALL_PATH".into(), client.into()));
                }
            }
            argv.push(selected.path.clone().into());
            if runtime != "wine" { argv.push("run".into()); }
            argv.push(target.into());
        }
        "sh" | "bash" => { argv.extend(["sh".into(), target.into()]); }
        "py" => { argv.extend(["python3".into(), target.into()]); }
        "js" => { argv.extend(["node".into(), target.into()]); }
        _ => argv.push(target.into()),
    }
    argv.extend(config.args.iter().map(OsString::from));

    let mut wrapped: Vec<OsString> = Vec::new();
    for id in &config.wrappers {
        let path = wrapper_path(id)?;
        if id == "gamemoderun" || id == "mangohud" { wrapped.push(path.into()); }
    }
    wrapped.extend(argv);

    let mut iter = wrapped.into_iter();
    let program = iter.next().ok_or("Launch target is empty.")?;
    let mut command = Command::new(program);
    command.args(iter);
    for (key, value) in envs { command.env(key, value); }
    Ok(Prepared { command, direct: true })
}

// ---------------------------------------------------------------------------
// Desktop integration
// ---------------------------------------------------------------------------

fn sanitize_file_stem(value: &str) -> String {
    value.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '-' }).collect::<String>().chars().take(80).collect()
}

fn shortcut_path(game_id: &str) -> Result<PathBuf, String> {
    Ok(data_home().ok_or("Unable to determine the data directory.")?.join("applications").join(format!("mochi-game-{}.desktop", sanitize_file_stem(game_id))))
}

fn percent_encode(value: &str) -> String {
    value.bytes().fold(String::new(), |mut out, b| {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') { out.push(b as char) } else { out.push_str(&format!("%{b:02X}")) }
        out
    })
}

pub fn create_game_shortcut(game_id: &str, name: &str) -> Result<String, String> {
    use std::os::unix::fs::PermissionsExt;
    let path = shortcut_path(game_id)?;
    let executable = installed_executable()?;
    let exec = desktop_exec_argument(&executable);
    let url = format!("mochi://launch/{}", percent_encode(game_id)).replace('%', "%%");
    let name: String = name.chars().filter(|c| !c.is_control()).collect();
    let content = format!("[Desktop Entry]\nType=Application\nName={name}\nComment=Launch {name} with Mochi\nExec={exec} {url}\nIcon=mochi\nTerminal=false\nStartupNotify=true\nCategories=Game;\n");
    fs::create_dir_all(path.parent().ok_or("Invalid shortcut location.")?).map_err(|e| format!("Unable to create the applications directory: {e}"))?;
    fs::write(&path, content).map_err(|e| format!("Unable to write the shortcut: {e}"))?;
    let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o755));
    Ok(path.to_string_lossy().into_owned())
}

pub fn remove_game_shortcut(game_id: &str) -> Result<(), String> {
    let path = shortcut_path(game_id)?;
    if path.exists() { fs::remove_file(path).map_err(|e| format!("Unable to remove the shortcut: {e}"))?; }
    Ok(())
}

pub fn ensure_platform_integration() -> Result<(), String> {
    let data = data_home().ok_or("Unable to determine the data directory.")?;
    let applications = data.join("applications");
    fs::create_dir_all(&applications).map_err(|e| format!("Unable to create the applications directory: {e}"))?;
    let executable = installed_executable()?;
    let exec = desktop_exec_argument(&executable);
    // TryExec is a plain path, not a quoted command line like Exec.
    let try_exec = executable.to_string_lossy();
    let icons = data.join("icons/hicolor/512x512/apps");
    fs::create_dir_all(&icons).map_err(|e| format!("Unable to create the icon directory: {e}"))?;
    fs::write(icons.join("mochi.png"), ICON_PNG).map_err(|e| format!("Unable to install the Mochi application icon: {e}"))?;

    let content = format!("[Desktop Entry]\nType=Application\nName=Mochi\nComment=Your games, your way.\nExec={exec} %U\nTryExec={try_exec}\nIcon=mochi\nTerminal=false\nStartupNotify=true\nStartupWMClass={APP_ID}\nCategories=Game;Utility;\nMimeType=x-scheme-handler/{DESKTOP_SCHEME};\n");
    fs::write(applications.join(DESKTOP_FILE), content).map_err(|e| format!("Unable to write Mochi desktop entry: {e}"))?;
    // Earlier versions wrote `mochi.desktop`; two menu entries would be confusing.
    let legacy = applications.join(LEGACY_DESKTOP_FILE);
    if fs::read_to_string(&legacy).is_ok_and(|text| text.contains("Comment=Your games, your way.") && text.contains("StartupWMClass=")) {
        let _ = fs::remove_file(legacy);
    }

    // tauri-plugin-deep-link creates this separate entry and points it at the
    // source AppImage. Rewrite it to the managed copy so URL launches keep
    // working after the downloaded image is moved or replaced.
    let handler_name = std::env::current_exe().ok().and_then(|path| path.file_name().map(|name| name.to_string_lossy().into_owned())).unwrap_or_else(|| "mochi".into());
    let handler_content = format!("[Desktop Entry]\nType=Application\nName=Mochi\nExec={exec} %u\nTryExec={try_exec}\nTerminal=false\nNoDisplay=true\nMimeType=x-scheme-handler/{DESKTOP_SCHEME};\n");
    fs::write(applications.join(format!("{handler_name}-handler.desktop")), handler_content).map_err(|e| format!("Unable to update Mochi URL handler: {e}"))?;

    if command_exists("update-desktop-database") {
        let _ = Command::new("update-desktop-database").arg(&applications).status();
    }
    Ok(())
}

pub fn set_launch_on_startup(enabled: bool) -> Result<(), String> {
    let autostart = config_home().ok_or("Unable to determine the config directory.")?.join(AUTOSTART_DIRECTORY);
    let desktop = autostart.join(AUTOSTART_FILE);
    if enabled {
        fs::create_dir_all(&autostart).map_err(|e| format!("Unable to create autostart directory: {e}"))?;
        let exe = installed_executable()?;
        let content = format!("[Desktop Entry]\nType=Application\nName=Mochi\nComment=Launch Mochi when you sign in\nExec={} --autostart\nTerminal=false\nStartupNotify=false\nX-GNOME-Autostart-enabled=true\n", desktop_exec_argument(&exe));
        fs::write(&desktop, content).map_err(|e| format!("Unable to install Mochi startup entry: {e}"))?;
    } else if desktop.exists() {
        fs::remove_file(&desktop).map_err(|e| format!("Unable to remove Mochi startup entry: {e}"))?;
    }
    Ok(())
}

fn installed_executable() -> Result<PathBuf, String> {
    // AppImage mounts its payload under /tmp at runtime, so desktop and autostart entries must point at
    // the managed copy in ~/.local/bin (put there by the self-install step), or else at the AppImage itself.
    if let Some(installed) = crate::selfinstall::linux_install_target().filter(|path| path.exists()) { return Ok(installed); }
    if let Some(appimage) = std::env::var_os("APPIMAGE").map(PathBuf::from).filter(|path| path.is_file()) {
        return fs::canonicalize(&appimage).map_err(|e| format!("Unable to resolve the launched AppImage: {e}"));
    }
    std::env::current_exe().map_err(|e| format!("Unable to determine the Mochi executable: {e}"))
}

fn desktop_exec_argument(path: &Path) -> String {
    let escaped = path.to_string_lossy().replace('\\', "\\\\").replace('"', "\\\"").replace('`', "\\`").replace('$', "\\$").replace('%', "%%");
    format!("\"{escaped}\"")
}

pub fn open_url(url: &str) -> Result<(), String> {
    super::spawn_detached(opener(url)).map(|_| ()).map_err(|e| format!("Unable to open the external URL: {e}"))
}

pub fn open_path(path: &Path) -> Result<(), String> {
    let folder = if path.is_dir() { path } else { path.parent().unwrap_or(path) };
    super::spawn_detached(opener(folder)).map(|_| ()).map_err(|e| format!("Unable to open the folder: {e}"))
}

/// Whether something on the session bus can show tray icons (GNOME needs the AppIndicator
/// extension). When it cannot, hiding the window "to the tray" would strand it.
pub fn tray_available() -> bool {
    if !command_exists("gdbus") { return true; }
    let mut command = Command::new("gdbus");
    command.args(["call", "--session", "--dest", "org.freedesktop.DBus", "--object-path", "/org/freedesktop/DBus", "--method", "org.freedesktop.DBus.NameHasOwner", "org.kde.StatusNotifierWatcher"]);
    super::run_capture(command, std::time::Duration::from_secs(2)).map(|out| parse_name_has_owner(&String::from_utf8_lossy(&out))).unwrap_or(true)
}

/// `(true,)` / `(false,)` as printed by `gdbus call`; unknown output counts as available.
fn parse_name_has_owner(output: &str) -> bool {
    !output.trim().starts_with("(false")
}

/// The installed Mochi icon (`ensure_platform_integration` puts it there), written on demand so
/// notifications carry it even before desktop integration has run.
fn notification_icon() -> Option<PathBuf> {
    let icon = data_home()?.join("icons/hicolor/512x512/apps/mochi.png");
    if icon.is_file() { return Some(icon); }
    fs::create_dir_all(icon.parent()?).ok()?;
    crate::util::fsio::write_atomic(&icon, ICON_PNG).ok()?;
    Some(icon)
}

/// `notify-send` arguments: Mochi's name, its icon file (or the themed `mochi` icon) and the
/// desktop-entry hint that lets GNOME/KDE group the notification under Mochi's launcher entry.
fn notify_send_args(title: &str, body: &str, icon: Option<&Path>) -> Vec<OsString> {
    let icon: OsString = icon.map(|path| path.as_os_str().to_owned()).unwrap_or_else(|| "mochi".into());
    let mut icon_arg = OsString::from("--icon=");
    icon_arg.push(icon);
    let desktop_entry = DESKTOP_FILE.trim_end_matches(".desktop");
    vec!["--app-name=Mochi".into(), icon_arg, format!("--hint=string:desktop-entry:{desktop_entry}").into(), "--".into(), title.into(), body.into()]
}

pub fn send_system_notification(title: &str, body: &str) -> Result<(), String> {
    let status = Command::new("notify-send").args(notify_send_args(title, body, notification_icon().as_deref())).status().map_err(|e| format!("Unable to start notify-send: {e}"))?;
    if status.success() { Ok(()) } else { Err("The system notification daemon rejected the notification.".into()) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gdbus_answers_are_parsed() {
        assert!(parse_name_has_owner("(true,)\n"));
        assert!(!parse_name_has_owner("(false,)\n"));
        assert!(parse_name_has_owner(""));
    }

    #[test]
    fn notifications_carry_the_mochi_icon_and_desktop_entry() {
        let args = notify_send_args("Title", "-n body", Some(Path::new("/home/me/.local/share/icons/hicolor/512x512/apps/mochi.png")));
        let args: Vec<_> = args.iter().map(|arg| arg.to_string_lossy().into_owned()).collect();
        assert_eq!(args, ["--app-name=Mochi", "--icon=/home/me/.local/share/icons/hicolor/512x512/apps/mochi.png", "--hint=string:desktop-entry:dev.sidequestgames.Mochilauncher", "--", "Title", "-n body"]);
        assert_eq!(notify_send_args("t", "b", None)[1], "--icon=mochi");
    }

    #[test]
    fn battlenet_prefix_launch_needs_the_client() {
        let prefix = crate::sources::testutil::temp_dir("bnet-launch");
        assert!(battlenet_wine_command(&prefix, "WoW").err().unwrap().contains("no longer installed"));
        let client = prefix.join(crate::sources::battlenet::PREFIX_CLIENTS[0]);
        fs::create_dir_all(client.parent().unwrap()).unwrap();
        fs::write(&client, b"MZ").unwrap();
        if let Ok(command) = battlenet_wine_command(&prefix, "WoW") {
            let args: Vec<_> = command.get_args().map(|arg| arg.to_string_lossy().into_owned()).collect();
            assert_eq!(args, [client.to_string_lossy().into_owned(), "--exec=launch WoW".into()]);
            assert!(command.get_envs().any(|(key, value)| key == "WINEPREFIX" && value == Some(prefix.as_os_str())));
        }
        let _ = fs::remove_dir_all(prefix);
    }

    #[test]
    fn desktop_exec_is_quoted_and_escaped() {
        assert_eq!(desktop_exec_argument(Path::new("/home/me/My Apps/mochi")), "\"/home/me/My Apps/mochi\"");
        assert_eq!(desktop_exec_argument(Path::new("/a/$b\"c%")), "\"/a/\\$b\\\"c%%\"");
    }

    #[test]
    fn shortcut_names_are_sanitised() {
        assert_eq!(sanitize_file_stem("../etc/passwd"), "---etc-passwd");
        assert_eq!(percent_encode("a b/é"), "a%20b%2F%C3%A9");
    }
}
