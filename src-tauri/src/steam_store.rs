//! Keyless Steam Store lookups (`appdetails`) with an on-disk cache.
//! Stale entries are served when the network is unavailable so game details keep working offline.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use crate::util::{fsio, http, now_secs};
use std::{fs, path::PathBuf, time::Duration};
use tauri::{AppHandle, Manager};

const TTL_SECS: u64 = 7 * 24 * 60 * 60;
const NOT_FOUND_TTL_SECS: u64 = 24 * 60 * 60;
const MAX_BYTES: usize = 8 * 1024 * 1024;
const CDN: &str = "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps";
const USER_AGENT: &str = concat!("Mochi/", env!("CARGO_PKG_VERSION"), " (game launcher)");

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SteamMovie {
    pub name: String,
    pub thumbnail: Option<String>,
    pub hls_url: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SteamStoreDetails {
    pub appid: u32,
    pub name: String,
    pub description: String,
    pub genres: Vec<String>,
    pub screenshots: Vec<String>,
    pub movies: Vec<SteamMovie>,
    pub developers: Vec<String>,
    pub publishers: Vec<String>,
    /// Unix seconds (UTC), when the store's date text could be understood.
    pub release_date: Option<i64>,
    pub release_date_text: Option<String>,
    /// Keyless CDN art. These may 404 for older apps; callers should treat them as best effort.
    pub cover_url: String,
    pub header_url: String,
    pub hero_url: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SteamStoreResult {
    /// "ok", "not-found", "offline" or "error". The command never rejects.
    pub status: &'static str,
    pub details: Option<SteamStoreDetails>,
    /// True when `details` came from an expired cache entry because the network failed.
    pub stale: bool,
    pub fetched_at: Option<u64>,
    pub message: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CacheEntry {
    fetched_at: u64,
    details: Option<SteamStoreDetails>,
}

enum FetchError {
    Offline(String),
    Other(String),
}

/// Decodes `&#39;`, `&#x27;` and `&#8217;` style references (Steam descriptions use them freely).
fn decode_numeric_entities(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find("&#") {
        out.push_str(&rest[..start]);
        let tail = &rest[start + 2..];
        let decoded = tail.find(';').filter(|end| *end <= 8).and_then(|end| {
            let digits = &tail[..end];
            let code = match digits.strip_prefix(['x', 'X']) { Some(hex) => u32::from_str_radix(hex, 16).ok(), None => digits.parse::<u32>().ok() };
            code.and_then(char::from_u32).filter(|c| !c.is_control()).map(|c| (c, end + 1))
        });
        match decoded {
            Some((character, consumed)) => { out.push(character); rest = &tail[consumed..]; }
            None => { out.push_str("&#"); rest = tail; }
        }
    }
    out.push_str(rest);
    out
}

fn decode_entities(text: &str) -> String {
    decode_numeric_entities(text).replace("&quot;", "\"").replace("&#39;", "'").replace("&apos;", "'").replace("&lt;", "<").replace("&gt;", ">").replace("&nbsp;", " ").replace("&amp;", "&")
}

fn strip_query(url: &str) -> String {
    url.split('?').next().unwrap_or(url).to_string()
}

fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let y = if month <= 2 { year - 1 } else { year };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let doy = (153 * (month + if month > 2 { -3 } else { 9 }) + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// Understands "16 Nov, 2004", "Nov 16, 2004", "Nov 2004" and "2004". Anything else (e.g. "Coming soon") is `None`.
pub fn parse_release_date(text: &str) -> Option<i64> {
    const MONTHS: [&str; 12] = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    let (mut day, mut month, mut year) = (None, None, None);
    for token in text.split([' ', ',']).filter(|t| !t.is_empty()) {
        if let Some(index) = MONTHS.iter().position(|m| token.len() >= 3 && token.to_ascii_lowercase().starts_with(m)) {
            month = Some(index as i64 + 1);
        } else if let Ok(number) = token.parse::<i64>() {
            if token.len() == 4 { year = Some(number) } else if (1..=31).contains(&number) { day = Some(number) } else { return None }
        } else {
            return None;
        }
    }
    let year = year?;
    if !(1970..=2200).contains(&year) { return None; }
    Some(days_from_civil(year, month.unwrap_or(1), day.unwrap_or(1)) * 86_400)
}

fn string_list(value: Option<&Value>, key: &str) -> Vec<String> {
    value.and_then(Value::as_array).map(|items| {
        items.iter().filter_map(|item| match item { Value::String(text) => Some(text.clone()), other => other.get(key).and_then(Value::as_str).map(str::to_string) }).collect()
    }).unwrap_or_default()
}

/// Parses an `appdetails` response body. `Ok(None)` means the store has no such app.
pub fn parse_app_details(appid: u32, body: &str) -> Result<Option<SteamStoreDetails>, String> {
    let root: Value = serde_json::from_str(body).map_err(|error| format!("Steam returned unreadable data: {error}"))?;
    let entry = root.get(appid.to_string()).ok_or("Steam response did not include the requested app.")?;
    if entry.get("success").and_then(Value::as_bool) != Some(true) { return Ok(None); }
    let data = entry.get("data").ok_or("Steam response had no data.")?;
    let name = data.get("name").and_then(Value::as_str).unwrap_or("").trim().to_string();
    if name.is_empty() { return Ok(None); }
    let release = data.get("release_date");
    let release_text = release.and_then(|r| r.get("date")).and_then(Value::as_str).map(str::to_string).filter(|t| !t.is_empty());
    let coming_soon = release.and_then(|r| r.get("coming_soon")).and_then(Value::as_bool).unwrap_or(false);
    let screenshots = data.get("screenshots").and_then(Value::as_array).map(|items| {
        items.iter().filter_map(|s| s.get("path_full").and_then(Value::as_str)).map(strip_query).filter(|u| u.starts_with("https://")).take(12).collect()
    }).unwrap_or_default();
    let movies = data.get("movies").and_then(Value::as_array).map(|items| {
        items.iter().take(6).map(|m| SteamMovie {
            name: m.get("name").and_then(Value::as_str).unwrap_or("Trailer").to_string(),
            thumbnail: m.get("thumbnail").and_then(Value::as_str).map(strip_query).filter(|u| u.starts_with("https://")),
            hls_url: m.get("hls_h264").and_then(Value::as_str).map(str::to_string).filter(|u| u.starts_with("https://")),
        }).collect()
    }).unwrap_or_default();
    Ok(Some(SteamStoreDetails {
        appid,
        name,
        description: decode_entities(data.get("short_description").and_then(Value::as_str).unwrap_or("").trim()),
        genres: string_list(data.get("genres"), "description").into_iter().take(24).collect(),
        screenshots,
        movies,
        developers: string_list(data.get("developers"), "").into_iter().take(24).collect(),
        publishers: string_list(data.get("publishers"), "").into_iter().take(24).collect(),
        release_date: if coming_soon { None } else { release_text.as_deref().and_then(parse_release_date) },
        release_date_text: release_text,
        cover_url: format!("{CDN}/{appid}/library_600x900.jpg"),
        header_url: format!("{CDN}/{appid}/header.jpg"),
        hero_url: format!("{CDN}/{appid}/library_hero.jpg"),
    }))
}

fn cache_file(app: &AppHandle, appid: u32) -> Option<PathBuf> {
    let dir = app.path().app_data_dir().ok()?.join("steam-store");
    fs::create_dir_all(&dir).ok()?;
    Some(dir.join(format!("{appid}.json")))
}

fn read_cache(path: &Option<PathBuf>) -> Option<CacheEntry> {
    serde_json::from_slice(&fs::read(path.as_ref()?).ok()?).ok()
}

fn write_cache(path: &Option<PathBuf>, entry: &CacheEntry) {
    if let (Some(path), Ok(bytes)) = (path, serde_json::to_vec(entry)) { let _ = fsio::write_atomic(path, &bytes); }
}

async fn fetch_body(appid: u32) -> Result<String, FetchError> {
    static CLIENT: http::SharedClient = http::SharedClient::new();
    let client = CLIENT.get(|| http::builder().user_agent(USER_AGENT)
        // appdetails is a single fixed endpoint; a redirect to anywhere else is not a valid answer.
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(8)).timeout(Duration::from_secs(20)).build(), "Unable to prepare the Steam request")
        .map_err(FetchError::Other)?;
    let url = format!("https://store.steampowered.com/api/appdetails?appids={appid}&l=english");
    let mut response = client.get(url).send().await.map_err(|error| {
        if error.is_connect() || error.is_timeout() { FetchError::Offline("Steam could not be reached.".into()) } else { FetchError::Other(format!("Steam request failed: {error}")) }
    })?;
    if response.status().as_u16() == 429 { return Err(FetchError::Other("Steam is rate limiting requests (HTTP 429). Try again later.".into())); }
    if !response.status().is_success() { return Err(FetchError::Other(format!("Steam returned HTTP {}.", response.status()))); }
    let body = http::read_capped(&mut response, MAX_BYTES).await.map_err(|error| match error {
        http::BodyError::TooLarge => FetchError::Other("Steam response is too large.".into()),
        http::BodyError::Network(error) => FetchError::Offline(format!("Steam connection dropped: {error}")),
    })?;
    String::from_utf8(body).map_err(|_| FetchError::Other("Steam returned non-text data.".into()))
}

fn result(status: &'static str, details: Option<SteamStoreDetails>, stale: bool, fetched_at: Option<u64>, message: Option<String>) -> SteamStoreResult {
    SteamStoreResult { status, details, stale, fetched_at, message }
}

/// Never rejects: offline and upstream problems come back as `status`/`message` so the UI can show them calmly.
#[tauri::command]
pub async fn get_steam_store_details(app: AppHandle, appid: u32) -> SteamStoreResult {
    if appid == 0 { return result("error", None, false, None, Some("Invalid Steam app id.".into())); }
    // The cache lives on disk: read it off the async workers.
    let (path, cached) = crate::util::blocking(move || { let path = cache_file(&app, appid); let cached = read_cache(&path); (path, cached) }).await.unwrap_or_default();
    let now = now_secs();
    if let Some(entry) = &cached {
        let age = now.saturating_sub(entry.fetched_at);
        match &entry.details {
            Some(details) if age < TTL_SECS => return result("ok", Some(details.clone()), false, Some(entry.fetched_at), None),
            None if age < NOT_FOUND_TTL_SECS => return result("not-found", None, false, Some(entry.fetched_at), None),
            _ => {}
        }
    }
    let fetched = fetch_body(appid).await.and_then(|body| parse_app_details(appid, &body).map_err(FetchError::Other));
    match fetched {
        Ok(details) => {
            let entry = CacheEntry { fetched_at: now, details: details.clone() };
            // The caller does not wait for the cache write.
            tauri::async_runtime::spawn_blocking(move || write_cache(&path, &entry));
            match details {
                Some(details) => result("ok", Some(details), false, Some(now), None),
                None => result("not-found", None, false, Some(now), None),
            }
        }
        Err(error) => {
            let (status, message) = match error { FetchError::Offline(m) => ("offline", m), FetchError::Other(m) => ("error", m) };
            match cached.and_then(|entry| entry.details.map(|d| (d, entry.fetched_at))) {
                Some((details, at)) => result("ok", Some(details), true, Some(at), Some(message)),
                None => result(status, None, false, None, Some(message)),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const FIXTURE: &str = include_str!("../fixtures/steam_appdetails_220.json");

    #[test]
    fn parses_recorded_response() {
        let details = parse_app_details(220, FIXTURE).unwrap().unwrap();
        assert_eq!(details.name, "Half-Life 2");
        assert_eq!(details.genres, vec!["Action"]);
        assert_eq!(details.developers, vec!["Valve"]);
        assert!(details.description.starts_with("Reawakened from stasis"));
        assert!(!details.screenshots.is_empty() && details.screenshots.iter().all(|u| u.starts_with("https://") && !u.contains('?')));
        assert_eq!(details.release_date, Some(1_100_563_200));
        assert_eq!(details.cover_url, format!("{CDN}/220/library_600x900.jpg"));
        assert!(details.movies.iter().all(|m| m.thumbnail.as_deref().is_none_or(|t| !t.contains('?'))));
    }

    #[test]
    fn unknown_app_is_none_and_garbage_is_error() {
        assert_eq!(parse_app_details(1, r#"{"1":{"success":false}}"#).unwrap(), None);
        assert!(parse_app_details(1, "<html>").is_err());
        assert!(parse_app_details(2, r#"{"1":{"success":false}}"#).is_err());
    }

    #[test]
    fn release_dates() {
        assert_eq!(parse_release_date("16 Nov, 2004"), Some(1_100_563_200));
        assert_eq!(parse_release_date("Nov 16, 2004"), Some(1_100_563_200));
        assert_eq!(parse_release_date("Nov 2004"), Some(1_099_267_200));
        assert_eq!(parse_release_date("1970"), Some(0));
        assert_eq!(parse_release_date("Coming soon"), None);
        assert_eq!(parse_release_date("To be announced"), None);
    }

    #[test]
    fn insecure_media_urls_are_dropped() {
        let body = r#"{"9":{"success":true,"data":{"name":"X","movies":[{"name":"t","thumbnail":"http://evil/a.jpg?t=1","hls_h264":"javascript:alert(1)"},{"name":"u","thumbnail":"https://ok/a.jpg?t=1","hls_h264":"https://ok/a.m3u8"}],"screenshots":[{"path_full":"http://x/a.jpg"}]}}}"#;
        let details = parse_app_details(9, body).unwrap().unwrap();
        assert_eq!(details.movies[0].thumbnail, None);
        assert_eq!(details.movies[0].hls_url, None);
        assert_eq!(details.movies[1].thumbnail.as_deref(), Some("https://ok/a.jpg"));
        assert!(details.screenshots.is_empty());
    }

    #[test]
    fn parser_survives_hostile_shapes() {
        for body in ["null", "[]", r#"{"1":null}"#, r#"{"1":{"success":true}}"#, r#"{"1":{"success":true,"data":[]}}"#,
            r#"{"1":{"success":true,"data":{"name":"A","genres":"x","movies":5,"screenshots":[1,null],"release_date":{"date":5}}}}"#] {
            let _ = parse_app_details(1, body);
        }
        assert!(parse_app_details(1, r#"{"1":{"success":true,"data":{"name":"A","genres":"x","movies":5}}}"#).unwrap().is_some());
    }

    #[test]
    fn release_dates_never_panic_on_odd_text() {
        for text in ["", ",", "  ", "é é", "99999999999999999999", "Nov 99999999999999999999", "-5", "Q4 2025", "0000", "Jan 2004 2005", "31 Feb, 2004", "\u{1F600} 2020"] {
            let _ = parse_release_date(text);
        }
    }

    #[test]
    fn decodes_numeric_entities() {
        assert_eq!(decode_entities("Don&#39;t &#x27;stop&#x27; &#8217; &#xZZ; &#; &# &#99999999999; &amp;lt;"), "Don't 'stop' \u{2019} &#xZZ; &#; &# &#99999999999; &lt;");
        assert_eq!(decode_entities("é&#233;"), "éé");
    }

    #[test]
    fn decodes_entities() {
        assert_eq!(decode_entities("Tom &amp; Jerry &quot;live&quot;"), "Tom & Jerry \"live\"");
    }
}
