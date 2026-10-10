//! Game session tracking: playtime history, running sessions, and stopping games.

use crate::{
    platform::Launched,
    process,
    tracking::Matcher,
    util::{epoch_secs, fsio, now_secs as now_seconds, MutexExt},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::{atomic::{AtomicU64, Ordering}, Arc, Mutex, OnceLock},
    thread,
    time::{Duration, Instant, SystemTime},
};
use tauri::{AppHandle, Emitter};

pub const SESSIONS_CHANGED_EVENT: &str = "game-sessions-changed";
/// How long to wait for a game to appear after handing it to a launcher (Steam may update it first).
const FIND_TIMEOUT_STEAM_SECONDS: u64 = 600;
const FIND_TIMEOUT_SECONDS: u64 = 180;
/// After the process we started exits, how long to look for the real game it may have started elsewhere.
const HANDOFF_GRACE_SECONDS: u64 = 10;
/// A game must be gone this long before the session ends, so launchers that restart it or
/// swap one process for another do not split a session in two.
const LINGER_SECONDS: u64 = 12;
const POLL: Duration = Duration::from_secs(3);
const ENVIRONMENT_CHECKS: u8 = 3;

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
#[derive(Clone)]
enum Tracker {
    /// The game leads the process group Mochi created for it.
    Group(u32),
    /// The game was handed to another launcher; find it again by what identifies it.
    Watch(Arc<Watcher>),
}

/// Finds the processes of a game that Mochi did not start itself (Steam, Heroic, `open`, ...).
struct Watcher {
    matcher: Matcher,
    /// Processes that already existed at launch; only newer ones have their environment read.
    before: HashSet<u32>,
    /// (pid, start time) -> (matched, times checked). A process is re-checked a few times because
    /// its environment is only final once it has exec'd.
    environment: Mutex<HashMap<(u32, u64), (bool, u8)>>,
}

impl Watcher {
    fn new(matcher: Matcher, before: HashSet<u32>) -> Self {
        Watcher { matcher, before, environment: Mutex::new(HashMap::new()) }
    }

    /// Pids currently belonging to the game. One process-table snapshot; environments are read
    /// only for new processes that the command line did not already settle.
    fn pids(&self) -> Vec<u32> { self.pids_within(Duration::from_millis(500)) }

    /// Like `pids`, from a process table at most `max_age` old. Several watchers (one per launched
    /// game) share one scan when they poll at about the same time.
    fn pids_within(&self, max_age: Duration) -> Vec<u32> {
        let table = process::shared_snapshot(max_age);
        let mut cache = self.environment.lock_recover();
        cache.retain(|(pid, start), _| table.get(pid).is_some_and(|info| info.start_time == *start));
        let matcher = &self.matcher;
        let found = matcher.select(&table, std::process::id(), &|info| !self.before.contains(&info.pid), &mut |info| {
            let entry = cache.entry((info.pid, info.start_time)).or_insert((false, 0));
            if !entry.0 && entry.1 < ENVIRONMENT_CHECKS {
                entry.1 += 1;
                entry.0 = process::environment(info.pid).is_some_and(|text| matcher.environment_matches(&text));
            }
            entry.0
        });
        found.into_iter().collect()
    }
}

#[derive(Clone)]
struct ActiveSession {
    /// Tells a session apart from a later one of the same game, so a stale monitor never ends the new one.
    token: u64,
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
    /// Command to run once the game has closed (empty: none).
    pub post_hook: Vec<String>,
    pub game_id: String,
    pub name: String,
    pub target: String,
    pub install_path: Option<String>,
}

static NEXT_TOKEN: AtomicU64 = AtomicU64::new(1);
static STATE: OnceLock<Arc<Mutex<TrackerState>>> = OnceLock::new();

fn state() -> Arc<Mutex<TrackerState>> {
    STATE.get_or_init(|| Arc::new(Mutex::new(TrackerState::default()))).clone()
}

/// Runs `f` on the tracker state. A panic in some other holder must not end session tracking for good,
/// so a poisoned lock is recovered instead of reported (the `Result` is kept for the callers' `?`).
fn lock<T>(shared: &Arc<Mutex<TrackerState>>, f: impl FnOnce(&mut TrackerState) -> T) -> Result<T, String> {
    Ok(f(&mut shared.lock_recover()))
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
    fsio::write_atomic_durable(path, contents).map_err(|e| format!("Unable to save {}: {e}", path.display()))
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
    let mut stored_history = None;
    let mut history = match fs::read_to_string(&history_path) {
        Ok(contents) => { let parsed = parse_history(&contents); stored_history = Some(contents); parsed }
        // First run with history: existing totals become one "historic" entry per game.
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => migrate_totals(&games, now),
        Err(error) => return Err(format!("Unable to read session history: {error}")),
    };
    // Sessions that never closed (crash, power loss): credit them up to their last heartbeat.
    let mut recovered = false;
    if let Ok(contents) = fs::read_to_string(&active_path) {
        for record in serde_json::from_str::<Vec<ActiveRecord>>(&contents).unwrap_or_default() {
            let seconds = record.seen.saturating_sub(record.start);
            if seconds < MIN_RECORDED_SECONDS { continue; }
            recovered = true;
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
    // Rewriting also drops any torn trailing line before new appends; an already clean file is left alone
    // (no fsync on the startup path).
    let serialized = serialize_history(&history);
    if stored_history.as_deref() != Some(serialized.as_str()) { write_atomic(&history_path, serialized.as_bytes())?; }
    let needs_persist = recovered || !file.exists();
    lock(&state(), |guard| {
        guard.path = Some(file);
        guard.history_path = Some(history_path);
        guard.active_path = Some(active_path);
        guard.history = history;
        guard.games = games.into_iter().map(|entry| (entry.game_id.clone(), entry)).collect();
        // Persist totals when crash recovery changed them (or none exist yet).
        if needs_persist { if let Err(error) = persist(guard) { eprintln!("{error}"); } }
    })
}

fn persist_active(guard: &TrackerState) {
    let Some(path) = &guard.active_path else { return };
    if guard.active.is_empty() { let _ = fs::remove_file(path); return; }
    let now = now_seconds();
    let records: Vec<ActiveRecord> = guard.active.iter().map(|(game_id, session)| ActiveRecord {
        game_id: game_id.clone(),
        name: session.name.clone(),
        start: epoch_secs(session.started_at),
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
            let start = epoch_secs(session.started_at);
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
    let contents = serde_json::to_string(&PlaytimeFile { games }).map_err(|e| format!("Unable to serialize playtime data: {e}"))?;
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
            started_at: epoch_secs(session.started_at),
            // A game that has not been detected yet can still be cancelled.
            can_stop: true,
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
    let token = NEXT_TOKEN.fetch_add(1, Ordering::Relaxed);

    lock(&shared, |guard| {
        guard.active.insert(request.game_id.clone(), ActiveSession {
            token,
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
    thread::spawn(move || monitor(app, request, token, before, launched));
    Ok(())
}

/// True while this very session (not a later one of the same game) is still running.
fn is_active(game_id: &str, token: u64) -> bool {
    lock(&state(), |guard| guard.active.get(game_id).is_some_and(|session| session.token == token)).unwrap_or(false)
}

fn set_tracker(game_id: &str, token: u64, tracker: Tracker) {
    let _ = lock(&state(), |guard| {
        if let Some(session) = guard.active.get_mut(game_id).filter(|session| session.token == token) { session.tracker = Some(tracker); }
    });
}

/// Polls until the game shows up (true), the timeout passes, or the session is cancelled.
fn wait_for_game(game_id: &str, token: u64, watcher: &Watcher, timeout: Duration) -> bool {
    let started = Instant::now();
    loop {
        if !is_active(game_id, token) { return false; }
        if !watcher.pids().is_empty() { return true; }
        if started.elapsed() >= timeout { return false; }
        // Look quickly at first, then back off while a launcher updates or installs.
        thread::sleep(if started.elapsed() < Duration::from_secs(30) { Duration::from_secs(1) } else { POLL });
    }
}

fn monitor(app: AppHandle, request: StartRequest, token: u64, before: HashSet<u32>, launched: Launched) {
    let id = request.game_id.as_str();
    let watcher = Matcher::new(&request.target, request.install_path.as_deref()).map(|matcher| (matcher.has_steam_id(), Arc::new(Watcher::new(matcher, before))));
    // Seconds at the end of the session during which nothing was running.
    let mut idle_tail = 0;
    let mut credit = false;
    let mut watching: Option<Arc<Watcher>> = None;

    match (launched.direct_pid, watcher) {
        (Some(pgid), watcher) => {
            credit = true;
            while process::group_alive(pgid) && is_active(id, token) {
                thread::sleep(POLL);
                heartbeat();
            }
            // A launcher script may exit after starting the real game outside its process group.
            if let Some((_, watcher)) = watcher.filter(|_| is_active(id, token)) {
                let waited = Instant::now();
                if wait_for_game(id, token, &watcher, Duration::from_secs(HANDOFF_GRACE_SECONDS)) { watching = Some(watcher); } else { idle_tail = waited.elapsed().as_secs(); }
            }
        }
        (None, Some((steam, watcher))) => {
            let timeout = Duration::from_secs(if steam { FIND_TIMEOUT_STEAM_SECONDS } else { FIND_TIMEOUT_SECONDS });
            if wait_for_game(id, token, &watcher, timeout) { watching = Some(watcher); credit = true; }
        }
        // Nothing identifies the game, so Mochi cannot know when it ends; do not invent playtime.
        (None, None) => {}
    }

    if let Some(watcher) = watching {
        credit = true;
        set_tracker(id, token, Tracker::Watch(watcher.clone()));
        notify(&app);
        let mut gone_since: Option<Instant> = None;
        while is_active(id, token) {
            if watcher.pids().is_empty() {
                let since = *gone_since.get_or_insert_with(Instant::now);
                if since.elapsed() >= Duration::from_secs(LINGER_SECONDS) { idle_tail = since.elapsed().as_secs(); break; }
            } else {
                gone_since = None;
            }
            thread::sleep(POLL);
            heartbeat();
        }
    }
    let _ = finish(id, Some(token), credit, idle_tail);
    notify(&app);
    crate::hooks::run_post(app, request.game_id.clone(), request.post_hook.clone());
}

/// Ends a session. `idle_tail` seconds at the end (spent confirming the game had gone) are not credited.
fn finish(game_id: &str, token: Option<u64>, credit: bool, idle_tail: u64) -> Result<(), String> {
    lock(&state(), |guard| {
        if token.is_some_and(|token| guard.active.get(game_id).is_none_or(|session| session.token != token)) { return Ok(()); }
        let Some(session) = guard.active.remove(game_id) else { return Ok(()) };
        if credit {
            let elapsed = seconds_since(session.started_at).saturating_sub(idle_tail);
            let entry = guard.games.entry(game_id.to_string()).or_insert_with(|| PlaytimeEntry {
                game_id: game_id.to_string(), name: session.name.clone(), seconds: 0, last_played: 0,
            });
            entry.name = session.name;
            entry.seconds = entry.seconds.saturating_add(elapsed);
            entry.last_played = now_seconds();
            if elapsed >= MIN_RECORDED_SECONDS {
                let start = epoch_secs(session.started_at);
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

/// Forgets all recorded playtime (part of "clear app data"). Does nothing while a game is running.
pub fn reset() -> Result<(), String> {
    lock(&state(), |guard| {
        if !guard.active.is_empty() { return Ok(()); }
        guard.games.clear();
        guard.history.clear();
        if let Some(path) = &guard.history_path { write_atomic(path, b"")?; }
        persist(guard)
    })?
}

/// Asks a running game to quit (then force-kills it if it will not). A game Mochi has not
/// detected yet is simply cancelled, without crediting any time.
pub fn stop(game_id: &str) -> Result<(), String> {
    let tracker = lock(&state(), |guard| guard.active.get(game_id).map(|session| session.tracker.clone()))?
        .ok_or("This game is not running.")?;
    match tracker {
        Some(Tracker::Group(pgid)) => process::terminate(pgid, true),
        Some(Tracker::Watch(watcher)) => watcher.pids().into_iter().for_each(|pid| process::terminate(pid, false)),
        None => finish(game_id, None, false, 0)?,
    }
    Ok(())
}

/// Credits every still-running session; called when Mochi exits.
pub fn finish_all() {
    let ids: Vec<String> = lock(&state(), |guard| guard.active.keys().cloned().collect()).unwrap_or_default();
    for id in ids { let _ = finish(&id, None, true, 0); }
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

    #[cfg(target_os = "linux")]
    #[test]
    fn watcher_finds_a_real_process_by_environment_and_by_path() {
        let mut child = std::process::Command::new("sleep").arg("30").env("SteamAppId", "424242").spawn().expect("sleep");
        let watcher = Watcher::new(Matcher::new("steam://rungameid/424242", None).unwrap(), HashSet::new());
        assert!(watcher.pids_within(Duration::ZERO).contains(&child.id()));
        // A process that existed before the launch is not inspected through its environment.
        let before = Watcher::new(Matcher::new("steam://rungameid/424242", None).unwrap(), HashSet::from([child.id()]));
        assert!(!before.pids_within(Duration::ZERO).contains(&child.id()));
        let other = Watcher::new(Matcher::new("steam://rungameid/424243", None).unwrap(), HashSet::new());
        assert!(!other.pids_within(Duration::ZERO).contains(&child.id()));
        let _ = child.kill();
        let _ = child.wait();
        assert!(!watcher.pids_within(Duration::ZERO).contains(&child.id()));
    }
}
