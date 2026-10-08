//! Game session tracking: playtime history, running sessions, and stopping games.

use crate::{
    platform::Launched,
    process::{self, ProcessInfo},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::PathBuf,
    sync::{Arc, Mutex, OnceLock},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter};

pub const SESSIONS_CHANGED_EVENT: &str = "game-sessions-changed";
const FIND_TIMEOUT_SECONDS: u64 = 120;

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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveSessionInfo {
    pub game_id: String,
    pub started_at: u64,
    pub can_stop: bool,
}

/// How a running game is recognised once it has been launched.
#[derive(Debug, Clone)]
enum Tracker {
    /// The game leads the process group Mochi created for it.
    Group(u32),
    /// A single process found after a launcher hand-off.
    Pid(u32),
    /// Any process whose command line contains this normalised text.
    Path(String),
}

#[derive(Debug, Clone)]
struct ActiveSession {
    name: String,
    started_at: SystemTime,
    tracker: Option<Tracker>,
}

#[derive(Default)]
struct TrackerState {
    path: Option<PathBuf>,
    games: HashMap<String, PlaytimeEntry>,
    active: HashMap<String, ActiveSession>,
}

pub struct StartRequest {
    pub game_id: String,
    pub name: String,
    pub target: String,
    pub install_path: Option<String>,
}

static STATE: OnceLock<Arc<Mutex<TrackerState>>> = OnceLock::new();

fn state() -> Arc<Mutex<TrackerState>> {
    STATE.get_or_init(|| Arc::new(Mutex::new(TrackerState::default()))).clone()
}

fn lock<T>(shared: &Arc<Mutex<TrackerState>>, f: impl FnOnce(&mut TrackerState) -> T) -> Result<T, String> {
    shared.lock().map(|mut guard| f(&mut guard)).map_err(|_| "Playtime tracker lock is poisoned.".to_string())
}

fn now_seconds() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()
}

fn seconds_since(time: SystemTime) -> u64 {
    SystemTime::now().duration_since(time).unwrap_or_default().as_secs()
}

pub fn initialize(directory: PathBuf) -> Result<(), String> {
    fs::create_dir_all(&directory).map_err(|e| format!("Unable to create playtime directory: {e}"))?;
    let file = directory.join("playtime.json");
    let games = match fs::read_to_string(&file) {
        Ok(contents) => serde_json::from_str::<PlaytimeFile>(&contents).map(|data| data.games).unwrap_or_else(|_| {
            // Keep an unreadable file for recovery instead of overwriting it with an empty history.
            let _ = fs::rename(&file, file.with_extension("json.corrupt"));
            Vec::new()
        }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Vec::new(),
        Err(error) => return Err(format!("Unable to read playtime data: {error}")),
    };
    lock(&state(), |guard| {
        guard.path = Some(file);
        guard.games = games.into_iter().map(|entry| (entry.game_id.clone(), entry)).collect();
    })
}

fn persist(guard: &TrackerState) -> Result<(), String> {
    let Some(path) = &guard.path else { return Err("Playtime tracker is not initialized.".into()) };
    let mut games: Vec<_> = guard.games.values().cloned().collect();
    games.sort_by(|a, b| b.seconds.cmp(&a.seconds).then_with(|| b.last_played.cmp(&a.last_played)));
    let contents = serde_json::to_string_pretty(&PlaytimeFile { games }).map_err(|e| format!("Unable to serialize playtime data: {e}"))?;
    // Write to a temporary file first so a crash mid-write cannot corrupt the history.
    let temp = path.with_extension("json.tmp");
    fs::write(&temp, contents).map_err(|e| format!("Unable to save playtime data: {e}"))?;
    fs::rename(&temp, path).map_err(|e| format!("Unable to save playtime data: {e}"))
}

pub fn list() -> Result<Vec<PlaytimeEntry>, String> {
    lock(&state(), |guard| {
        let mut games: Vec<_> = guard.games.values().cloned().collect();
        for (game_id, session) in &guard.active {
            if let Some(entry) = games.iter_mut().find(|entry| &entry.game_id == game_id) {
                entry.seconds = entry.seconds.saturating_add(seconds_since(session.started_at));
            }
        }
        games.sort_by(|a, b| b.seconds.cmp(&a.seconds).then_with(|| b.last_played.cmp(&a.last_played)));
        games
    })
}

pub fn active() -> Result<Vec<ActiveSessionInfo>, String> {
    lock(&state(), |guard| {
        guard.active.iter().map(|(game_id, session)| ActiveSessionInfo {
            game_id: game_id.clone(),
            started_at: session.started_at.duration_since(UNIX_EPOCH).unwrap_or_default().as_secs(),
            can_stop: session.tracker.is_some(),
        }).collect()
    })
}

fn notify(app: &AppHandle) {
    let _ = app.emit(SESSIONS_CHANGED_EVENT, ());
    let _ = crate::tray::refresh(app);
}

pub fn start(app: AppHandle, request: StartRequest, launch: impl FnOnce() -> Result<Launched, String>) -> Result<(), String> {
    let shared = state();
    if lock(&shared, |guard| guard.active.contains_key(&request.game_id))? {
        return Err("This game is already running.".into());
    }
    let before: HashSet<u32> = process::snapshot().keys().copied().collect();
    let launched = launch()?;

    lock(&shared, |guard| {
        guard.active.insert(request.game_id.clone(), ActiveSession {
            name: request.name.clone(),
            started_at: SystemTime::now(),
            tracker: launched.direct_pid.map(Tracker::Group),
        });
        let entry = guard.games.entry(request.game_id.clone()).or_insert_with(|| PlaytimeEntry {
            game_id: request.game_id.clone(), name: request.name.clone(), seconds: 0, last_played: 0,
        });
        entry.name = request.name.clone();
        entry.last_played = now_seconds();
        // The game is already running; a failed save must not abort tracking.
        if let Err(error) = persist(guard) { eprintln!("{error}"); }
    })?;

    notify(&app);
    thread::spawn(move || monitor(app, request, before, launched));
    Ok(())
}

fn normalise(text: &str) -> String {
    text.to_lowercase().replace('\\', "/")
}

fn is_launcher_process(info: &ProcessInfo) -> bool {
    let command = info.cmdline.to_lowercase();
    ["steamwebhelper", "bwrap", "pressure-vessel", "xdg-open", "gio launch", "sh -c", "bash -c", "python3 -c", "node -e", "/usr/bin/open"]
        .iter()
        .any(|value| command.contains(value))
}

/// Picks how to follow a game that was handed to another launcher.
fn handoff_tracker(request: &StartRequest) -> Option<String> {
    let target = request.target.trim_end_matches('/');
    if target.ends_with(".app") { return Some(normalise(target)); }
    if let Some(id) = target.strip_prefix("flatpak://") { return Some(normalise(id)); }
    request.install_path.as_deref().map(str::trim).filter(|path| path.len() > 3).map(|path| normalise(path.trim_end_matches('/')))
}

fn path_processes(needle: &str) -> Vec<u32> {
    let own = std::process::id();
    process::snapshot().values().filter(|p| p.pid != own && normalise(&p.cmdline).contains(needle)).map(|p| p.pid).collect()
}

fn tracker_alive(tracker: &Tracker) -> bool {
    match tracker {
        Tracker::Group(pgid) => process::group_alive(*pgid),
        Tracker::Pid(pid) => process::tree_alive(*pid),
        Tracker::Path(needle) => !path_processes(needle).is_empty(),
    }
}

fn set_tracker(game_id: &str, tracker: Tracker) {
    let _ = lock(&state(), |guard| {
        if let Some(session) = guard.active.get_mut(game_id) { session.tracker = Some(tracker); }
    });
}

fn find_tracker(request: &StartRequest, before: &HashSet<u32>) -> Option<Tracker> {
    let needle = handoff_tracker(request);
    let started = std::time::Instant::now();
    while started.elapsed() < Duration::from_secs(FIND_TIMEOUT_SECONDS) {
        thread::sleep(Duration::from_secs(1));
        if !lock(&state(), |guard| guard.active.contains_key(&request.game_id)).unwrap_or(false) { return None; }
        if let Some(needle) = &needle {
            if !path_processes(needle).is_empty() { return Some(Tracker::Path(needle.clone())); }
        } else {
            // No install path to match: fall back to the newest non-launcher process.
            let snapshot = process::snapshot();
            let candidate = snapshot.values().filter(|p| !before.contains(&p.pid) && !is_launcher_process(p)).min_by_key(|p| p.start_time);
            if let Some(process) = candidate { return Some(Tracker::Pid(process.pid)); }
        }
    }
    None
}

fn monitor(app: AppHandle, request: StartRequest, before: HashSet<u32>, launched: Launched) {
    let tracker = match launched.direct_pid {
        Some(pid) => Some(Tracker::Group(pid)),
        None => find_tracker(&request, &before),
    };
    let credited = match tracker {
        Some(tracker) => {
            set_tracker(&request.game_id, tracker.clone());
            notify(&app);
            // Hold on briefly so a launcher that restarts the game is not cut short.
            while tracker_alive(&tracker) && lock(&state(), |guard| guard.active.contains_key(&request.game_id)).unwrap_or(false) {
                thread::sleep(Duration::from_secs(3));
            }
            true
        }
        // The game never showed up (cancelled in the launcher, crashed, ...): don't invent playtime.
        None => false,
    };
    let _ = finish(&request.game_id, credited);
    notify(&app);
}

fn finish(game_id: &str, credit: bool) -> Result<(), String> {
    lock(&state(), |guard| {
        let Some(session) = guard.active.remove(game_id) else { return Ok(()) };
        if credit {
            let elapsed = seconds_since(session.started_at);
            let entry = guard.games.entry(game_id.to_string()).or_insert_with(|| PlaytimeEntry {
                game_id: game_id.to_string(), name: session.name.clone(), seconds: 0, last_played: 0,
            });
            entry.name = session.name;
            entry.seconds = entry.seconds.saturating_add(elapsed);
            entry.last_played = now_seconds();
        }
        persist(guard)
    })?
}

/// Asks a running game to quit (then force-kills it if it will not).
pub fn stop(game_id: &str) -> Result<(), String> {
    let tracker = lock(&state(), |guard| guard.active.get(game_id).map(|session| session.tracker.clone()))?
        .ok_or("This game is not running.")?
        .ok_or("Mochi cannot stop this game yet because it has not been detected. Close it from its own launcher.")?;
    match tracker {
        Tracker::Group(pgid) => process::terminate(pgid, true),
        Tracker::Pid(pid) => process::terminate(pid, false),
        Tracker::Path(needle) => path_processes(&needle).into_iter().for_each(|pid| process::terminate(pid, false)),
    }
    Ok(())
}

/// Credits every still-running session; called when Mochi exits.
pub fn finish_all() {
    let ids: Vec<String> = lock(&state(), |guard| guard.active.keys().cloned().collect()).unwrap_or_default();
    for id in ids { let _ = finish(&id, true); }
}
