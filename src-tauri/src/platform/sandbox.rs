//! Flatpak sandbox support. Inside the sandbox Steam, Heroic, Wine, `flatpak` and friends live on the
//! host, so every process Mochi starts for a game, launcher or tool goes through `flatpak-spawn --host`.
//! `host_command` is the single place that rewrites a `Command`.

use std::{
    ffi::{OsStr, OsString},
    path::PathBuf,
    process::Command,
    sync::OnceLock,
    time::Duration,
};

/// Whether Mochi runs inside a Flatpak sandbox (`FLATPAK_ID` is set, or `/.flatpak-info` exists).
pub fn is_flatpak() -> bool {
    static SANDBOXED: OnceLock<bool> = OnceLock::new();
    *SANDBOXED.get_or_init(|| detect(std::env::var_os("FLATPAK_ID").as_deref(), std::path::Path::new("/.flatpak-info").exists()))
}

fn detect(flatpak_id: Option<&OsStr>, info_file: bool) -> bool {
    flatpak_id.is_some_and(|id| !id.is_empty()) || info_file
}

/// How this build was installed: `flatpak`, `appimage` or `native` (deb/rpm/AUR/.app/dev).
pub fn install_type() -> &'static str {
    classify_install(is_flatpak(), std::env::var_os("APPIMAGE").is_some())
}

fn classify_install(flatpak: bool, appimage: bool) -> &'static str {
    if flatpak { "flatpak" } else if appimage { "appimage" } else { "native" }
}

/// `flatpak-spawn --host [--directory=..] [--env=K=V ..] program args..` for a command that was
/// built as if it would run directly. Environment values set on `command` travel as `--env=`.
fn wrap(command: &Command) -> Command {
    let mut wrapped = Command::new("flatpak-spawn");
    wrapped.arg("--host");
    if let Some(dir) = command.get_current_dir() {
        let mut arg = OsString::from("--directory=");
        arg.push(dir);
        wrapped.arg(arg);
    }
    for (key, value) in command.get_envs() {
        if let Some(value) = value {
            let mut arg = OsString::from("--env=");
            arg.push(key);
            arg.push("=");
            arg.push(value);
            wrapped.arg(arg);
        }
    }
    wrapped.arg(command.get_program()).args(command.get_args());
    wrapped
}

/// The command to actually run: unchanged on a normal install, wrapped for the host in a sandbox.
/// Call after the program, arguments, environment and working directory are set; configure
/// stdio and process groups on the result.
pub fn host_command(command: Command) -> Command {
    if is_flatpak() { wrap(&command) } else { command }
}

/// Shown when a sandboxed game ignores the stop request: SIGKILL cannot cross `flatpak-spawn`.
pub fn stuck_stop_notice() -> String {
    "The game did not quit when asked and may still be running. Mochi cannot force-stop programs on the host from the Flatpak; close it from the game or your system's task manager.".into()
}

/// Message for a hook that outlived its time limit.
pub fn hook_timeout_message(program: &str, limit_secs: u64, abandoned: bool) -> String {
    if abandoned {
        format!("\"{program}\" took longer than {limit_secs} seconds and did not stop when asked; Mochi left it running on the host (it was not killed).")
    } else {
        format!("\"{program}\" took longer than {limit_secs} seconds and was stopped.")
    }
}

/// Finds `name` on the host's PATH from inside the sandbox.
pub fn host_command_path(name: &str) -> Option<PathBuf> {
    if name.is_empty() || !name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '+')) { return None; }
    // `run_capture` wraps this for the host.
    let mut command = Command::new("sh");
    command.args(["-c", "command -v \"$1\"", "sh", name]);
    let output = super::run_capture(command, Duration::from_secs(3))?;
    let path = String::from_utf8_lossy(&output).trim().to_owned();
    path.starts_with('/').then(|| PathBuf::from(path))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn argv(command: &Command) -> Vec<String> {
        std::iter::once(command.get_program()).chain(command.get_args()).map(|part| part.to_string_lossy().into_owned()).collect()
    }

    #[test]
    fn flatpak_is_detected_from_env_or_info_file() {
        assert!(detect(Some(OsStr::new("dev.sidequestgames.Mochilauncher")), false));
        assert!(detect(None, true));
        assert!(!detect(None, false));
        assert!(!detect(Some(OsStr::new("")), false));
    }

    #[test]
    fn install_type_prefers_flatpak() {
        assert_eq!(classify_install(true, true), "flatpak");
        assert_eq!(classify_install(false, true), "appimage");
        assert_eq!(classify_install(false, false), "native");
    }

    #[test]
    fn wrapped_command_runs_on_the_host_with_env_and_directory() {
        let mut command = Command::new("/usr/bin/steam");
        command.arg("steam://rungameid/1").env("A", "1").env_remove("B").current_dir("/home/me/games");
        assert_eq!(argv(&wrap(&command)), ["flatpak-spawn", "--host", "--directory=/home/me/games", "--env=A=1", "/usr/bin/steam", "steam://rungameid/1"]);
    }

    #[test]
    fn plain_command_has_no_extras() {
        let mut command = Command::new("xdg-open");
        command.arg("https://example.com");
        assert_eq!(argv(&wrap(&command)), ["flatpak-spawn", "--host", "xdg-open", "https://example.com"]);
    }

    #[test]
    fn hook_timeout_messages_distinguish_abandoned_hooks() {
        assert!(hook_timeout_message("x", 5, false).ends_with("was stopped."));
        assert!(hook_timeout_message("x", 5, true).contains("not killed"));
    }

    #[test]
    fn host_lookup_rejects_odd_names() {
        assert!(host_command_path("").is_none());
        assert!(host_command_path("a b; rm").is_none());
    }
}
