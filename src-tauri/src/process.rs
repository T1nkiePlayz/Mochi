//! Process inspection and termination used by game session tracking.

use std::{collections::HashMap, time::Duration};

#[derive(Debug, Clone)]
pub struct ProcessInfo {
    pub pid: u32,
    pub ppid: u32,
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
        // The command name is wrapped in parentheses and may itself contain spaces or ')'.
        let Some(close) = stat.rfind(')') else { continue };
        let fields: Vec<&str> = stat[close + 1..].split_whitespace().collect();
        // After the name: state(0) ppid(1) pgrp(2) ... starttime(19)
        let (Some(ppid), Some(pgid), Some(start)) = (fields.get(1), fields.get(2), fields.get(19)) else { continue };
        let (Ok(ppid), Ok(pgid), Ok(start_time)) = (ppid.parse(), pgid.parse(), start.parse()) else { continue };
        let argv0 = String::from_utf8_lossy(cmdline.split(|byte| *byte == 0).next().unwrap_or_default()).into_owned();
        let cmdline = String::from_utf8_lossy(&cmdline).trim_end_matches('\0').replace('\0', " ");
        // Kernel threads have no command line and can never be a game.
        if cmdline.is_empty() { continue; }
        processes.insert(pid, ProcessInfo { pid, ppid, pgid, cmdline, argv0, start_time });
    }
    processes
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

/// True while any process still belongs to the process group we created.
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
    use super::{parse_elapsed, parse_ps};

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
