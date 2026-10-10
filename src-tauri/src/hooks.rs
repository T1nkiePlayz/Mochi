//! Pre- and post-launch hooks: a command the user wants run before a game starts or after it closes
//! (start OBS, switch the display mode, sync saves...). Commands are run directly, never through a shell,
//! and a failing hook only produces a warning: it never blocks the game.
use serde::{Deserialize, Serialize};
use std::{process::{Command, Stdio}, thread, time::{Duration, Instant}};
use tauri::{AppHandle, Emitter};

const PRE_TIMEOUT: Duration = Duration::from_secs(30);
const POST_TIMEOUT: Duration = Duration::from_secs(120);
const MAX_WORDS: usize = 64;

/// Each hook is a program followed by its arguments (already split into words by the UI). Empty means no hook.
#[derive(Debug, Default, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct HooksConfig { pub pre: Vec<String>, pub post: Vec<String> }

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct HookResult { game_id: String, phase: &'static str, ok: bool, message: String }

/// Runs one hook and waits for it, up to `limit`. A hook that is still running then is stopped.
fn run(words: &[String], limit: Duration) -> Result<(), String> {
    let Some((program, args)) = words.split_first() else { return Ok(()) };
    if words.len() > MAX_WORDS || program.trim().is_empty() { return Err("The hook command is not valid.".into()); }
    let mut child = Command::new(program).args(args).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null())
        .spawn().map_err(|error| format!("Could not start \"{program}\": {error}"))?;
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => return Ok(()),
            Ok(Some(status)) => return Err(format!("\"{program}\" exited with {status}.")),
            Ok(None) if started.elapsed() >= limit => { let _ = child.kill(); let _ = child.wait(); return Err(format!("\"{program}\" took longer than {} seconds and was stopped.", limit.as_secs())); }
            Ok(None) => thread::sleep(Duration::from_millis(100)),
            Err(error) => return Err(format!("Could not check \"{program}\": {error}")),
        }
    }
}

fn report(app: &AppHandle, game_id: &str, phase: &'static str, outcome: Result<(), String>) {
    let (ok, message) = match outcome { Ok(()) => (true, String::new()), Err(message) => (false, message) };
    if !ok { eprintln!("Mochi: {phase}-launch hook for {game_id} failed: {message}"); let _ = app.emit("launch-hook-result", HookResult { game_id: game_id.into(), phase, ok, message }); }
}

/// Runs the pre-launch hook to completion (bounded) before the game starts.
pub fn run_pre(app: &AppHandle, game_id: &str, hooks: &HooksConfig) {
    if !hooks.pre.is_empty() { report(app, game_id, "pre", run(&hooks.pre, PRE_TIMEOUT)); }
}

/// Runs the post-launch hook on its own thread once the game has closed.
pub fn run_post(app: AppHandle, game_id: String, words: Vec<String>) {
    if words.is_empty() { return; }
    thread::spawn(move || report(&app, &game_id, "post", run(&words, POST_TIMEOUT)));
}

#[cfg(test)]
mod tests {
    use super::*;
    fn words(items: &[&str]) -> Vec<String> { items.iter().map(|item| item.to_string()).collect() }

    #[test]
    fn empty_hook_is_a_no_op_and_bad_ones_report() {
        assert!(run(&[], Duration::from_secs(1)).is_ok());
        assert!(run(&words(&["definitely-not-a-real-program-mochi"]), Duration::from_secs(1)).is_err());
        assert!(run(&words(&[" "]), Duration::from_secs(1)).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn success_failure_and_timeout() {
        assert!(run(&words(&["true"]), Duration::from_secs(5)).is_ok());
        assert!(run(&words(&["false"]), Duration::from_secs(5)).unwrap_err().contains("exited"));
        assert!(run(&words(&["sleep", "5"]), Duration::from_millis(300)).unwrap_err().contains("stopped"));
    }
}
