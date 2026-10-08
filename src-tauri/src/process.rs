//! Process inspection and termination used by game session tracking.

use crate::util::MutexExt;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

#[derive(Debug, Clone)]
pub struct ProcessInfo {
    pub pid: u32,
    pub ppid: u32,
    /// Read by the macOS group check; Linux checks groups straight from `/proc/<pid>/stat`.
    #[cfg_attr(target_os = "linux", allow(dead_code))]
    pub pgid: u32,
    /// Space-joined arguments (arguments with spaces are not quoted).
    pub cmdline: String,
    /// The program as it was invoked (first argument); on macOS the first word of the command.
    pub argv0: String,
    pub start_time: u64,
}

#[cfg(target_os = "linux")]
pub fn snapshot() -> HashMap<u32, ProcessInfo> {
    let mut processes = HashMap::new();
    let Ok(entries) = std::fs::read_dir("/proc") else { return processes };
    for entry in entries.flatten() {
        let Some(pid) = entry.file_name().to_str().and_then(|name| name.parse::<u32>().ok()) else { continue };
        let Ok(stat) = std::fs::read_to_string(entry.path().join("stat")) else { continue };
        let Ok(cmdline) = std::fs::read(entry.path().join("cmdline")) else { continue };
        let Some((_, ppid, pgid, start_time)) = parse_stat(&stat) else { continue };
        let argv0 = String::from_utf8_lossy(cmdline.split(|byte| *byte == 0).next().unwrap_or_default()).into_owned();
        let cmdline = String::from_utf8_lossy(&cmdline).trim_end_matches('\0').replace('\0', " ");
        // Kernel threads have no command line and can never be a game.
        if cmdline.is_empty() { continue; }
        processes.insert(pid, ProcessInfo { pid, ppid, pgid, cmdline, argv0, start_time });
    }
    processes
}

/// `(state, ppid, pgid, starttime)` from `/proc/<pid>/stat`.
#[cfg(any(target_os = "linux", test))]
fn parse_stat(stat: &str) -> Option<(char, u32, u32, u64)> {
    // The command name is wrapped in parentheses and may itself contain spaces or ')'.
    let close = stat.rfind(')')?;
    let mut fields = stat[close + 1..].split_whitespace();
    // After the name: state(0) ppid(1) pgrp(2) ... starttime(19)
    let state = fields.next()?.chars().next()?;
    let ppid = fields.next()?.parse().ok()?;
    let pgid = fields.next()?.parse().ok()?;
    let start_time = fields.nth(16)?.parse().ok()?;
    Some((state, ppid, pgid, start_time))
}

/// The environment of `pid` as NUL-separated `NAME=value` text. Only Linux exposes it without
/// special entitlements; elsewhere (and for other users' processes) it is `None`.
#[cfg(target_os = "linux")]
pub fn environment(pid: u32) -> Option<String> {
    use std::io::Read;
    let mut bytes = Vec::new();
    std::fs::File::open(format!("/proc/{pid}/environ")).ok()?.take(512 * 1024).read_to_end(&mut bytes).ok()?;
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

#[cfg(not(target_os = "linux"))]
pub fn environment(_pid: u32) -> Option<String> { None }

#[cfg(target_os = "macos")]
pub fn snapshot() -> HashMap<u32, ProcessInfo> {
    // `-ww` stops ps from truncating long command lines; `command` is last because it contains spaces.
    let mut command = std::process::Command::new("/bin/ps");
    command.args(["-axww", "-o", "pid=,ppid=,pgid=,etime=,command="]);
    let Some(output) = crate::platform::run_capture(command, Duration::from_secs(5)) else { return HashMap::new() };
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs();
    parse_ps(&String::from_utf8_lossy(&output), now)
}

/// Parses `ps -axww -o pid=,ppid=,pgid=,etime=,command=` output (BSD/macOS column layout).
#[cfg(any(target_os = "macos", test))]
fn parse_ps(output: &str, now: u64) -> HashMap<u32, ProcessInfo> {
    output
        .lines()
        .filter_map(|line| {
            let mut rest = line.trim_start();
            let mut next_field = || {
                let end = rest.find(char::is_whitespace).unwrap_or(rest.len());
                let (field, tail) = rest.split_at(end);
                rest = tail.trim_start();
                (!field.is_empty()).then_some(field)
            };
            let pid: u32 = next_field()?.parse().ok()?;
            let ppid: u32 = next_field()?.parse().ok()?;
            let pgid: u32 = next_field()?.parse().ok()?;
            let elapsed = parse_elapsed(next_field()?);
            // Keep the command exactly as printed so paths with several spaces still match.
            let cmdline = rest.trim_end().to_string();
            if cmdline.is_empty() { return None; }
            let argv0 = cmdline.split_whitespace().next().unwrap_or_default().to_string();
            Some((pid, ProcessInfo { pid, ppid, pgid, cmdline, argv0, start_time: now.saturating_sub(elapsed) }))
        })
        .collect()
}

/// Parses `ps` elapsed time: `[[dd-]hh:]mm:ss`.
#[cfg(any(target_os = "macos", test))]
fn parse_elapsed(value: &str) -> u64 {
    if let Some((days, time)) = value.split_once('-') {
        return days.parse::<u64>().unwrap_or(0) * 86_400 + parse_elapsed(time);
    }
    let parts: Vec<u64> = value.split(':').map(|part| part.parse().unwrap_or(0)).collect();
    match parts.as_slice() {
        [m, s] => m * 60 + s,
        [h, m, s] => h * 3_600 + m * 60 + s,
        _ => 0,
    }
}

/// A recent snapshot shared by every caller within `max_age`, so several tracked games (and their
/// watchers) cost one process-table scan per interval instead of one each.
pub fn shared_snapshot(max_age: Duration) -> Arc<HashMap<u32, ProcessInfo>> {
    type Cached = Option<(Instant, Arc<HashMap<u32, ProcessInfo>>)>;
    static CACHE: Mutex<Cached> = Mutex::new(None);
    let mut cache = CACHE.lock_recover();
    if let Some((at, table)) = cache.as_ref() {
        if at.elapsed() < max_age { return table.clone(); }
    }
    let table = Arc::new(snapshot());
    *cache = Some((Instant::now(), table.clone()));
    table
}

/// True while any process still belongs to the process group we created.
#[cfg(target_os = "linux")]
pub fn group_alive(pgid: u32) -> bool {
    // Only `stat` is needed here (no command line, no allocation per process); zombies do not count.
    let Ok(entries) = std::fs::read_dir("/proc") else { return false };
    entries.flatten().any(|entry| {
        if !entry.file_name().to_str().is_some_and(|name| name.bytes().all(|b| b.is_ascii_digit())) { return false; }
        std::fs::read_to_string(entry.path().join("stat")).ok().and_then(|stat| parse_stat(&stat)).is_some_and(|(state, _, group, _)| group == pgid && state != 'Z')
    })
}

#[cfg(not(target_os = "linux"))]
pub fn group_alive(pgid: u32) -> bool {
    snapshot().values().any(|process| process.pgid == pgid)
}

fn signal_group(pgid: u32, signal: i32) -> bool {
    // SAFETY: kill with a negative pid signals a process group; pgid is a real group we created.
    pgid > 1 && unsafe { libc::kill(-(pgid as i32), signal) == 0 }
}

fn signal_pid(pid: u32, signal: i32) -> bool {
    // SAFETY: plain kill(2) on a pid obtained from our own snapshot or spawn.
    pid > 1 && unsafe { libc::kill(pid as i32, signal) == 0 }
}

/// Asks a launched game to quit, then force-kills whatever is left.
pub fn terminate(pid: u32, is_group: bool) {
    let send = move |signal: i32| if is_group { signal_group(pid, signal) } else { signal_pid(pid, signal) };
    send(libc::SIGTERM);
    std::thread::spawn(move || {
        for _ in 0..20 {
            std::thread::sleep(Duration::from_millis(250));
            let alive = if is_group { group_alive(pid) } else { snapshot().contains_key(&pid) };
            if !alive { return; }
        }
        send(libc::SIGKILL);
    });
}

#[cfg(test)]
mod tests {
    use super::{parse_elapsed, parse_ps, parse_stat};

    #[test]
    fn parses_proc_stat_even_when_the_name_has_spaces_and_parens() {
        // pid (comm) state ppid pgrp session tty tpgid flags minflt cminflt majflt cmajflt utime stime cutime cstime priority nice threads itrealvalue starttime
        let stat = "42 (my (odd) game) S 7 99 99 0 -1 4194560 100 0 0 0 1 2 0 0 20 0 3 0 123456 1000 200";
        assert_eq!(parse_stat(stat), Some(('S', 7, 99, 123_456)));
        assert_eq!(parse_stat("42 (x) Z 1 2 3 0 -1 0 0 0 0 0 0 0 0 0 20 0 1 0 5 0 0").map(|s| s.0), Some('Z'));
        assert_eq!(parse_stat("42 (short) S 1"), None);
        assert_eq!(parse_stat("garbage"), None);
    }

    #[test]
    fn shared_snapshot_reuses_a_fresh_table() {
        let first = super::shared_snapshot(std::time::Duration::from_secs(30));
        let second = super::shared_snapshot(std::time::Duration::from_secs(30));
        assert!(std::sync::Arc::ptr_eq(&first, &second));
        let third = super::shared_snapshot(std::time::Duration::ZERO);
        assert!(!std::sync::Arc::ptr_eq(&first, &third));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn group_alive_sees_our_own_group_and_not_a_bogus_one() {
        // SAFETY: getpgrp has no preconditions.
        let own = unsafe { libc::getpgrp() } as u32;
        assert!(super::group_alive(own));
        assert!(!super::group_alive(u32::MAX - 1));
        assert!(super::snapshot().contains_key(&std::process::id()));
    }

    #[test]
    fn parses_macos_ps_output() {
        let output = "    1     0     1  5-03:00:00 /sbin/launchd\n  501     1   501        01:02 /Applications/Dead Cells.app/Contents/MacOS/Dead  Cells --flag\n  junk line\n  502   501   501        00:09 \n";
        let table = parse_ps(output, 10_000);
        assert_eq!(table.len(), 2);
        let game = &table[&501];
        assert_eq!((game.ppid, game.pgid, game.start_time), (1, 501, 10_000 - 62));
        // Spacing inside the command is preserved.
        assert_eq!(game.cmdline, "/Applications/Dead Cells.app/Contents/MacOS/Dead  Cells --flag");
        assert_eq!(table[&1].start_time, 0); // saturates instead of underflowing
    }

    #[test]
    fn parses_ps_elapsed_formats() {
        assert_eq!(parse_elapsed("05:09"), 309);
        assert_eq!(parse_elapsed("01:02:03"), 3723);
        assert_eq!(parse_elapsed("2-00:00:01"), 172_801);
    }
}
