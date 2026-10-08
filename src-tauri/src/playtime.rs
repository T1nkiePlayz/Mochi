//! Game session tracking: playtime history, running sessions, and stopping games.

use crate::{
    platform::Launched,
    process::{self, ProcessInfo},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs,
    io::Write,
    path::{Path, PathBuf},
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

/// Raw sessions are kept this long; older ones are rolled into per-day-per-game aggregates.
const RAW_RETENTION_DAYS: u64 = 400;
const DAY: i64 = 86_400;
/// Sessions shorter than this are launcher blips, not playtime worth a history row.
const MIN_RECORDED_SECONDS: u64 = 1;
const HEARTBEAT_SECONDS: u64 = 60;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SessionKind {
    /// One real play session.
    #[default]
    Session,
    /// Several sessions of one game on one local day, rolled up by compaction.
    Daily,
    /// Playtime recorded before history existed; its date is only a placeholder.
    Historic,
}

fn one() -> u32 { 1 }

/// One entry of play history. `start` is the session start (Daily: local noon of the day).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub game_id: String,
    pub name: String,
    pub start: u64,
    pub seconds: u64,
    #[serde(default)]
    pub kind: SessionKind,
    #[serde(default = "one")]
    pub count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ActiveRecord {
    game_id: String,
    name: String,
    start: u64,
    seen: u64,
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
    history_path: Option<PathBuf>,
    active_path: Option<PathBuf>,
    history: Vec<Session>,
    last_heartbeat: u64,
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

/// UTC offset in seconds of the local time zone at `ts` (handles DST through the C library).
fn local_offset(ts: u64) -> i64 {
    // SAFETY: `localtime_r` only writes into the zeroed `tm` we own.
    unsafe {
        let time = ts as libc::time_t;
        let mut tm: libc::tm = std::mem::zeroed();
        if libc::localtime_r(&time, &mut tm).is_null() { 0 } else { tm.tm_gmtoff as i64 }
    }
}

/// Local calendar day number (days since 1970-01-01 in local time) of a timestamp.
fn day_of(ts: u64, offset: &dyn Fn(u64) -> i64) -> i64 {
    (ts as i64 + offset(ts)).div_euclid(DAY)
}

/// UTC timestamp of local midnight at the start of `day`, honouring DST changes near the boundary.
fn day_start(day: i64, offset: &dyn Fn(u64) -> i64) -> i64 {
    let guess = day * DAY - offset((day * DAY).max(0) as u64);
    day * DAY - offset(guess.max(0) as u64)
}

/// Splits `[start, start+seconds)` at local midnights, returning `(day, seconds)` pieces.
fn split_by_day(start: u64, seconds: u64, offset: &dyn Fn(u64) -> i64) -> Vec<(i64, u64)> {
    let end = start.saturating_add(seconds);
    let mut pieces = Vec::new();
    let mut cursor = start;
    while cursor < end {
        let day = day_of(cursor, offset);
        let boundary = day_start(day + 1, offset).max(cursor as i64 + 1) as u64;
        let stop = boundary.min(end);
        pieces.push((day, stop - cursor));
        cursor = stop;
    }
    if pieces.is_empty() { pieces.push((day_of(start, offset), 0)); }
    pieces
}

/// Rolls raw sessions older than the retention window into per-day-per-game aggregates.
fn compact(sessions: Vec<Session>, now: u64, offset: &dyn Fn(u64) -> i64) -> Vec<Session> {
    let cutoff = now.saturating_sub(RAW_RETENTION_DAYS * DAY as u64);
    let mut kept = Vec::new();
    // (day, game) -> (name, seconds, count); BTreeMap keeps the output deterministic.
    let mut daily: BTreeMap<(i64, String), (String, u64, u32)> = BTreeMap::new();
    for session in sessions {
        let old = session.start.saturating_add(session.seconds) < cutoff;
        match session.kind {
            SessionKind::Historic => kept.push(session),
            SessionKind::Session if !old => kept.push(session),
            SessionKind::Session => {
                for (index, (day, seconds)) in split_by_day(session.start, session.seconds, offset).into_iter().enumerate() {
                    let entry = daily.entry((day, session.game_id.clone())).or_insert((session.name.clone(), 0, 0));
                    entry.0 = session.name.clone();
                    entry.1 += seconds;
                    if index == 0 { entry.2 += session.count; }
                }
            }
            SessionKind::Daily => {
                let day = day_of(session.start, offset);
                let entry = daily.entry((day, session.game_id.clone())).or_insert((session.name.clone(), 0, 0));
                entry.0 = session.name.clone();
                entry.1 += session.seconds;
                entry.2 += session.count;
            }
        }
    }
    for ((day, game_id), (name, seconds, count)) in daily {
        let noon = (day * DAY + DAY / 2 - offset((day * DAY).max(0) as u64)).max(0) as u64;
        kept.push(Session { game_id, name, start: noon, seconds, kind: SessionKind::Daily, count });
    }
    kept.sort_by(|a, b| a.start.cmp(&b.start).then_with(|| a.game_id.cmp(&b.game_id)));
    kept
}

/// Turns pre-history totals into one placeholder entry per game, dated by when the game was last played.
fn migrate_totals(entries: &[PlaytimeEntry], now: u64) -> Vec<Session> {
    entries.iter().filter(|entry| entry.seconds > 0).map(|entry| Session {
        game_id: entry.game_id.clone(),
        name: entry.name.clone(),
        start: if entry.last_played > 0 { entry.last_played } else { now },
        seconds: entry.seconds,
        kind: SessionKind::Historic,
        count: 0,
    }).collect()
}

/// Writes `contents` to `path` through a synced temporary file so a crash never leaves a half-written file.
fn write_atomic(path: &Path, contents: &[u8]) -> Result<(), String> {
    let temp = path.with_extension("tmp");
    let mut file = fs::File::create(&temp).map_err(|e| format!("Unable to save {}: {e}", path.display()))?;
    file.write_all(contents).and_then(|_| file.sync_all()).map_err(|e| format!("Unable to save {}: {e}", path.display()))?;
    fs::rename(&temp, path).map_err(|e| format!("Unable to save {}: {e}", path.display()))
}

fn serialize_history(history: &[Session]) -> String {
    let mut out = String::new();
    for session in history {
        if let Ok(line) = serde_json::to_string(session) { out.push_str(&line); out.push('\n'); }
    }
    out
}

/// Reads the history log, skipping lines that do not parse (e.g. one cut short by a crash).
fn parse_history(contents: &str) -> Vec<Session> {
    contents.lines().filter_map(|line| serde_json::from_str::<Session>(line.trim()).ok()).collect()
}

fn append_history(path: &Path, session: &Session) -> Result<(), String> {
    let mut line = serde_json::to_string(session).map_err(|e| format!("Unable to serialize session: {e}"))?;
    line.push('\n');
    let mut file = fs::OpenOptions::new().create(true).append(true).open(path).map_err(|e| format!("Unable to save session history: {e}"))?;
    file.write_all(line.as_bytes()).and_then(|_| file.sync_data()).map_err(|e| format!("Unable to save session history: {e}"))
}

pub fn initialize(directory: PathBuf) -> Result<(), String> {
    fs::create_dir_all(&directory).map_err(|e| format!("Unable to create playtime directory: {e}"))?;
    let file = directory.join("playtime.json");
    let history_path = directory.join("sessions.jsonl");
    let active_path = directory.join("active-sessions.json");
    let mut games = match fs::read_to_string(&file) {
        Ok(contents) => serde_json::from_str::<PlaytimeFile>(&contents).map(|data| data.games).unwrap_or_else(|_| {
            // Keep an unreadable file for recovery instead of overwriting it with an empty history.
            let _ = fs::rename(&file, file.with_extension("json.corrupt"));
            Vec::new()
        }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Vec::new(),
        Err(error) => return Err(format!("Unable to read playtime data: {error}")),
    };
    let now = now_seconds();
    let mut history = match fs::read_to_string(&history_path) {
        Ok(contents) => parse_history(&contents),
        // First run with history: existing totals become one "historic" entry per game.
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => migrate_totals(&games, now),
        Err(error) => return Err(format!("Unable to read session history: {error}")),
    };
    // Sessions that never closed (crash, power loss): credit them up to their last heartbeat.
    if let Ok(contents) = fs::read_to_string(&active_path) {
        for record in serde_json::from_str::<Vec<ActiveRecord>>(&contents).unwrap_or_default() {
            let seconds = record.seen.saturating_sub(record.start);
            if seconds < MIN_RECORDED_SECONDS { continue; }
            history.push(Session { game_id: record.game_id.clone(), name: record.name.clone(), start: record.start, seconds, kind: SessionKind::Session, count: 1 });
            let entry = games.iter_mut().find(|entry| entry.game_id == record.game_id);
            match entry {
                Some(entry) => { entry.seconds = entry.seconds.saturating_add(seconds); entry.last_played = entry.last_played.max(record.seen); }
                None => games.push(PlaytimeEntry { game_id: record.game_id, name: record.name, seconds, last_played: record.seen }),
            }
        }
        let _ = fs::remove_file(&active_path);
    }
    let history = compact(history, now, &local_offset);
    // Rewriting on every start also drops any torn trailing line before new appends.
    write_atomic(&history_path, serialize_history(&history).as_bytes())?;
    lock(&state(), |guard| {
        guard.path = Some(file);
        guard.history_path = Some(history_path);
        guard.active_path = Some(active_path);
        guard.history = history;
        guard.games = games.into_iter().map(|entry| (entry.game_id.clone(), entry)).collect();
        // Persist totals now in case crash recovery changed them.
        if let Err(error) = persist(guard) { eprintln!("{error}"); }
    })
}

fn persist_active(guard: &TrackerState) {
    let Some(path) = &guard.active_path else { return };
    if guard.active.is_empty() { let _ = fs::remove_file(path); return; }
    let now = now_seconds();
    let records: Vec<ActiveRecord> = guard.active.iter().map(|(game_id, session)| ActiveRecord {
        game_id: game_id.clone(),
        name: session.name.clone(),
        start: session.started_at.duration_since(UNIX_EPOCH).unwrap_or_default().as_secs(),
        seen: now,
    }).collect();
    if let Ok(contents) = serde_json::to_vec(&records) { let _ = write_atomic(path, &contents); }
}

/// Refreshes the crash-recovery file; cheap no-op unless a minute has passed.
fn heartbeat() {
    let _ = lock(&state(), |guard| {
        let now = now_seconds();
        if now.saturating_sub(guard.last_heartbeat) < HEARTBEAT_SECONDS { return; }
        guard.last_heartbeat = now;
        persist_active(guard);
    });
}

/// Play history since `since_epoch` (sessions overlapping it), including games running right now.
pub fn history(since_epoch: Option<u64>) -> Result<Vec<Session>, String> {
    lock(&state(), |guard| {
        let since = since_epoch.unwrap_or(0);
        let mut out: Vec<Session> = guard.history.iter().filter(|s| s.kind == SessionKind::Historic || s.start.saturating_add(s.seconds) >= since).cloned().collect();
        for (game_id, session) in &guard.active {
            let start = session.started_at.duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
            let seconds = seconds_since(session.started_at);
            if seconds >= MIN_RECORDED_SECONDS && start.saturating_add(seconds) >= since {
                out.push(Session { game_id: game_id.clone(), name: session.name.clone(), start, seconds, kind: SessionKind::Session, count: 1 });
            }
        }
        out
    })
}

fn persist(guard: &TrackerState) -> Result<(), String> {
    let Some(path) = &guard.path else { return Err("Playtime tracker is not initialized.".into()) };
    let mut games: Vec<_> = guard.games.values().cloned().collect();
    games.sort_by(|a, b| b.seconds.cmp(&a.seconds).then_with(|| b.last_played.cmp(&a.last_played)));
    let contents = serde_json::to_string_pretty(&PlaytimeFile { games }).map_err(|e| format!("Unable to serialize playtime data: {e}"))?;
    write_atomic(path, contents.as_bytes())
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
        guard.last_heartbeat = now_seconds();
        persist_active(guard);
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
                heartbeat();
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
            if elapsed >= MIN_RECORDED_SECONDS {
                let start = now_seconds().saturating_sub(elapsed);
                let record = Session { game_id: game_id.to_string(), name: entry.name.clone(), start, seconds: elapsed, kind: SessionKind::Session, count: 1 };
                if let Some(path) = &guard.history_path {
                    if let Err(error) = append_history(path, &record) { eprintln!("{error}"); }
                }
                guard.history.push(record);
            }
        }
        persist_active(guard);
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

#[cfg(test)]
mod tests {
    use super::*;

    const UTC: &dyn Fn(u64) -> i64 = &|_| 0;

    fn session(game: &str, start: u64, seconds: u64) -> Session {
        Session { game_id: game.into(), name: game.into(), start, seconds, kind: SessionKind::Session, count: 1 }
    }

    #[test]
    fn splits_a_session_across_midnight() {
        // 23:00 to 01:30 UTC the next day.
        let start = 10 * DAY as u64 + 23 * 3600;
        let pieces = split_by_day(start, 2 * 3600 + 1800, UTC);
        assert_eq!(pieces, vec![(10, 3600), (11, 5400)]);
    }

    #[test]
    fn respects_the_local_offset_when_bucketing() {
        // UTC+2: 22:30 UTC is already 00:30 local on the next day.
        let plus_two: &dyn Fn(u64) -> i64 = &|_| 7200;
        let start = 10 * DAY as u64 + 22 * 3600 + 1800;
        assert_eq!(day_of(start, plus_two), 11);
        assert_eq!(split_by_day(start, 1800, plus_two), vec![(11, 1800)]);
        // 21:30 UTC + 1h session crosses local midnight at 22:00 UTC.
        let start = 10 * DAY as u64 + 21 * 3600 + 1800;
        assert_eq!(split_by_day(start, 3600, plus_two), vec![(10, 1800), (11, 1800)]);
    }

    #[test]
    fn handles_dst_changes() {
        // Spring forward at 02:00 local on day 20 (UTC-5 -> UTC-4 at 07:00 UTC).
        let switch = 20 * DAY as u64 + 7 * 3600;
        let offset: &dyn Fn(u64) -> i64 = &move |ts| if ts >= switch { -4 * 3600 } else { -5 * 3600 };
        // Local day 20 starts 05:00 UTC and, having lost an hour, ends 04:00 UTC on day 21 (23 hours long).
        assert_eq!(day_start(20, offset), 20 * DAY + 5 * 3600);
        assert_eq!(day_start(21, offset), 21 * DAY + 4 * 3600);
        let pieces = split_by_day(20 * DAY as u64 + 5 * 3600, 23 * 3600 + 7200, offset);
        assert_eq!(pieces, vec![(20, 23 * 3600), (21, 7200)]);
        // A session never gets negative or zero-length pieces.
        assert!(split_by_day(switch - 30, 60, offset).iter().all(|(_, s)| *s > 0));
    }

    #[test]
    fn piece_lengths_always_sum_to_the_session() {
        for start in [0u64, 86_399, 86_400, 1_700_000_000] {
            for seconds in [0u64, 1, 3600, 86_400, 200_000] {
                let total: u64 = split_by_day(start, seconds, UTC).iter().map(|(_, s)| s).sum();
                assert_eq!(total, seconds);
            }
        }
    }

    #[test]
    fn compaction_keeps_recent_and_rolls_up_old_sessions() {
        let now = 1_000 * DAY as u64;
        let old_day = now - 500 * DAY as u64;
        let sessions = vec![
            session("a", old_day + 3600, 600),
            session("a", old_day + 7200, 900),
            session("b", old_day + 100, 60),
            session("a", now - 10 * DAY as u64, 1200),
        ];
        let result = compact(sessions, now, UTC);
        assert_eq!(result.len(), 3);
        let daily_a = result.iter().find(|s| s.game_id == "a" && s.kind == SessionKind::Daily).unwrap();
        assert_eq!((daily_a.seconds, daily_a.count), (1500, 2));
        assert_eq!(result.iter().filter(|s| s.kind == SessionKind::Session).count(), 1);
        // Compacting twice changes nothing.
        assert_eq!(compact(result.clone(), now, UTC), result);
    }

    #[test]
    fn compaction_splits_old_midnight_crossing_sessions() {
        let now = 1_000 * DAY as u64;
        let start = (now - 450 * DAY as u64) / DAY as u64 * DAY as u64 + 23 * 3600;
        let result = compact(vec![session("a", start, 7200)], now, UTC);
        assert_eq!(result.len(), 2);
        assert_eq!(result.iter().map(|s| s.seconds).sum::<u64>(), 7200);
        assert_eq!(result.iter().map(|s| s.count).sum::<u32>(), 1);
    }

    #[test]
    fn migration_creates_one_historic_entry_per_played_game() {
        let entries = vec![
            PlaytimeEntry { game_id: "a".into(), name: "A".into(), seconds: 500, last_played: 1234 },
            PlaytimeEntry { game_id: "b".into(), name: "B".into(), seconds: 0, last_played: 0 },
            PlaytimeEntry { game_id: "c".into(), name: "C".into(), seconds: 9, last_played: 0 },
        ];
        let migrated = migrate_totals(&entries, 99);
        assert_eq!(migrated.len(), 2);
        assert_eq!((migrated[0].start, migrated[0].kind), (1234, SessionKind::Historic));
        assert_eq!(migrated[1].start, 99);
    }

    #[test]
    fn parsing_skips_torn_lines_and_round_trips() {
        let sessions = vec![session("a", 10, 20), session("b", 30, 40)];
        let mut text = serialize_history(&sessions);
        text.push_str("{\"gameId\":\"c\",\"na");
        assert_eq!(parse_history(&text), sessions);
    }

    #[test]
    fn history_filter_uses_session_end() {
        let sessions = [session("a", 100, 50), session("a", 1000, 50)];
        let kept: Vec<_> = sessions.iter().filter(|s| s.start + s.seconds >= 160).collect();
        assert_eq!(kept.len(), 1);
    }
}
