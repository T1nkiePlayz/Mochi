//! A player's Steam achievements for one game, without requiring a Steam Web API key.
//!
//! Sources, in order:
//! 1. The Web API, only when the user supplied their own key in Settings (never shipped, never logged).
//! 2. The public Steam Community profile XML (`/profiles/<id64>/stats/<appid>/?xml=1`).
//!
//! The SteamID64 comes from the local Steam install (`config/loginusers.vdf`, falling back to the
//! `userdata/<accountid>` folders). Results are cached on disk and served stale when offline.
//! Every request is size and time capped and limited to an allow-list of Steam hosts.
//!
//! Steam rate limits aggressively, so all requests go through one gate: one request at a time, a
//! minimum gap (plus jitter) between them, and after an HTTP 429 a growing back-off during which no
//! request is sent at all. Cached data is then served as "saved data" instead of an error.
use crate::{platform, sources, steam_store::decode_entities};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

/// A cached result is reused for this long even when a game is opened again and again.
const FRESH_SECS: u64 = 6 * 60 * 60;
/// A manual refresh of one game is ignored when its data is newer than this.
const MANUAL_REFRESH_MIN_SECS: u64 = 60;
/// Smallest gap between two requests to Steam, before jitter.
const MIN_GAP_MS: u64 = 1_500;
const JITTER_MS: u64 = 700;
const BACKOFF_BASE_SECS: u64 = 30;
const BACKOFF_MAX_SECS: u64 = 15 * 60;
const MAX_BYTES: usize = 4 * 1024 * 1024;
const MAX_ACHIEVEMENTS: usize = 1000;
const ID64_BASE: u64 = 76_561_197_960_265_728;
const USER_AGENT: &str = concat!("Mochi/", env!("CARGO_PKG_VERSION"), " (game launcher)");
/// Hosts a request or redirect may touch. Image hosts are handled separately by `safe_icon`.
const API_HOSTS: [&str; 3] = ["steamcommunity.com", "www.steamcommunity.com", "api.steampowered.com"];
static INDEX_LOCK: Mutex<()> = Mutex::new(());

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SteamAchievement {
    pub api_name: String,
    pub name: String,
    pub description: String,
    pub icon: Option<String>,
    pub icon_gray: Option<String>,
    pub unlocked: bool,
    /// Unix seconds (UTC).
    pub unlocked_at: Option<i64>,
    /// Hidden achievements have no description until they are unlocked.
    pub hidden: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SteamAchievementSet {
    pub appid: u32,
    pub game_name: String,
    pub achievements: Vec<SteamAchievement>,
    pub unlocked: u32,
    pub total: u32,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SteamAchievementsResult {
    /// "ok", "private", "no-achievements", "no-steam-user", "offline", "rate-limited" or "error". The command never rejects.
    pub status: &'static str,
    pub data: Option<SteamAchievementSet>,
    /// True when `data` is an older cached copy because the network failed.
    pub stale: bool,
    pub fetched_at: Option<u64>,
    pub message: Option<String>,
    pub steam_id: Option<String>,
    /// "webapi", "community" or "cache".
    pub source: &'static str,
    /// Seconds until Mochi will ask Steam again, set while Steam is rate limiting.
    pub retry_after_secs: Option<u64>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AchievementSummary {
    pub appid: u32,
    pub steam_id: String,
    pub unlocked: u32,
    pub total: u32,
    pub fetched_at: u64,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CacheEntry {
    fetched_at: u64,
    steam_id: String,
    set: SteamAchievementSet,
}

#[derive(Debug, PartialEq)]
enum Parsed {
    Set(SteamAchievementSet),
    Private,
    None(String),
}

enum FetchError {
    Offline(String),
    /// 401/403: a private profile or a rejected API key.
    Denied,
    /// HTTP 429, or a request skipped because we are still backing off; carries the seconds left.
    RateLimited(u64),
    Other(String),
}

/// The single gate every Steam request passes through. Pure state (times are unix milliseconds passed
/// in) so the policy is unit tested without a network or a clock.
#[derive(Debug, Default)]
struct Limiter {
    next_slot_ms: u64,
    blocked_until_ms: u64,
    strikes: u32,
}

impl Limiter {
    const fn new() -> Self { Limiter { next_slot_ms: 0, blocked_until_ms: 0, strikes: 0 } }

    /// Milliseconds left of a back-off, if one is active.
    fn blocked_for(&self, now: u64) -> Option<u64> { (self.blocked_until_ms > now).then(|| self.blocked_until_ms - now) }

    /// Milliseconds to wait before the next request may start.
    fn wait_ms(&self, now: u64) -> u64 { self.next_slot_ms.saturating_sub(now) }

    /// Call when a request finished (any outcome): the next one starts after the gap.
    fn finished(&mut self, now: u64, jitter: u64) { self.next_slot_ms = now + MIN_GAP_MS + jitter % (JITTER_MS + 1); }

    fn succeeded(&mut self) { self.strikes = 0; }

    /// Registers an HTTP 429. Honours `Retry-After` (capped); otherwise doubles from 30 s up to 15 min. Returns the seconds blocked.
    fn rate_limited(&mut self, now: u64, retry_after: Option<u64>, jitter: u64) -> u64 {
        self.strikes = self.strikes.saturating_add(1);
        let exponential = BACKOFF_BASE_SECS.saturating_mul(1u64 << (self.strikes - 1).min(10));
        let secs = retry_after.filter(|secs| *secs > 0).map_or(exponential, |secs| secs.max(BACKOFF_BASE_SECS.min(exponential))).min(BACKOFF_MAX_SECS);
        let extra_ms = jitter % (secs * 100 + 1); // up to 10 % jitter
        self.blocked_until_ms = now + secs * 1000 + extra_ms;
        secs
    }
}

static LIMITER: tokio::sync::Mutex<Limiter> = tokio::sync::Mutex::const_new(Limiter::new());

fn now_ms() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0) }

/// Cheap jitter without a randomness dependency: sub-second clock noise mixed with the process id.
fn jitter() -> u64 {
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| u64::from(d.subsec_nanos())).unwrap_or(0);
    (nanos ^ (u64::from(std::process::id()) << 7)).wrapping_mul(0x9E37_79B9_7F4A_7C15) >> 40
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

// ---------------------------------------------------------------------------
// Local Steam account
// ---------------------------------------------------------------------------

pub fn valid_steam_id(id: &str) -> bool {
    id.len() == 17 && id.starts_with("7656") && id.bytes().all(|b| b.is_ascii_digit())
}

/// The account that last signed in, from `loginusers.vdf`.
pub fn parse_login_users(text: &str) -> Option<String> {
    let mut best: Option<(bool, u64, String)> = None;
    let mut current: Option<(String, bool, u64)> = None;
    let mut finish = |entry: Option<(String, bool, u64)>| {
        if let Some((id, recent, stamp)) = entry {
            if best.as_ref().is_none_or(|(r, s, _)| (recent, stamp) > (*r, *s)) { best = Some((recent, stamp, id)); }
        }
    };
    for line in text.lines() {
        let trimmed = line.trim();
        if let Some(id) = trimmed.strip_prefix('"').and_then(|t| t.strip_suffix('"')).filter(|id| valid_steam_id(id)) {
            finish(current.take());
            current = Some((id.to_string(), false, 0));
        } else if let Some((_, recent, stamp)) = current.as_mut() {
            if let Some(value) = sources::quoted_vdf_value(trimmed, "MostRecent") { *recent = value == "1"; }
            if let Some(value) = sources::quoted_vdf_value(trimmed, "Timestamp") { *stamp = value.parse().unwrap_or(0); }
        }
    }
    finish(current.take());
    best.map(|(_, _, id)| id)
}

/// Fallback: `userdata/<accountid>` folders; the most recently touched one wins.
fn id_from_userdata(root: &Path) -> Option<String> {
    let mut best: Option<(SystemTime, u64)> = None;
    for entry in fs::read_dir(root.join("userdata")).ok()?.flatten() {
        let Some(account) = entry.file_name().to_str().and_then(|n| n.parse::<u64>().ok()).filter(|n| *n > 0 && *n < u64::from(u32::MAX)) else { continue };
        let modified = entry.metadata().and_then(|m| m.modified()).unwrap_or(UNIX_EPOCH);
        if best.is_none_or(|(time, _)| modified > time) { best = Some((modified, account)); }
    }
    best.map(|(_, account)| (account + ID64_BASE).to_string())
}

pub fn find_steam_id(roots: &[PathBuf]) -> Option<String> {
    for root in roots {
        if let Some(id) = fs::read_to_string(root.join("config/loginusers.vdf")).ok().and_then(|text| parse_login_users(&text)) { return Some(id); }
    }
    roots.iter().find_map(|root| id_from_userdata(root))
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/// Icons are shown in the app, so only https images from Steam's own CDNs are kept.
pub fn safe_icon(url: &str) -> Option<String> {
    let url = url.trim();
    let secure = url.strip_prefix("https://").map(str::to_string).or_else(|| url.strip_prefix("http://").map(str::to_string))?;
    let host = secure.split(['/', '?', '#']).next().unwrap_or("");
    let ok = host == "steamcdn-a.akamaihd.net" || (host.ends_with(".steamstatic.com") && host.len() > ".steamstatic.com".len() && host.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-'));
    (ok && !host.is_empty() && secure.len() <= 400).then(|| format!("https://{secure}"))
}

fn tag_text(block: &str, tag: &str) -> Option<String> {
    let start = block.find(&format!("<{tag}>"))? + tag.len() + 2;
    let end = block[start..].find(&format!("</{tag}>"))? + start;
    let raw = block[start..end].trim();
    let inner = raw.strip_prefix("<![CDATA[").and_then(|r| r.strip_suffix("]]>")).unwrap_or(raw);
    Some(decode_entities(inner.trim()))
}

fn finish_set(appid: u32, game_name: String, mut achievements: Vec<SteamAchievement>) -> SteamAchievementSet {
    achievements.truncate(MAX_ACHIEVEMENTS);
    let unlocked = achievements.iter().filter(|a| a.unlocked).count() as u32;
    SteamAchievementSet { appid, game_name, total: achievements.len() as u32, unlocked, achievements }
}

/// Parses the Community `?xml=1` stats page. `Err` means the body was not a stats document at all.
fn parse_community_xml(appid: u32, body: &str) -> Result<Parsed, String> {
    if let Some(message) = tag_text(body, "error") {
        let lower = message.to_ascii_lowercase();
        if lower.contains("private") { return Ok(Parsed::Private); }
        if lower.contains("could not be found") { return Err("That Steam profile could not be found.".into()); }
        return Ok(Parsed::None("Steam has no achievement data for this game, or your game details are private.".into()));
    }
    if !body.contains("<playerstats") { return Err("Steam returned unreadable data.".into()); }
    let privacy = tag_text(body, "privacyState").unwrap_or_default().to_ascii_lowercase();
    let game_name = tag_text(body, "gameName").unwrap_or_default();
    let mut achievements = Vec::new();
    let mut rest = body;
    while let Some(at) = rest.find("<achievement") {
        let tail = &rest[at + "<achievement".len()..];
        let Some(open_end) = tail.find('>') else { break };
        let attrs = &tail[..open_end];
        // `<achievements>` (the list wrapper) also starts with this prefix.
        if !attrs.is_empty() && !attrs.starts_with(' ') { rest = tail; continue; }
        let Some(close) = tail.find("</achievement>") else { break };
        let block = &tail[open_end + 1..close];
        rest = &tail[close + "</achievement>".len()..];
        let api_name = tag_text(block, "apiname").unwrap_or_default();
        let name = tag_text(block, "name").unwrap_or_default();
        if api_name.is_empty() && name.is_empty() { continue; }
        let unlocked = attrs.contains("closed=\"1\"");
        let description = tag_text(block, "description").unwrap_or_default();
        achievements.push(SteamAchievement {
            hidden: !unlocked && description.is_empty(),
            icon: tag_text(block, "iconClosed").as_deref().and_then(safe_icon),
            icon_gray: tag_text(block, "iconOpen").as_deref().and_then(safe_icon),
            unlocked_at: if unlocked { tag_text(block, "unlockTimestamp").and_then(|t| t.parse().ok()).filter(|t| *t > 0) } else { None },
            unlocked, description, name: if name.is_empty() { api_name.clone() } else { name }, api_name,
        });
        if achievements.len() >= MAX_ACHIEVEMENTS { break; }
    }
    if achievements.is_empty() {
        if privacy.contains("private") || privacy.contains("friends") { return Ok(Parsed::Private); }
        return Ok(Parsed::None("This game has no Steam achievements.".into()));
    }
    Ok(Parsed::Set(finish_set(appid, game_name, achievements)))
}

/// Merges `GetPlayerAchievements` with the optional `GetSchemaForGame` (icons, hidden flag).
fn parse_web_api(appid: u32, player: &str, schema: Option<&str>) -> Result<Parsed, String> {
    let root: Value = serde_json::from_str(player).map_err(|_| "Steam returned unreadable data.".to_string())?;
    let stats = root.get("playerstats").ok_or("Steam returned unreadable data.")?;
    if stats.get("success").and_then(Value::as_bool) != Some(true) {
        let error = stats.get("error").and_then(Value::as_str).unwrap_or("").to_ascii_lowercase();
        if error.contains("not public") || error.contains("private") { return Ok(Parsed::Private); }
        return Ok(Parsed::None("Steam has no achievement data for this game.".into()));
    }
    let schema: Value = schema.and_then(|text| serde_json::from_str(text).ok()).unwrap_or(Value::Null);
    let mut extras: HashMap<&str, &Value> = HashMap::new();
    for item in schema.pointer("/game/availableGameStats/achievements").and_then(Value::as_array).into_iter().flatten() {
        if let Some(name) = item.get("name").and_then(Value::as_str) { extras.insert(name, item); }
    }
    let text = |value: Option<&Value>, key: &str| value.and_then(|v| v.get(key)).and_then(Value::as_str).unwrap_or("").trim().to_string();
    let mut achievements = Vec::new();
    for item in stats.get("achievements").and_then(Value::as_array).into_iter().flatten().take(MAX_ACHIEVEMENTS) {
        let api_name = text(Some(item), "apiname");
        if api_name.is_empty() { continue; }
        let extra = extras.get(api_name.as_str()).copied();
        let unlocked = item.get("achieved").and_then(Value::as_i64) == Some(1);
        let mut name = text(extra, "displayName");
        if name.is_empty() { name = text(Some(item), "name"); }
        if name.is_empty() { name = api_name.clone(); }
        let mut description = text(extra, "description");
        if description.is_empty() { description = text(Some(item), "description"); }
        achievements.push(SteamAchievement {
            hidden: extra.and_then(|e| e.get("hidden")).and_then(Value::as_i64) == Some(1) || (!unlocked && description.is_empty()),
            icon: safe_icon(&text(extra, "icon")),
            icon_gray: safe_icon(&text(extra, "icongray")),
            unlocked_at: if unlocked { item.get("unlocktime").and_then(Value::as_i64).filter(|t| *t > 0) } else { None },
            unlocked, name, description, api_name,
        });
    }
    if achievements.is_empty() { return Ok(Parsed::None("This game has no Steam achievements.".into())); }
    let game_name = stats.get("gameName").and_then(Value::as_str).unwrap_or("").to_string();
    Ok(Parsed::Set(finish_set(appid, game_name, achievements)))
}

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

pub fn host_allowed(url: &reqwest::Url) -> bool {
    url.scheme() == "https" && url.host_str().is_some_and(|host| API_HOSTS.contains(&host))
}

async fn fetch_text(url: &str) -> Result<String, FetchError> {
    // Holding the gate for the whole request keeps Steam traffic strictly one at a time.
    let mut gate = LIMITER.lock().await;
    if let Some(left) = gate.blocked_for(now_ms()) { return Err(FetchError::RateLimited(left.div_ceil(1000))); }
    let wait = gate.wait_ms(now_ms());
    if wait > 0 { tokio::time::sleep(Duration::from_millis(wait)).await; }
    let outcome = request_text(url).await;
    let now = now_ms();
    let outcome = match outcome {
        // A 429 carries the server's Retry-After (0 when absent); report how long Mochi will actually back off.
        Err(FetchError::RateLimited(retry_after)) => Err(FetchError::RateLimited(gate.rate_limited(now, (retry_after > 0).then_some(retry_after), jitter()))),
        Ok(text) => { gate.succeeded(); Ok(text) }
        other => other,
    };
    gate.finished(now, jitter());
    outcome
}

async fn request_text(url: &str) -> Result<String, FetchError> {
    static CLIENT: crate::util::http::SharedClient = crate::util::http::SharedClient::new();
    let client = CLIENT.get(|| crate::util::http::builder().user_agent(USER_AGENT)
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() < 3 && host_allowed(attempt.url()) { attempt.follow() } else { attempt.stop() }
        }))
        .connect_timeout(Duration::from_secs(8)).timeout(Duration::from_secs(20)).build(), "Unable to prepare the Steam request")
        .map_err(|_| FetchError::Other("Unable to prepare the Steam request.".into()))?;
    // Errors are mapped without their URL: a Web API request carries the user's key.
    let mut response = client.get(url).send().await.map_err(|error| {
        if error.is_connect() || error.is_timeout() { FetchError::Offline("Steam could not be reached.".into()) } else { FetchError::Other("The Steam request failed.".into()) }
    })?;
    let status = response.status().as_u16();
    if status == 401 || status == 403 { return Err(FetchError::Denied); }
    if status == 429 || status == 503 {
        let retry_after = response.headers().get(reqwest::header::RETRY_AFTER).and_then(|value| value.to_str().ok()).and_then(|value| value.trim().parse::<u64>().ok()).unwrap_or(0);
        return Err(FetchError::RateLimited(retry_after));
    }
    if !response.status().is_success() { return Err(FetchError::Other(format!("Steam returned HTTP {status}."))); }
    if response.content_length().is_some_and(|length| length as usize > MAX_BYTES) { return Err(FetchError::Other("Steam response is too large.".into())); }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| FetchError::Offline("Steam connection dropped.".into()))? {
        if body.len() + chunk.len() > MAX_BYTES { return Err(FetchError::Other("Steam response is too large.".into())); }
        body.extend_from_slice(&chunk);
    }
    String::from_utf8(body).map_err(|_| FetchError::Other("Steam returned non-text data.".into()))
}

async fn fetch_community(appid: u32, steam_id: &str) -> Result<Parsed, FetchError> {
    let body = fetch_text(&format!("https://steamcommunity.com/profiles/{steam_id}/stats/{appid}/?xml=1&l=english")).await?;
    parse_community_xml(appid, &body).map_err(FetchError::Other)
}

async fn fetch_web_api(appid: u32, steam_id: &str, key: &str) -> Result<Parsed, FetchError> {
    let player = fetch_text(&format!("https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/?key={key}&steamid={steam_id}&appid={appid}&l=english")).await?;
    // The schema only adds icons and the hidden flag, so a failure there is not fatal.
    let schema = fetch_text(&format!("https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/?key={key}&appid={appid}&l=english")).await.ok();
    parse_web_api(appid, &player, schema.as_deref()).map_err(FetchError::Other)
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

fn cache_dir(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_data_dir().ok()?.join("steam-achievements");
    fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

fn entry_path(dir: &Path, steam_id: &str, appid: u32) -> PathBuf { dir.join(format!("{steam_id}_{appid}.json")) }

fn read_entry(path: &Path) -> Option<CacheEntry> {
    serde_json::from_slice(&fs::read(path).ok()?).ok()
}

fn write_atomic(path: &Path, bytes: &[u8]) {
    let tmp = path.with_extension(format!("{}.tmp", std::process::id()));
    if fs::write(&tmp, bytes).is_ok() && fs::rename(&tmp, path).is_err() { let _ = fs::remove_file(&tmp); }
}

fn read_index(dir: &Path) -> HashMap<String, AchievementSummary> {
    fs::read(dir.join("index.json")).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok()).unwrap_or_default()
}

/// Stores one game's result and its line in the small index used for library-wide totals.
fn store_entry(dir: &Path, entry: &CacheEntry) {
    let appid = entry.set.appid;
    if let Ok(bytes) = serde_json::to_vec(entry) { write_atomic(&entry_path(dir, &entry.steam_id, appid), &bytes); }
    let _guard = INDEX_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut index = read_index(dir);
    index.insert(format!("{}_{appid}", entry.steam_id), AchievementSummary { appid, steam_id: entry.steam_id.clone(), unlocked: entry.set.unlocked, total: entry.set.total, fetched_at: entry.fetched_at });
    if let Ok(bytes) = serde_json::to_vec(&index) { write_atomic(&dir.join("index.json"), &bytes); }
}

/// Any cached copy for this app (used when no Steam account is found locally).
fn find_any_entry(dir: &Path, appid: u32) -> Option<CacheEntry> {
    let suffix = format!("_{appid}.json");
    fs::read_dir(dir).ok()?.flatten()
        .filter(|entry| entry.file_name().to_str().is_some_and(|name| name.ends_with(&suffix) && valid_steam_id(&name[..name.len() - suffix.len()])))
        .filter_map(|entry| read_entry(&entry.path()))
        .max_by_key(|entry| entry.fetched_at)
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

fn reply(status: &'static str, data: Option<SteamAchievementSet>, stale: bool, fetched_at: Option<u64>, message: Option<String>, steam_id: Option<String>, source: &'static str) -> SteamAchievementsResult {
    SteamAchievementsResult { status, data, stale, fetched_at, message, steam_id, source, retry_after_secs: None }
}

/// Friendly text for a rate-limited Steam, with or without saved data to show.
fn busy_message(secs: u64, have_data: bool) -> String {
    let when = if secs >= 90 { format!("in about {} minutes", secs.div_ceil(60)) } else { "shortly".to_string() };
    if have_data { format!("Showing saved data. Steam is busy, so Mochi will try again {when}.") } else { format!("Steam is busy right now, so achievements could not be loaded. Mochi will try again {when}.") }
}

fn valid_key(key: &str) -> bool { key.len() == 32 && key.bytes().all(|b| b.is_ascii_hexdigit()) }

/// Never rejects: private profiles, missing accounts and offline states come back as `status`/`message`.
/// `steam_id` and `api_key` are optional user overrides from Settings.
#[tauri::command]
pub async fn get_steam_achievements(app: AppHandle, appid: u32, steam_id: Option<String>, api_key: Option<String>, refresh: Option<bool>) -> SteamAchievementsResult {
    if appid == 0 { return reply("error", None, false, None, Some("Invalid Steam app id.".into()), None, "community"); }
    let dir = cache_dir(&app);
    let id = steam_id.map(|s| s.trim().to_string()).filter(|s| valid_steam_id(s)).or_else(|| {
        let home = platform::home_dir()?;
        find_steam_id(&sources::steam_install_roots(&home))
    });
    let Some(id) = id else {
        if let Some(entry) = dir.as_deref().and_then(|d| find_any_entry(d, appid)) {
            return reply("ok", Some(entry.set), true, Some(entry.fetched_at), Some("No Steam account was found on this device; showing saved data.".into()), Some(entry.steam_id), "cache");
        }
        return reply("no-steam-user", None, false, None, Some("Mochi could not find a signed-in Steam account on this device. Sign in to Steam once, or enter your SteamID64 in Settings.".into()), None, "community");
    };
    let cached = dir.as_deref().and_then(|d| read_entry(&entry_path(d, &id, appid)));
    let now = now_secs();
    if let Some(entry) = &cached {
        let age = now.saturating_sub(entry.fetched_at);
        if age < if refresh == Some(true) { MANUAL_REFRESH_MIN_SECS } else { FRESH_SECS } {
            return reply("ok", Some(entry.set.clone()), false, Some(entry.fetched_at), None, Some(id), "cache");
        }
    }
    let key = api_key.map(|k| k.trim().to_string()).filter(|k| valid_key(k));
    let mut source = "community";
    let mut fetched = None;
    if let Some(key) = &key {
        source = "webapi";
        fetched = Some(fetch_web_api(appid, &id, key).await);
    }
    // No key, or the key route did not produce data: the public profile page is the fallback.
    if !matches!(fetched, Some(Ok(Parsed::Set(_)))) {
        let community = fetch_community(appid, &id).await;
        if fetched.is_none() || matches!(community, Ok(Parsed::Set(_))) { source = "community"; fetched = Some(community); }
    }
    match fetched.expect("a fetch always runs") {
        Ok(Parsed::Set(set)) => {
            if let Some(dir) = &dir { store_entry(dir, &CacheEntry { fetched_at: now, steam_id: id.clone(), set: set.clone() }); }
            reply("ok", Some(set), false, Some(now), None, Some(id), source)
        }
        Ok(Parsed::Private) => reply("private", None, false, None, Some("This Steam profile's game details are private, so achievements cannot be read. Set \"Game details\" to Public in Steam privacy settings, or add your own Steam Web API key in Settings.".into()), Some(id), source),
        Ok(Parsed::None(message)) => reply("no-achievements", None, false, None, Some(message), Some(id), source),
        Err(error) => {
            let mut retry = None;
            let (status, message) = match error {
                FetchError::Offline(message) => ("offline", message),
                FetchError::Denied => ("private", "Steam refused the request. The profile is private or the API key was rejected.".to_string()),
                FetchError::RateLimited(secs) => { retry = Some(secs); ("rate-limited", busy_message(secs, cached.is_some())) }
                FetchError::Other(message) => ("error", message),
            };
            let mut result = match cached {
                Some(entry) => reply("ok", Some(entry.set), true, Some(entry.fetched_at), Some(message), Some(id), "cache"),
                None => reply(status, None, false, None, Some(message), Some(id), source),
            };
            result.retry_after_secs = retry;
            result
        }
    }
}

/// Deletes every saved achievements file (Settings > Data & privacy). The next open fetches again.
#[tauri::command(async)]
pub fn clear_steam_achievements_cache(app: AppHandle) -> Result<(), String> {
    let Ok(base) = app.path().app_data_dir() else { return Ok(()) };
    let dir = base.join("steam-achievements");
    if dir.exists() { fs::remove_dir_all(&dir).map_err(|error| format!("Unable to clear saved Steam achievements: {error}"))?; }
    Ok(())
}

/// Per-game unlocked/total counts from everything cached so far (no network).
#[tauri::command(async)]
pub fn get_steam_achievement_totals(app: AppHandle) -> Vec<AchievementSummary> {
    let Some(dir) = cache_dir(&app) else { return Vec::new() };
    let mut best: HashMap<u32, AchievementSummary> = HashMap::new();
    for summary in read_index(&dir).into_values() {
        if best.get(&summary.appid).is_none_or(|current| summary.fetched_at > current.fetched_at) { best.insert(summary.appid, summary); }
    }
    let mut out: Vec<_> = best.into_values().collect();
    out.sort_by_key(|summary| summary.appid);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sources::testutil::temp_dir;
    const XML: &str = include_str!("../fixtures/steam_achievements_220.xml");
    const PRIVATE: &str = include_str!("../fixtures/steam_achievements_private.xml");
    const PLAYER: &str = include_str!("../fixtures/steam_webapi_player.json");
    const SCHEMA: &str = include_str!("../fixtures/steam_webapi_schema.json");
    const LOGIN: &str = include_str!("../fixtures/steam_loginusers.vdf");

    fn set(parsed: Result<Parsed, String>) -> SteamAchievementSet {
        match parsed { Ok(Parsed::Set(set)) => set, other => panic!("expected a set, got {other:?}") }
    }

    #[test]
    fn community_xml_is_parsed() {
        let set = set(parse_community_xml(220, XML));
        assert_eq!((set.total, set.unlocked, set.game_name.as_str()), (3, 1, "Half-Life 2"));
        let first = &set.achievements[0];
        assert_eq!(first.name, "Welcome to City 17 & beyond");
        assert_eq!(first.api_name, "HL2_BEAT_CITYENTRY");
        assert_eq!((first.unlocked, first.unlocked_at, first.hidden), (true, Some(1_700_000_000), false));
        assert!(first.icon.as_deref().is_some_and(|u| u.starts_with("https://cdn.akamai.steamstatic.com/")));
        let locked = &set.achievements[1];
        assert_eq!((locked.unlocked, locked.unlocked_at, locked.hidden), (false, None, false));
    }

    #[test]
    fn hidden_and_unsafe_icons() {
        let secret = &set(parse_community_xml(220, XML)).achievements[2];
        assert!(secret.hidden);
        assert_eq!((secret.icon.as_deref(), secret.icon_gray.as_deref()), (None, None));
    }

    #[test]
    fn private_and_missing_data_are_distinguished() {
        assert_eq!(parse_community_xml(1, PRIVATE), Ok(Parsed::Private));
        assert!(matches!(parse_community_xml(1, "<response><error><![CDATA[Could not retrieve game stats.]]></error></response>"), Ok(Parsed::None(_))));
        assert!(parse_community_xml(1, "<response><error>The specified profile could not be found.</error></response>").is_err());
        assert!(matches!(parse_community_xml(1, "<playerstats><privacyState>public</privacyState></playerstats>"), Ok(Parsed::None(_))));
        assert_eq!(parse_community_xml(1, "<playerstats><privacyState>friendsonly</privacyState></playerstats>"), Ok(Parsed::Private));
        assert!(parse_community_xml(1, "<html>login</html>").is_err());
    }

    #[test]
    fn hostile_xml_never_panics_and_is_capped() {
        for body in ["", "<achievement", "<playerstats><achievement closed=\"1\"", "<playerstats><achievement ></achievement>", "<playerstats><achievements><achievement><name>", "<error>", "\u{1F600}<playerstats>\u{1F600}<achievement closed=\"1\">\u{1F600}"] {
            let _ = parse_community_xml(1, body);
        }
        let many: String = (0..3000).map(|i| format!("<achievement closed=\"0\"><apiname>A{i}</apiname><name>N{i}</name><description>d</description></achievement>")).collect();
        let set = set(parse_community_xml(1, &format!("<playerstats>{many}</playerstats>")));
        assert_eq!(set.total as usize, MAX_ACHIEVEMENTS);
    }

    #[test]
    fn web_api_merges_schema() {
        let merged = set(parse_web_api(220, PLAYER, Some(SCHEMA)));
        assert_eq!((merged.total, merged.unlocked), (2, 1));
        assert_eq!(merged.achievements[0].unlocked_at, Some(1_700_000_000));
        assert!(merged.achievements[0].icon_gray.is_some());
        let secret = &merged.achievements[1];
        assert!(secret.hidden);
        assert_eq!(secret.icon.as_deref(), Some("https://steamcdn-a.akamaihd.net/steamcommunity/public/images/apps/220/s.jpg"));
        assert_eq!(secret.icon_gray, None);
        // Without a schema the player data alone still works.
        assert_eq!(set(parse_web_api(220, PLAYER, None)).total, 2);
        assert_eq!(set(parse_web_api(220, PLAYER, Some("garbage"))).total, 2);
    }

    #[test]
    fn web_api_failures() {
        assert_eq!(parse_web_api(1, r#"{"playerstats":{"error":"Profile is not public","success":false}}"#, None), Ok(Parsed::Private));
        assert!(matches!(parse_web_api(1, r#"{"playerstats":{"success":true}}"#, None), Ok(Parsed::None(_))));
        assert!(parse_web_api(1, "nope", None).is_err());
        for body in ["null", "[]", r#"{"playerstats":5}"#, r#"{"playerstats":{"success":true,"achievements":[1,null,{"apiname":5}]}}"#] {
            let _ = parse_web_api(1, body, Some(body));
        }
    }

    #[test]
    fn icons_are_limited_to_steam_cdns() {
        assert_eq!(safe_icon("http://cdn.akamai.steamstatic.com/a.jpg").as_deref(), Some("https://cdn.akamai.steamstatic.com/a.jpg"));
        assert!(safe_icon("https://steamstatic.com/a.jpg").is_none());
        assert!(safe_icon("https://evilsteamstatic.com/a.jpg").is_none());
        assert!(safe_icon("https://cdn.steamstatic.com.evil.com/a.jpg").is_none());
        assert!(safe_icon("https://cdn.steamstatic.com@evil.com/a.jpg").is_none());
        assert!(safe_icon("data:image/png;base64,AAAA").is_none());
        assert!(safe_icon("").is_none());
    }

    #[test]
    fn limiter_spaces_requests_and_backs_off_on_429() {
        let mut gate = Limiter::new();
        assert_eq!((gate.blocked_for(1_000), gate.wait_ms(1_000)), (None, 0));
        gate.finished(1_000, 0);
        assert_eq!(gate.wait_ms(1_000), MIN_GAP_MS);
        assert_eq!(gate.wait_ms(1_000 + MIN_GAP_MS + 5), 0);
        // Jitter never exceeds its cap.
        gate.finished(0, u64::MAX);
        assert!(gate.wait_ms(0) <= MIN_GAP_MS + JITTER_MS);
        // Exponential back-off: 30 s, 60 s, 120 s ... capped at 15 minutes.
        let secs: Vec<u64> = (0..8).map(|_| gate.rate_limited(10_000, None, 0)).collect();
        assert_eq!(secs, vec![30, 60, 120, 240, 480, 900, 900, 900]);
        assert_eq!(gate.blocked_for(10_000).map(|ms| ms / 1000), Some(900));
        assert_eq!(gate.blocked_for(10_000 + 901_000 + 90_000), None);
        gate.succeeded();
        assert_eq!(gate.rate_limited(0, None, 0), 30);
    }

    #[test]
    fn retry_after_is_honoured_but_capped_and_jitter_is_small() {
        let mut gate = Limiter::new();
        assert_eq!(gate.rate_limited(0, Some(120), 0), 120);
        assert_eq!(gate.rate_limited(0, Some(86_400), 0), BACKOFF_MAX_SECS);
        let mut gate = Limiter::new();
        gate.rate_limited(0, Some(100), u64::MAX);
        let until = gate.blocked_until_ms;
        assert!((100_000..=110_000).contains(&until), "{until}");
    }

    #[test]
    fn busy_messages_are_friendly() {
        assert!(busy_message(20, true).starts_with("Showing saved data"));
        assert!(busy_message(600, false).contains("10 minutes"));
        assert!(!busy_message(30, true).contains("429"));
    }

    #[test]
    fn network_hosts_are_allow_listed() {
        let ok = |u: &str| host_allowed(&reqwest::Url::parse(u).unwrap());
        assert!(ok("https://steamcommunity.com/profiles/1/stats/2/?xml=1"));
        assert!(ok("https://api.steampowered.com/x"));
        assert!(!ok("http://steamcommunity.com/x"));
        assert!(!ok("https://steamcommunity.com.evil.com/x"));
        assert!(!ok("https://evil.com/steamcommunity.com"));
    }

    #[test]
    fn steam_ids() {
        assert!(valid_steam_id("76561197960287930"));
        for bad in ["", "123", "7656119796028793", "76561197960287930x", "86561197960287930"] { assert!(!valid_steam_id(bad), "{bad}"); }
        assert_eq!(parse_login_users(LOGIN).as_deref(), Some("76561198000000001"));
        // Without MostRecent the newest timestamp wins.
        let no_recent = LOGIN.replace("\"MostRecent\"\t\t\"1\"", "\"MostRecent\"\t\t\"0\"");
        assert_eq!(parse_login_users(&no_recent).as_deref(), Some("76561197960287930"));
        assert_eq!(parse_login_users("garbage \"\" {"), None);
    }

    #[test]
    fn steam_id_comes_from_loginusers_then_userdata() {
        let root = temp_dir("steamid");
        assert_eq!(find_steam_id(std::slice::from_ref(&root)), None);
        fs::create_dir_all(root.join("userdata/22002")).unwrap();
        fs::create_dir_all(root.join("userdata/0")).unwrap();
        fs::create_dir_all(root.join("userdata/anonymous")).unwrap();
        assert_eq!(find_steam_id(std::slice::from_ref(&root)).as_deref(), Some((22_002 + ID64_BASE).to_string().as_str()));
        fs::create_dir_all(root.join("config")).unwrap();
        fs::write(root.join("config/loginusers.vdf"), LOGIN).unwrap();
        assert_eq!(find_steam_id(std::slice::from_ref(&root)).as_deref(), Some("76561198000000001"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn cache_round_trip_and_totals_index() {
        let dir = temp_dir("achcache");
        let id = "76561197960287930";
        let entry = CacheEntry { fetched_at: 100, steam_id: id.into(), set: set(parse_community_xml(220, XML)) };
        store_entry(&dir, &entry);
        let back = read_entry(&entry_path(&dir, id, 220)).unwrap();
        assert_eq!(back.set, entry.set);
        assert_eq!(find_any_entry(&dir, 220).unwrap().fetched_at, 100);
        assert!(find_any_entry(&dir, 221).is_none());
        let index = read_index(&dir);
        let summary = index.get(&format!("{id}_220")).unwrap();
        assert_eq!((summary.unlocked, summary.total), (1, 3));
        let _ = fs::remove_dir_all(dir);
    }
}
