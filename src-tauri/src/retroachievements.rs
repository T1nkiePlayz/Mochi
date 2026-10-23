//! RetroAchievements progress for one game, read through the public Web API.
//!
//! Every request goes to `https://retroachievements.org/API/` (the only host allowed, redirects
//! included). The user's Web API key travels as the `y` query parameter, as the API requires, so a
//! request URL is never logged, stored or put in an error message: errors are mapped to fixed text
//! and `redact_url` exists for any code that must show a URL.
//!
//! Results are cached on disk with a TTL (game lists 7 days, progress 10 minutes) and served stale
//! when the network fails, so a game page still shows its last known progress offline.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    fs,
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

const API_BASE: &str = "https://retroachievements.org/API/";
const API_HOST: &str = "retroachievements.org";
const MEDIA_BASE: &str = "https://media.retroachievements.org";
/// How long a console's game list is reused before it is fetched again.
const GAME_LIST_TTL_SECS: u64 = 7 * 24 * 60 * 60;
/// How long a game's progress is reused unless the user refreshes.
const PROGRESS_TTL_SECS: u64 = 10 * 60;
const MAX_BYTES: usize = 12 * 1024 * 1024;
const MAX_ACHIEVEMENTS: usize = 2000;
const MAX_RESULTS: usize = 60;
const USER_AGENT: &str = concat!("Mochi/", env!("CARGO_PKG_VERSION"), " (game launcher)");

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RaAchievement {
    pub id: u64,
    pub title: String,
    pub description: String,
    pub points: u32,
    pub badge: Option<String>,
    pub badge_locked: Option<String>,
    pub unlocked: bool,
    /// Earned in hardcore mode (otherwise softcore when `unlocked`).
    pub hardcore: bool,
    /// Unix seconds (UTC) of the first unlock.
    pub earned_at: Option<i64>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RaProgressSet {
    pub game_id: u64,
    pub title: String,
    pub console_name: String,
    pub icon: Option<String>,
    pub achievements: Vec<RaAchievement>,
    pub total: u32,
    pub earned: u32,
    pub earned_hardcore: u32,
    pub points_total: u32,
    pub points_earned: u32,
    pub points_hardcore: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RaGame {
    pub id: u64,
    pub title: String,
    pub console_id: u32,
    pub console_name: String,
    pub icon: Option<String>,
    pub num_achievements: u32,
    pub points: u32,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RaProgressResult {
    /// "ok", "no-credentials", "denied", "not-found", "offline" or "error". The command never rejects.
    pub status: &'static str,
    pub data: Option<RaProgressSet>,
    /// True when `data` is an older cached copy because the network failed.
    pub stale: bool,
    pub fetched_at: Option<u64>,
    pub message: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RaSearchResult {
    pub status: &'static str,
    pub games: Vec<RaGame>,
    pub stale: bool,
    pub message: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RaTestResult {
    pub ok: bool,
    pub status: &'static str,
    pub user: Option<String>,
    pub total_points: Option<u64>,
    pub message: String,
}

enum FetchError {
    Offline,
    Denied,
    Other(String),
}

#[derive(Serialize, Deserialize)]
struct Cached<T> {
    fetched_at: u64,
    value: T,
}

fn now_secs() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0) }

/// True while a cached copy is young enough to use without asking the network.
pub fn is_fresh(fetched_at: u64, now: u64, ttl_secs: u64) -> bool { now >= fetched_at && now - fetched_at < ttl_secs }

pub fn valid_username(user: &str) -> bool {
    let user = user.trim();
    !user.is_empty() && user.len() <= 64 && user.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.')
}

pub fn valid_key(key: &str) -> bool {
    let key = key.trim();
    (8..=64).contains(&key.len()) && key.bytes().all(|b| b.is_ascii_alphanumeric())
}

/// Builds an API URL. The result contains the key: never log it; use `redact_url` to display it.
pub fn build_url(endpoint: &str, user: &str, key: &str, params: &[(&str, String)]) -> Option<reqwest::Url> {
    let mut pairs: Vec<(&str, String)> = vec![("z", user.trim().to_string()), ("y", key.trim().to_string())];
    pairs.extend(params.iter().map(|(k, v)| (*k, v.clone())));
    reqwest::Url::parse_with_params(&format!("{API_BASE}{endpoint}.php"), pairs).ok()
}

/// The URL with the value of every `y` (key) parameter replaced, safe for logs and the UI.
pub fn redact_url(url: &reqwest::Url) -> String {
    let mut out = url.clone();
    let pairs: Vec<(String, String)> = url.query_pairs().map(|(k, v)| (k.to_string(), if k == "y" { "REDACTED".to_string() } else { v.to_string() })).collect();
    out.query_pairs_mut().clear().extend_pairs(pairs);
    out.to_string()
}

pub fn host_allowed(url: &reqwest::Url) -> bool { url.scheme() == "https" && url.host_str() == Some(API_HOST) }

/// "YYYY-MM-DD HH:MM:SS" (UTC, as RetroAchievements writes it) to unix seconds.
pub fn parse_date(text: &str) -> Option<i64> {
    let (date, time) = text.trim().split_once(' ')?;
    let mut d = date.split('-').map(|p| p.parse::<i64>().ok());
    let (y, m, day) = (d.next()??, d.next()??, d.next()??);
    let mut t = time.split(':').map(|p| p.parse::<i64>().ok());
    let (h, mi, s) = (t.next()??, t.next()??, t.next().flatten().unwrap_or(0));
    if !(1..=12).contains(&m) || !(1..=31).contains(&day) || !(0..24).contains(&h) || !(0..60).contains(&mi) || !(0..61).contains(&s) || y < 1970 { return None; }
    // Days from civil (Howard Hinnant).
    let y = if m <= 2 { y - 1 } else { y };
    let era = y / 400;
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    Some(days * 86_400 + h * 3600 + mi * 60 + s)
}

fn safe_name(name: &str) -> bool { !name.is_empty() && name.len() <= 64 && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-') }

fn badge_url(name: &str, locked: bool) -> Option<String> {
    safe_name(name).then(|| format!("{MEDIA_BASE}/Badge/{name}{}.png", if locked { "_lock" } else { "" }))
}

/// `ImageIcon` values look like "/Images/012345.png".
fn icon_url(path: &str) -> Option<String> {
    let ok = path.starts_with("/Images/") && !path.contains("..") && path.len() <= 80 && path[1..].bytes().all(|b| b.is_ascii_alphanumeric() || b == b'/' || b == b'_' || b == b'-' || b == b'.');
    ok.then(|| format!("{MEDIA_BASE}{path}"))
}

fn text(value: &Value, key: &str) -> String { value.get(key).and_then(Value::as_str).unwrap_or_default().trim().to_string() }
/// RetroAchievements sends numbers as numbers or as strings depending on the endpoint.
fn number(value: &Value, key: &str) -> u64 {
    match value.get(key) {
        Some(Value::Number(n)) => n.as_u64().unwrap_or(0),
        Some(Value::String(s)) => s.trim().parse().unwrap_or(0),
        _ => 0,
    }
}

/// Parses `API_GetGameInfoAndUserProgress`. `None` when the game does not exist.
pub fn parse_progress(body: &str) -> Result<Option<RaProgressSet>, String> {
    let root: Value = serde_json::from_str(body).map_err(|_| "RetroAchievements returned unreadable data.".to_string())?;
    let game_id = number(&root, "ID");
    if game_id == 0 { return Ok(None); }
    let mut ordered: Vec<(u64, RaAchievement)> = Vec::new();
    let items: Vec<&Value> = match root.get("Achievements") {
        Some(Value::Object(map)) => map.values().collect(),
        Some(Value::Array(list)) => list.iter().collect(),
        _ => Vec::new(),
    };
    for item in items.into_iter().take(MAX_ACHIEVEMENTS) {
        let id = number(item, "ID");
        if id == 0 { continue; }
        let soft = parse_date(&text(item, "DateEarned"));
        let hard = parse_date(&text(item, "DateEarnedHardcore"));
        let badge = text(item, "BadgeName");
        ordered.push((number(item, "DisplayOrder"), RaAchievement {
            id, title: text(item, "Title"), description: text(item, "Description"), points: number(item, "Points") as u32,
            badge: badge_url(&badge, false), badge_locked: badge_url(&badge, true),
            unlocked: soft.is_some() || hard.is_some(), hardcore: hard.is_some(),
            earned_at: match (soft, hard) { (Some(a), Some(b)) => Some(a.min(b)), (a, b) => a.or(b) },
        }));
    }
    // RetroAchievements' own display order, then id.
    ordered.sort_by_key(|(order, a)| (*order, a.id));
    let achievements: Vec<RaAchievement> = ordered.into_iter().map(|(_, a)| a).collect();
    let total = achievements.len() as u32;
    let earned = achievements.iter().filter(|a| a.unlocked).count() as u32;
    let earned_hardcore = achievements.iter().filter(|a| a.hardcore).count() as u32;
    let sum = |f: &dyn Fn(&RaAchievement) -> bool| achievements.iter().filter(|a| f(a)).map(|a| a.points).sum::<u32>();
    Ok(Some(RaProgressSet {
        game_id, title: text(&root, "Title"), console_name: text(&root, "ConsoleName"), icon: icon_url(&text(&root, "ImageIcon")),
        total, earned, earned_hardcore,
        points_total: sum(&|_| true), points_earned: sum(&|a| a.unlocked), points_hardcore: sum(&|a| a.hardcore),
        achievements,
    }))
}

/// Parses `API_GetGameList`.
pub fn parse_game_list(body: &str) -> Result<Vec<RaGame>, String> {
    let root: Value = serde_json::from_str(body).map_err(|_| "RetroAchievements returned unreadable data.".to_string())?;
    let Some(list) = root.as_array() else { return Err("RetroAchievements returned an unexpected game list.".into()) };
    Ok(list.iter().filter_map(|item| {
        let id = number(item, "ID");
        let title = text(item, "Title");
        if id == 0 || title.is_empty() { return None; }
        Some(RaGame { id, title, console_id: number(item, "ConsoleID") as u32, console_name: text(item, "ConsoleName"), icon: icon_url(&text(item, "ImageIcon")), num_achievements: number(item, "NumAchievements") as u32, points: number(item, "Points") as u32 })
    }).collect())
}

/// Parses `API_GetUserProfile` into (user name, total points). `None` when the user is unknown.
pub fn parse_profile(body: &str) -> Option<(String, u64)> {
    let root: Value = serde_json::from_str(body).ok()?;
    let user = text(&root, "User");
    (!user.is_empty()).then(|| (user, number(&root, "TotalPoints")))
}

/// Lowercase words only: brackets, punctuation and spacing removed. Mirrors `normalizeTitle` in src/lib/retroAchievements.ts.
pub fn normalize_title(title: &str) -> String {
    let mut depth = 0u32;
    let mut out = String::new();
    for c in title.chars() {
        match c {
            '(' | '[' => depth += 1,
            ')' | ']' => depth = depth.saturating_sub(1),
            _ if depth > 0 => {}
            c if c.is_alphanumeric() => out.extend(c.to_lowercase()),
            _ => out.push(' '),
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Games whose normalized title contains every word of the query, best (shortest) first.
pub fn filter_games(games: &[RaGame], query: &str, with_achievements: bool) -> Vec<RaGame> {
    let q = normalize_title(query);
    let words: Vec<&str> = q.split(' ').filter(|w| !w.is_empty()).collect();
    let mut hits: Vec<(usize, &RaGame)> = games.iter()
        .filter(|g| !with_achievements || g.num_achievements > 0)
        .filter_map(|g| { let n = normalize_title(&g.title); words.iter().all(|w| n.contains(w)).then_some((n.len(), g)) })
        .collect();
    hits.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.title.cmp(&b.1.title)));
    hits.into_iter().take(MAX_RESULTS).map(|(_, g)| g.clone()).collect()
}

async fn request_json(url: reqwest::Url) -> Result<String, FetchError> {
    static CLIENT: crate::util::http::SharedClient = crate::util::http::SharedClient::new();
    if !host_allowed(&url) { return Err(FetchError::Other("That address is not allowed.".into())); }
    let client = CLIENT.get(|| crate::util::http::builder().user_agent(USER_AGENT)
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() < 3 && host_allowed(attempt.url()) { attempt.follow() } else { attempt.stop() }
        }))
        .connect_timeout(Duration::from_secs(8)).timeout(Duration::from_secs(25)).build(), "Unable to prepare the RetroAchievements request")
        .map_err(|_| FetchError::Other("Unable to prepare the RetroAchievements request.".into()))?;
    // Errors are mapped to fixed text: reqwest errors carry the URL, and the URL carries the key.
    let shown = redact_url(&url);
    let mut response = client.get(url).send().await.map_err(|error| {
        if error.is_connect() || error.is_timeout() { FetchError::Offline } else { FetchError::Other("The RetroAchievements request failed.".into()) }
    })?;
    let status = response.status().as_u16();
    if status == 401 || status == 403 { return Err(FetchError::Denied); }
    if status == 429 { return Err(FetchError::Other("RetroAchievements is busy right now. Try again in a minute.".into())); }
    if !response.status().is_success() { return Err(FetchError::Other(format!("RetroAchievements returned HTTP {status} for {shown}."))); }
    if response.content_length().is_some_and(|length| length as usize > MAX_BYTES) { return Err(FetchError::Other("The RetroAchievements response is too large.".into())); }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| FetchError::Offline)? {
        if body.len() + chunk.len() > MAX_BYTES { return Err(FetchError::Other("The RetroAchievements response is too large.".into())); }
        body.extend_from_slice(&chunk);
    }
    String::from_utf8(body).map_err(|_| FetchError::Other("RetroAchievements returned non-text data.".into()))
}

fn cache_dir(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_data_dir().ok()?.join("retroachievements");
    fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

fn user_slug(user: &str) -> String { user.trim().to_ascii_lowercase().chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '_' }).collect() }
fn progress_path(dir: &Path, user: &str, game_id: u64) -> PathBuf { dir.join(format!("progress_{}_{game_id}.json", user_slug(user))) }
fn games_path(dir: &Path, console_id: u32) -> PathBuf { dir.join(format!("games_{console_id}.json")) }

fn read_cached<T: for<'de> Deserialize<'de>>(path: &Path) -> Option<Cached<T>> { serde_json::from_slice(&fs::read(path).ok()?).ok() }

fn write_cached<T: Serialize>(path: &Path, fetched_at: u64, value: &T) {
    let Ok(bytes) = serde_json::to_vec(&Cached { fetched_at, value }) else { return };
    let tmp = path.with_extension(format!("{}.tmp", std::process::id()));
    if fs::write(&tmp, bytes).is_ok() && fs::rename(&tmp, path).is_err() { let _ = fs::remove_file(&tmp); }
}

fn progress_reply(status: &'static str, data: Option<RaProgressSet>, stale: bool, fetched_at: Option<u64>, message: Option<&str>) -> RaProgressResult {
    RaProgressResult { status, data, stale, fetched_at, message: message.map(str::to_string) }
}

const MSG_CREDENTIALS: &str = "Add your RetroAchievements user name and Web API key in Settings > Achievements.";
const MSG_DENIED: &str = "RetroAchievements did not accept this user name and key.";
const MSG_OFFLINE: &str = "RetroAchievements could not be reached.";

#[tauri::command(async)]
pub async fn ra_test_connection(username: String, api_key: String) -> RaTestResult {
    let fail = |status: &'static str, message: &str| RaTestResult { ok: false, status, user: None, total_points: None, message: message.to_string() };
    if !valid_username(&username) || !valid_key(&api_key) { return fail("no-credentials", MSG_CREDENTIALS); }
    let Some(url) = build_url("API_GetUserProfile", &username, &api_key, &[("u", username.trim().to_string())]) else { return fail("error", "The user name is not valid.") };
    match request_json(url).await {
        Ok(body) => match parse_profile(&body) {
            Some((user, points)) => RaTestResult { ok: true, status: "ok", user: Some(user), total_points: Some(points), message: "Connected.".into() },
            None => fail("denied", MSG_DENIED),
        },
        Err(FetchError::Denied) => fail("denied", MSG_DENIED),
        Err(FetchError::Offline) => fail("offline", MSG_OFFLINE),
        Err(FetchError::Other(message)) => fail("error", &message),
    }
}

#[tauri::command(async)]
pub async fn ra_get_progress(app: AppHandle, username: String, api_key: String, game_id: u64, refresh: Option<bool>) -> RaProgressResult {
    let dir = cache_dir(&app);
    let path = dir.as_ref().map(|d| progress_path(d, &username, game_id));
    let cached: Option<Cached<RaProgressSet>> = path.as_deref().and_then(read_cached);
    let now = now_secs();
    if let Some(entry) = &cached {
        if !refresh.unwrap_or(false) && is_fresh(entry.fetched_at, now, PROGRESS_TTL_SECS) {
            return progress_reply("ok", Some(entry.value.clone()), false, Some(entry.fetched_at), None);
        }
    }
    let with_cache = |status: &'static str, message: &str| match &cached {
        Some(entry) => progress_reply("ok", Some(entry.value.clone()), true, Some(entry.fetched_at), Some(message)),
        None => progress_reply(status, None, false, None, Some(message)),
    };
    if game_id == 0 || !valid_username(&username) || !valid_key(&api_key) { return with_cache("no-credentials", MSG_CREDENTIALS); }
    let Some(url) = build_url("API_GetGameInfoAndUserProgress", &username, &api_key, &[("u", username.trim().to_string()), ("g", game_id.to_string())]) else { return with_cache("error", "The user name is not valid.") };
    match request_json(url).await {
        Ok(body) => match parse_progress(&body) {
            Ok(Some(set)) => {
                if let Some(path) = &path { write_cached(path, now, &set); }
                progress_reply("ok", Some(set), false, Some(now), None)
            }
            Ok(None) => progress_reply("not-found", None, false, None, Some("RetroAchievements has no game with this id.")),
            Err(message) => with_cache("error", &message),
        },
        Err(FetchError::Denied) => with_cache("denied", MSG_DENIED),
        Err(FetchError::Offline) => with_cache("offline", MSG_OFFLINE),
        Err(FetchError::Other(message)) => with_cache("error", &message),
    }
}

/// Searches one console's games (with achievements) by title. The list is cached for 7 days.
#[tauri::command(async)]
pub async fn ra_search_games(app: AppHandle, username: String, api_key: String, console_id: u32, query: String, refresh: Option<bool>) -> RaSearchResult {
    let reply = |status: &'static str, games: Vec<RaGame>, stale: bool, message: Option<&str>| RaSearchResult { status, games, stale, message: message.map(str::to_string) };
    let dir = cache_dir(&app);
    let path = dir.as_ref().map(|d| games_path(d, console_id));
    let cached: Option<Cached<Vec<RaGame>>> = path.as_deref().and_then(read_cached);
    let now = now_secs();
    if let Some(entry) = &cached {
        if !refresh.unwrap_or(false) && is_fresh(entry.fetched_at, now, GAME_LIST_TTL_SECS) { return reply("ok", filter_games(&entry.value, &query, true), false, None); }
    }
    let fallback = |status: &'static str, message: &str| match &cached {
        Some(entry) => reply("ok", filter_games(&entry.value, &query, true), true, Some(message)),
        None => reply(status, Vec::new(), false, Some(message)),
    };
    if console_id == 0 || !valid_username(&username) || !valid_key(&api_key) { return fallback("no-credentials", MSG_CREDENTIALS); }
    let Some(url) = build_url("API_GetGameList", &username, &api_key, &[("i", console_id.to_string()), ("f", "1".to_string())]) else { return fallback("error", "The user name is not valid.") };
    match request_json(url).await {
        Ok(body) => match parse_game_list(&body) {
            Ok(games) => {
                if let Some(path) = &path { write_cached(path, now, &games); }
                reply("ok", filter_games(&games, &query, true), false, None)
            }
            Err(message) => fallback("error", &message),
        },
        Err(FetchError::Denied) => fallback("denied", MSG_DENIED),
        Err(FetchError::Offline) => fallback("offline", MSG_OFFLINE),
        Err(FetchError::Other(message)) => fallback("error", &message),
    }
}

/// Deletes every saved RetroAchievements file.
#[tauri::command(async)]
pub fn clear_retroachievements_cache(app: AppHandle) -> Result<(), String> {
    let Ok(base) = app.path().app_data_dir() else { return Ok(()) };
    let dir = base.join("retroachievements");
    if dir.exists() { fs::remove_dir_all(&dir).map_err(|_| "Unable to clear saved RetroAchievements data.".to_string())?; }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sources::testutil::temp_dir;
    const PROFILE: &str = include_str!("../fixtures/ra_user_profile.json");
    const PROGRESS: &str = include_str!("../fixtures/ra_game_progress.json");
    const GAMES: &str = include_str!("../fixtures/ra_game_list.json");

    #[test]
    fn profile_is_parsed_and_unknown_users_are_not() {
        assert_eq!(parse_profile(PROFILE), Some(("Scott".to_string(), 12345)));
        assert_eq!(parse_profile("{}"), None);
        assert_eq!(parse_profile("not json"), None);
    }

    #[test]
    fn progress_counts_softcore_and_hardcore() {
        let set = parse_progress(PROGRESS).unwrap().unwrap();
        assert_eq!((set.game_id, set.title.as_str(), set.console_name.as_str()), (228, "Super Mario World", "SNES/Super Famicom"));
        assert_eq!((set.total, set.earned, set.earned_hardcore), (3, 2, 1));
        assert_eq!((set.points_total, set.points_earned, set.points_hardcore), (35, 15, 10));
        assert_eq!(set.icon.as_deref(), Some("https://media.retroachievements.org/Images/085573.png"));
        let first = set.achievements.iter().find(|a| a.id == 79_000).unwrap();
        assert!(first.hardcore && first.unlocked);
        assert_eq!(first.earned_at, Some(1_577_934_245));
        assert_eq!(first.badge.as_deref(), Some("https://media.retroachievements.org/Badge/82541.png"));
        assert_eq!(first.badge_locked.as_deref(), Some("https://media.retroachievements.org/Badge/82541_lock.png"));
        let soft = set.achievements.iter().find(|a| a.id == 79_001).unwrap();
        assert!(soft.unlocked && !soft.hardcore);
        let locked = set.achievements.iter().find(|a| a.id == 79_002).unwrap();
        assert!(!locked.unlocked && locked.earned_at.is_none());
        // A hostile badge name never becomes a URL.
        assert!(locked.badge.is_none());
    }

    #[test]
    fn missing_games_and_garbage_are_handled() {
        assert_eq!(parse_progress(r#"{"ID":0}"#), Ok(None));
        assert_eq!(parse_progress("{}"), Ok(None));
        assert!(parse_progress("<html>").is_err());
        assert!(parse_game_list("{}").is_err());
    }

    #[test]
    fn game_list_is_parsed_and_searched() {
        let games = parse_game_list(GAMES).unwrap();
        assert_eq!(games.len(), 3);
        assert_eq!(games[0], RaGame { id: 228, title: "Super Mario World".into(), console_id: 3, console_name: "SNES/Super Famicom".into(), icon: Some("https://media.retroachievements.org/Images/085573.png".into()), num_achievements: 3, points: 35 });
        let hits = filter_games(&games, "mario world (USA)", true);
        assert_eq!(hits.iter().map(|g| g.id).collect::<Vec<_>>(), vec![228]);
        // Games without achievements are skipped when asked.
        assert!(filter_games(&games, "empty", true).is_empty());
        assert_eq!(filter_games(&games, "empty", false).len(), 1);
        assert_eq!(filter_games(&games, "", true).len(), 2);
    }

    #[test]
    fn titles_normalize() {
        assert_eq!(normalize_title("Super Mario World (USA) [!]"), "super mario world");
        assert_eq!(normalize_title("Sonic & Knuckles: 3"), "sonic knuckles 3");
    }

    #[test]
    fn dates_parse_as_utc() {
        assert_eq!(parse_date("2020-01-02 03:04:05"), Some(1_577_934_245));
        assert_eq!(parse_date("1970-01-01 00:00:00"), Some(0));
        assert_eq!(parse_date(""), None);
        assert_eq!(parse_date("2020-13-02 03:04:05"), None);
    }

    #[test]
    fn urls_are_built_redacted_and_never_leak_the_key() {
        let key = "SECRETKEY12345678";
        let url = build_url("API_GetGameList", "Scott", key, &[("i", "3".into()), ("f", "1".into())]).unwrap();
        assert!(url.as_str().starts_with("https://retroachievements.org/API/API_GetGameList.php?"));
        assert!(url.as_str().contains(key));
        let shown = redact_url(&url);
        assert!(!shown.contains(key));
        assert!(shown.contains("y=REDACTED") && shown.contains("i=3") && shown.contains("z=Scott"));
        // A key with URL metacharacters is encoded, not injected.
        let tricky = build_url("API_GetUserProfile", "a", "k&u=evil", &[]).unwrap();
        assert_eq!(tricky.query_pairs().filter(|(k, _)| k == "u").count(), 0);
        assert!(!redact_url(&tricky).contains("evil"));
    }

    #[test]
    fn only_the_api_host_is_allowed() {
        let ok = |u: &str| host_allowed(&reqwest::Url::parse(u).unwrap());
        assert!(ok("https://retroachievements.org/API/API_GetUserProfile.php"));
        assert!(!ok("http://retroachievements.org/API/x"));
        assert!(!ok("https://media.retroachievements.org/x"));
        assert!(!ok("https://retroachievements.org.evil.test/x"));
        assert!(!ok("https://example.com/"));
    }

    #[test]
    fn credentials_are_validated() {
        assert!(valid_username("Scott_1") && !valid_username("") && !valid_username("a b") && !valid_username("a&b"));
        assert!(valid_key("abcDEF1234567890") && !valid_key("short") && !valid_key("has space 12345678"));
    }

    #[test]
    fn cache_ttl_and_round_trip() {
        assert!(is_fresh(100, 100 + PROGRESS_TTL_SECS - 1, PROGRESS_TTL_SECS));
        assert!(!is_fresh(100, 100 + PROGRESS_TTL_SECS, PROGRESS_TTL_SECS));
        assert!(is_fresh(100, 100 + GAME_LIST_TTL_SECS - 1, GAME_LIST_TTL_SECS));
        assert!(!is_fresh(100, 100 + GAME_LIST_TTL_SECS, GAME_LIST_TTL_SECS));
        assert!(!is_fresh(200, 100, PROGRESS_TTL_SECS), "a clock that went backwards is not fresh");
        let dir = temp_dir("racache");
        let set = parse_progress(PROGRESS).unwrap().unwrap();
        let path = progress_path(&dir, "Sc/ott", 228);
        write_cached(&path, 1234, &set);
        let back: Cached<RaProgressSet> = read_cached(&path).unwrap();
        assert_eq!((back.fetched_at, back.value), (1234, set));
        assert!(!path.file_name().unwrap().to_string_lossy().contains('/'));
        let games = parse_game_list(GAMES).unwrap();
        write_cached(&games_path(&dir, 3), 5, &games);
        assert_eq!(read_cached::<Vec<RaGame>>(&games_path(&dir, 3)).unwrap().value, games);
        assert!(read_cached::<Vec<RaGame>>(&games_path(&dir, 4)).is_none());
        let _ = fs::remove_dir_all(dir);
    }
}
