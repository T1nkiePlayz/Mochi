use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::PathBuf,
    sync::{Arc, Mutex, OnceLock},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaytimeEntry {
    pub game_id: String,
    pub name: String,
    pub seconds: u64,
    pub last_played: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct PlaytimeFile {
    games: Vec<PlaytimeEntry>,
}

#[derive(Debug, Clone)]
struct ActiveSession {
    game_id: String,
    name: String,
    started_at: SystemTime,
}

#[derive(Default)]
struct TrackerState {
    path: Option<PathBuf>,
    games: HashMap<String, PlaytimeEntry>,
    active: HashMap<String, ActiveSession>,
}

static STATE: OnceLock<Arc<Mutex<TrackerState>>> = OnceLock::new();

fn state() -> Arc<Mutex<TrackerState>> {
    STATE.get_or_init(|| Arc::new(Mutex::new(TrackerState::default()))).clone()
}

fn now_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

pub fn initialize(path: PathBuf) -> Result<(), String> {
    let file = path.join("playtime.json");
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Unable to create playtime directory: {e}"))?;
    }

    let games = match fs::read_to_string(&file) {
        Ok(contents) => serde_json::from_str::<PlaytimeFile>(&contents)
            .map(|data| data.games)
            .unwrap_or_default(),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Vec::new(),
        Err(error) => return Err(format!("Unable to read playtime data: {error}")),
    };

    let shared = state();
    let mut guard = shared.lock().map_err(|_| "Playtime tracker lock is poisoned.".to_string())?;
    guard.path = Some(file);
    guard.games = games.into_iter().map(|entry| (entry.game_id.clone(), entry)).collect();
    Ok(())
}

fn persist_locked(guard: &TrackerState) -> Result<(), String> {
    let Some(path) = &guard.path else {
        return Err("Playtime tracker is not initialized.".into());
    };

    let mut games: Vec<_> = guard.games.values().cloned().collect();
    games.sort_by(|a, b| b.seconds.cmp(&a.seconds).then_with(|| b.last_played.cmp(&a.last_played)));

    let contents = serde_json::to_string_pretty(&PlaytimeFile { games })
        .map_err(|e| format!("Unable to serialize playtime data: {e}"))?;
    fs::write(path, contents).map_err(|e| format!("Unable to save playtime data: {e}"))
}

pub fn list() -> Result<Vec<PlaytimeEntry>, String> {
    let shared = state();
    let guard = shared.lock().map_err(|_| "Playtime tracker lock is poisoned.".to_string())?;
    let mut games: Vec<_> = guard.games.values().cloned().collect();
    for session in guard.active.values() {
        if let Some(entry) = games.iter_mut().find(|entry| entry.game_id == session.game_id) {
            entry.seconds = entry.seconds.saturating_add(
                SystemTime::now().duration_since(session.started_at).unwrap_or_default().as_secs(),
            );
        }
    }
    games.sort_by(|a, b| b.seconds.cmp(&a.seconds).then_with(|| b.last_played.cmp(&a.last_played)));
    Ok(games)
}

pub fn start(game_id: String, name: String, launch: impl FnOnce() -> Result<(), String> + Send + 'static) -> Result<(), String> {
    let session_id = game_id.clone();

    {
        let shared = state();
        let mut guard = shared.lock().map_err(|_| "Playtime tracker lock is poisoned.".to_string())?;
        if guard.active.contains_key(&session_id) {
            return Err("This game is already being tracked.".into());
        }
    }

    launch()?;

    let shared = state();
    {
        let mut guard = shared.lock().map_err(|_| "Playtime tracker lock is poisoned.".to_string())?;
        guard.active.insert(session_id.clone(), ActiveSession {
            game_id: game_id.clone(),
            name: name.clone(),
            started_at: SystemTime::now(),
        });
        let entry = guard.games.entry(game_id.clone()).or_insert_with(|| PlaytimeEntry {
            game_id: game_id.clone(),
            name: name.clone(),
            seconds: 0,
            last_played: now_seconds(),
        });
        entry.name = name;
        entry.last_played = now_seconds();
        persist_locked(&guard)?;
    }

    Ok(())
}

pub fn finish(game_id: &str) -> Result<(), String> {
    let shared = state();
    let mut guard = shared.lock().map_err(|_| "Playtime tracker lock is poisoned.".to_string())?;
    let Some(session) = guard.active.remove(game_id) else {
        return Ok(());
    };

    let elapsed = SystemTime::now()
        .duration_since(session.started_at)
        .unwrap_or_default()
        .as_secs();
    let entry = guard.games.entry(session.game_id.clone()).or_insert_with(|| PlaytimeEntry {
        game_id: session.game_id.clone(),
        name: session.name.clone(),
        seconds: 0,
        last_played: now_seconds(),
    });
    entry.name = session.name;
    entry.seconds = entry.seconds.saturating_add(elapsed);
    entry.last_played = now_seconds();
    persist_locked(&guard)
}

pub fn spawn_session_monitor(game_id: String, name: String, process_target: String) {
    thread::spawn(move || {
        let pid = wait_for_game_process(&process_target);
        if let Some(pid) = pid {
            while process_tree_alive(pid) {
                thread::sleep(Duration::from_secs(5));
            }
        } else {
            // Some platform launchers hand the game off without exposing a discoverable
            // child process. Keep a short grace period, then finish the session rather
            // than recording an unbounded play session.
            thread::sleep(Duration::from_secs(30));
        }

        let _ = finish(&game_id);
        let _ = name;
    });
}

#[cfg(target_os = "linux")]
#[derive(Debug, Clone)]
struct ProcessInfo {
    pid: u32,
    cmdline: String,
    start_time: u64,
}

#[cfg(target_os = "linux")]
fn process_snapshot() -> HashMap<u32, ProcessInfo> {
    let mut processes = HashMap::new();
    let Ok(entries) = fs::read_dir("/proc") else { return processes };

    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(pid_text) = name.to_str() else { continue };
        let Ok(pid) = pid_text.parse::<u32>() else { continue };

        let stat_path = entry.path().join("stat");
        let cmdline_path = entry.path().join("cmdline");
        let Ok(stat) = fs::read_to_string(stat_path) else { continue };
        let Ok(cmdline) = fs::read(cmdline_path) else { continue };

        let Some(close) = stat.rfind(')') else { continue };
        let fields: Vec<&str> = stat[close + 1..].split_whitespace().collect();
        let Some(start_time_text) = fields.get(19) else { continue };
        let Ok(start_time) = start_time_text.parse::<u64>() else { continue };
        let cmdline = String::from_utf8_lossy(&cmdline).replace('\0', " ");

        processes.insert(pid, ProcessInfo { pid, cmdline, start_time });
    }

    processes
}

#[cfg(target_os = "linux")]
fn is_launcher_process(info: &ProcessInfo) -> bool {
    let command = info.cmdline.to_lowercase();
    [
        "steam",
        "steamwebhelper",
        "flatpak",
        "bwrap",
        "pressure-vessel",
        "proton",
        "wineserver",
        "wineboot",
        "gio",
        "xdg-open",
        "lutris",
        "heroic",
        "bottles",
        "itch-setup",
        "itch",
        "sh -c",
        "bash -c",
        "python3 -c",
        "node -e",
    ]
    .iter()
    .any(|value| command.contains(value))
}

#[cfg(target_os = "linux")]
fn target_matches(info: &ProcessInfo, target: &str) -> bool {
    let command = info.cmdline.to_lowercase();
    let target = target.to_lowercase();

    if target.is_empty() {
        return false;
    }

    if target.starts_with("flatpak://") {
        let app_id = target.trim_start_matches("flatpak://");
        return command.contains(app_id);
    }

    if target.starts_with("steam://") || target.starts_with("heroic://") || target.starts_with("lutris:") || target.starts_with("bottles:") || target.starts_with("itch://") {
        return false;
    }

    let target_name = std::path::Path::new(target.trim_matches('"'))
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(&target);

    command.contains(target_name)
}

#[cfg(target_os = "linux")]
fn wait_for_game_process(target: &str) -> Option<u32> {
    let before: HashSet<u32> = process_snapshot().keys().copied().collect();
    let started = SystemTime::now();

    for _ in 0..30 {
        thread::sleep(Duration::from_secs(1));
        let snapshot = process_snapshot();
        let mut candidates: Vec<ProcessInfo> = snapshot
            .values()
            .filter(|process| !before.contains(&process.pid))
            .filter(|process| !is_launcher_process(process))
            .filter(|process| target_matches(process, target) || target.starts_with("steam://") || target.starts_with("heroic://") || target.starts_with("lutris:") || target.starts_with("bottles:") || target.starts_with("itch://"))
            .cloned()
            .collect();

        if !candidates.is_empty() {
            candidates.sort_by_key(|process| process.start_time);
            return candidates.last().map(|process| process.pid);
        }

        if started.elapsed().unwrap_or_default() > Duration::from_secs(30) {
            break;
        }
    }

    None
}

#[cfg(target_os = "linux")]
fn process_tree_alive(root_pid: u32) -> bool {
    let snapshot = process_snapshot();
    if snapshot.contains_key(&root_pid) {
        return true;
    }

    // If the original process exits but a child survives, follow the Linux process
    // tree through /proc so launchers that hand off to another executable still count.
    let mut parents = HashSet::from([root_pid]);
    for _ in 0..8 {
        let mut changed = false;
        for process in snapshot.values() {
            let stat_path = format!("/proc/{}/stat", process.pid);
            let Ok(stat) = fs::read_to_string(stat_path) else { continue };
            let Some(close) = stat.rfind(')') else { continue };
            let fields: Vec<&str> = stat[close + 1..].split_whitespace().collect();
            let Some(ppid_text) = fields.get(1) else { continue };
            let Ok(ppid) = ppid_text.parse::<u32>() else { continue };
            if parents.contains(&ppid) && parents.insert(process.pid) {
                changed = true;
            }
        }
        if !changed { break; }
    }

    parents.len() > 1
}

#[cfg(not(target_os = "linux"))]
fn wait_for_game_process(_target: &str) -> Option<u32> {
    None
}

#[cfg(not(target_os = "linux"))]
fn process_tree_alive(_root_pid: u32) -> bool {
    false
}
