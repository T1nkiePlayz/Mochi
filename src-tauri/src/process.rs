//! Process inspection and termination used by game session tracking.

use std::{collections::HashMap, time::Duration};

#[derive(Debug, Clone)]
pub struct ProcessInfo {
    pub pid: u32,
    pub ppid: u32,
    pub pgid: u32,
    pub cmdline: String,
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
        let cmdline = String::from_utf8_lossy(&cmdline).replace('\0', " ");
        processes.insert(pid, ProcessInfo { pid, ppid, pgid, cmdline, start_time });
    }
    processes
}

#[cfg(target_os = "macos")]
pub fn snapshot() -> HashMap<u32, ProcessInfo> {
    let mut command = std::process::Command::new("/bin/ps");
    command.args(["-axo", "pid=,ppid=,pgid=,etime=,command="]);
    let Some(output) = crate::platform::run_capture(command, Duration::from_secs(5)) else { return HashMap::new() };
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs();
    String::from_utf8_lossy(&output)
        .lines()
        .filter_map(|line| {
            let mut fields = line.split_whitespace();
            let pid: u32 = fields.next()?.parse().ok()?;
            let ppid: u32 = fields.next()?.parse().ok()?;
            let pgid: u32 = fields.next()?.parse().ok()?;
            let elapsed = parse_elapsed(fields.next()?);
            let cmdline = fields.collect::<Vec<_>>().join(" ");
            Some((pid, ProcessInfo { pid, ppid, pgid, cmdline, start_time: now.saturating_sub(elapsed) }))
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

/// True while `pid` or any process descended from it is still running.
pub fn tree_alive(root: u32) -> bool {
    let snapshot = snapshot();
    if snapshot.contains_key(&root) { return true; }
    let mut family = std::collections::HashSet::from([root]);
    loop {
        let before = family.len();
        for process in snapshot.values() {
            if family.contains(&process.ppid) { family.insert(process.pid); }
        }
        if family.len() == before { break; }
    }
    family.len() > 1
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
    use super::parse_elapsed;

    #[test]
    fn parses_ps_elapsed_formats() {
        assert_eq!(parse_elapsed("05:09"), 309);
        assert_eq!(parse_elapsed("01:02:03"), 3723);
        assert_eq!(parse_elapsed("2-00:00:01"), 172_801);
    }
}
