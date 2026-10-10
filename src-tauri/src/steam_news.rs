//! Keyless Steam news (`ISteamNews/GetNewsForApp`) for the experimental "game-news" feed.
//! Nothing is cached here: the frontend keeps the few items it needs, and the command never rejects.
use crate::util::http;
use serde::Serialize;
use serde_json::Value;
use std::time::Duration;

const MAX_BYTES: usize = 1024 * 1024;
const MAX_ITEMS: usize = 5;
const MAX_TEXT_CHARS: usize = 300;
const USER_AGENT: &str = concat!("Mochi/", env!("CARGO_PKG_VERSION"), " (game launcher)");

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SteamNewsItem {
    pub gid: String,
    pub title: String,
    pub url: String,
    pub feed_label: String,
    /// Unix seconds (UTC).
    pub date: i64,
    /// Plain-text excerpt (markup and BBCode removed, at most 300 characters).
    pub summary: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SteamNewsResult {
    /// "ok", "offline" or "error".
    pub status: &'static str,
    pub items: Vec<SteamNewsItem>,
    pub message: Option<String>,
}

/// Removes `[tags]`, `<tags>` and Steam's `{STEAM_CLAN_IMAGE}/...` placeholders, collapses whitespace and truncates on a character boundary.
fn plain_summary(text: &str) -> String {
    let mut out = String::new();
    let mut depth = 0u32;
    for c in text.chars() {
        match c {
            '[' | '<' => depth += 1,
            ']' | '>' => depth = depth.saturating_sub(1),
            _ if depth == 0 => out.push(c),
            _ => {}
        }
    }
    let decoded = crate::steam_store::decode_entities(&out);
    let words = decoded.split_whitespace().filter(|w| !w.starts_with("{STEAM_CLAN_IMAGE}") && !w.starts_with("http")).collect::<Vec<_>>().join(" ");
    if words.chars().count() <= MAX_TEXT_CHARS { return words; }
    let cut: String = words.chars().take(MAX_TEXT_CHARS).collect();
    format!("{}...", cut.trim_end())
}

/// Parses a `GetNewsForApp` body. Items without a gid, title or an https link are skipped.
pub fn parse_news(body: &str) -> Result<Vec<SteamNewsItem>, String> {
    let root: Value = serde_json::from_str(body).map_err(|error| format!("Steam returned unreadable data: {error}"))?;
    let items = root.get("appnews").and_then(|n| n.get("newsitems")).and_then(Value::as_array).ok_or("Steam response had no news.")?;
    Ok(items.iter().filter_map(|item| {
        let gid = item.get("gid").and_then(|v| v.as_str().map(str::to_string).or_else(|| v.as_u64().map(|n| n.to_string())))?;
        let title = item.get("title").and_then(Value::as_str)?.trim();
        let url = item.get("url").and_then(Value::as_str)?.trim();
        if gid.is_empty() || title.is_empty() || !url.starts_with("https://") { return None; }
        Some(SteamNewsItem {
            gid,
            title: crate::steam_store::decode_entities(title),
            url: url.to_string(),
            feed_label: item.get("feedlabel").and_then(Value::as_str).unwrap_or("").to_string(),
            date: item.get("date").and_then(Value::as_i64).unwrap_or(0),
            summary: plain_summary(item.get("contents").and_then(Value::as_str).unwrap_or("")),
        })
    }).take(MAX_ITEMS).collect())
}

async fn fetch(appid: u32, language: &str) -> Result<String, (bool, String)> {
    static CLIENT: http::SharedClient = http::SharedClient::new();
    let client = CLIENT.get(|| http::builder().user_agent(USER_AGENT)
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(8)).timeout(Duration::from_secs(20)).build(), "Unable to prepare the Steam request")
        .map_err(|m| (false, m))?;
    let language = language.as_deref().filter(|value| matches!(*value, "arabic" | "bulgarian" | "schinese" | "tchinese" | "czech" | "danish" | "dutch" | "english" | "finnish" | "french" | "german" | "greek" | "hungarian" | "indonesian" | "italian" | "japanese" | "koreana" | "norwegian" | "polish" | "portuguese" | "romanian" | "russian" | "spanish" | "swedish" | "thai" | "turkish" | "ukrainian" | "vietnamese")).unwrap_or("english");
    let url = format!("https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid={appid}&count=3&maxlength=300&language={language}&format=json");
    let mut response = client.get(url).send().await.map_err(|error| {
        if error.is_connect() || error.is_timeout() { (true, "Steam could not be reached.".to_string()) } else { (false, format!("Steam request failed: {error}")) }
    })?;
    if !response.status().is_success() { return Err((false, format!("Steam returned HTTP {}.", response.status()))); }
    let body = http::read_capped(&mut response, MAX_BYTES).await.map_err(|error| match error {
        http::BodyError::TooLarge => (false, "Steam response is too large.".to_string()),
        http::BodyError::Network(error) => (true, format!("Steam connection dropped: {error}")),
    })?;
    String::from_utf8(body).map_err(|_| (false, "Steam returned non-text data.".to_string()))
}

/// Latest news posts for a Steam app. Never rejects; problems come back as `status`/`message`.
#[tauri::command]
pub async fn get_steam_news(appid: u32, language: Option<String>) -> SteamNewsResult {
    if appid == 0 { return SteamNewsResult { status: "error", items: vec![], message: Some("Invalid Steam app id.".into()) }; }
    let language = language.as_deref().filter(|value| matches!(*value, "arabic" | "bulgarian" | "schinese" | "tchinese" | "czech" | "danish" | "dutch" | "english" | "finnish" | "french" | "german" | "greek" | "hungarian" | "indonesian" | "italian" | "japanese" | "koreana" | "norwegian" | "polish" | "portuguese" | "romanian" | "russian" | "spanish" | "swedish" | "thai" | "turkish" | "ukrainian" | "vietnamese")).unwrap_or("english");
    match fetch(appid, language).await.and_then(|body| parse_news(&body).map_err(|m| (false, m))) {
        Ok(items) => SteamNewsResult { status: "ok", items, message: None },
        Err((offline, message)) => SteamNewsResult { status: if offline { "offline" } else { "error" }, items: vec![], message: Some(message) },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_news_items() {
        let body = r#"{"appnews":{"appid":440,"newsitems":[
            {"gid":"123","title":"Update &amp; fixes","url":"https://steamstore-a.akamaihd.net/n/1","feedlabel":"Community Announcements","date":1700000000,"contents":"[h1]Hi[/h1] <b>Fixed</b> a crash.  {STEAM_CLAN_IMAGE}/x.png more &quot;text&quot;"},
            {"gid":"124","title":"Bad link","url":"http://insecure/","date":1},
            {"title":"No gid","url":"https://ok/"},
            {"gid":125,"title":"Numeric gid","url":"https://ok/2","date":5}]}}"#;
        let items = parse_news(body).unwrap();
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].gid, "123");
        assert_eq!(items[0].title, "Update & fixes");
        assert_eq!(items[0].date, 1_700_000_000);
        assert_eq!(items[0].summary, "Hi Fixed a crash. more \"text\"");
        assert_eq!(items[1].gid, "125");
    }

    #[test]
    fn summary_is_truncated_on_char_boundary() {
        let long = "é".repeat(1000);
        let summary = plain_summary(&long);
        assert!(summary.ends_with("...") && summary.chars().count() == MAX_TEXT_CHARS + 3);
    }

    #[test]
    fn caps_items_and_rejects_garbage() {
        let items = (0..9).map(|i| format!(r#"{{"gid":"{i}","title":"t","url":"https://x/"}}"#)).collect::<Vec<_>>().join(",");
        assert_eq!(parse_news(&format!(r#"{{"appnews":{{"newsitems":[{items}]}}}}"#)).unwrap().len(), MAX_ITEMS);
        for body in ["null", "[]", "<html>", r#"{"appnews":{}}"#, r#"{"appnews":{"newsitems":5}}"#] { assert!(parse_news(body).is_err(), "{body}"); }
    }
}
