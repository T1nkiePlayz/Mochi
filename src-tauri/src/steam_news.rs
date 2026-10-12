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

const SUPPORTED_LANGUAGES: &[&str] = &[
    "arabic", "brazilian", "bulgarian", "schinese", "tchinese", "czech", "danish", "dutch",
    "english", "finnish", "french", "german", "greek", "hungarian", "indonesian", "italian",
    "japanese", "koreana", "norwegian", "polish", "portuguese", "romanian", "russian",
    "spanish", "swedish", "thai", "turkish", "ukrainian", "vietnamese",
];

fn supported_language(language: Option<&str>) -> &str {
    language.filter(|value| SUPPORTED_LANGUAGES.contains(value)).unwrap_or("english")
}

/// Writing system inferred from a news item's text. Steam's `language` parameter is ignored by
/// the API, so this is the only way to keep clearly-unrelated posts (e.g. Russian ones) away from
/// a reader who asked for another language.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Script {
    Latin,
    Cyrillic,
    Greek,
    Arabic,
    Hebrew,
    Cjk,
    Thai,
    Devanagari,
}

/// Script of a single character, or `None` when it is not alphabetic (digits, punctuation, emoji).
/// Anything not covered by a dedicated range counts as Latin.
fn char_script(c: char) -> Option<Script> {
    if !c.is_alphabetic() { return None; }
    Some(match c as u32 {
        0x0400..=0x04FF => Script::Cyrillic,
        0x0370..=0x03FF | 0x1F00..=0x1FFF => Script::Greek,
        0x0600..=0x06FF | 0x0750..=0x077F | 0xFB50..=0xFDFF | 0xFE70..=0xFEFF => Script::Arabic,
        0x0590..=0x05FF => Script::Hebrew,
        0x3000..=0x30FF | 0x3400..=0x4DBF | 0x4E00..=0x9FFF | 0xAC00..=0xD7AF | 0xF900..=0xFAFF => Script::Cjk,
        0x0E00..=0x0E7F => Script::Thai,
        0x0900..=0x097F => Script::Devanagari,
        _ => Script::Latin,
    })
}

/// Dominant script of `text`: the script with the most alphabetic characters (exact ties are
/// broken deterministically but arbitrarily; real posts do not tie). `None` when the text has no
/// alphabetic characters at all — emoji/punctuation-only posts count as matching every language.
fn dominant_script(text: &str) -> Option<Script> {
    let mut counts: Vec<(Script, usize)> = Vec::new();
    for c in text.chars() {
        if let Some(script) = char_script(c) {
            match counts.iter_mut().find(|(s, _)| *s == script) {
                Some((_, count)) => *count += 1,
                None => counts.push((script, 1)),
            }
        }
    }
    counts.iter().max_by_key(|(_, count)| *count).map(|(script, _)| *script)
}

/// Script each supported Steam language is expected to be written in. Latin-script languages are
/// mutually indistinguishable without a real language detector, so a French post may still pass an
/// `english` filter — that is acceptable; the goal is only to stop clearly-unrelated scripts (the
/// Russian posts the live feed mixes in) reaching an English user. Hebrew and Devanagari are
/// classified but no supported language maps to them, so such posts are dropped everywhere.
fn expected_script(language: &str) -> Script {
    match language {
        "bulgarian" | "russian" | "ukrainian" => Script::Cyrillic,
        "greek" => Script::Greek,
        "arabic" => Script::Arabic,
        "schinese" | "tchinese" | "japanese" | "koreana" => Script::Cjk,
        "thai" => Script::Thai,
        _ => Script::Latin,
    }
}

/// Whether an item's title + summary is written in the script expected for `language`.
fn item_matches_language(item: &SteamNewsItem, language: &str) -> bool {
    match dominant_script(&format!("{} {}", item.title, item.summary)) {
        Some(script) => script == expected_script(language),
        None => true,
    }
}

/// Drops items whose dominant script does not match `language`, keeping the "never rejects"
/// contract of the command: an empty list is still a successful result.
fn filter_by_script(items: Vec<SteamNewsItem>, language: &str) -> Vec<SteamNewsItem> {
    items.into_iter().filter(|item| item_matches_language(item, language)).collect()
}

/// Latest news posts for a Steam app. Never rejects; problems come back as `status`/`message`.
#[tauri::command]
pub async fn get_steam_news(appid: u32, language: Option<String>) -> SteamNewsResult {
    if appid == 0 { return SteamNewsResult { status: "error", items: vec![], message: Some("Invalid Steam app id.".into()) }; }
    let language = supported_language(language.as_deref());
    match fetch(appid, language).await.and_then(|body| parse_news(&body).map_err(|m| (false, m))) {
        Ok(items) => SteamNewsResult { status: "ok", items: filter_by_script(items, language), message: None },
        Err((offline, message)) => SteamNewsResult { status: if offline { "offline" } else { "error" }, items: vec![], message: Some(message) },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_news_language_and_defaults_to_english() {
        assert_eq!(supported_language(Some("brazilian")), "brazilian");
        assert_eq!(supported_language(Some("french")), "french");
        assert_eq!(supported_language(Some("fr-FR")), "english");
        assert_eq!(supported_language(None), "english");
    }

    /// Minimal item for the script-filter tests: gid/url/feed are irrelevant to classification.
    fn news_item(title: &str, summary: &str) -> SteamNewsItem {
        SteamNewsItem { gid: "1".into(), title: title.into(), url: "https://x/".into(), feed_label: "feed".into(), date: 0, summary: summary.into() }
    }

    #[test]
    fn maps_supported_languages_to_expected_scripts() {
        for language in ["bulgarian", "russian", "ukrainian"] { assert_eq!(expected_script(language), Script::Cyrillic, "{language}"); }
        assert_eq!(expected_script("greek"), Script::Greek);
        assert_eq!(expected_script("arabic"), Script::Arabic);
        for language in ["schinese", "tchinese", "japanese", "koreana"] { assert_eq!(expected_script(language), Script::Cjk, "{language}"); }
        assert_eq!(expected_script("thai"), Script::Thai);
        for language in ["english", "brazilian", "portuguese", "french", "german", "spanish", "italian", "dutch", "polish", "turkish", "vietnamese", "indonesian"] {
            assert_eq!(expected_script(language), Script::Latin, "{language}");
        }
    }

    #[test]
    fn drops_russian_posts_for_english_and_keeps_them_for_russian() {
        let item = news_item("Большое обновление игры", "Fixed a crash");
        assert!(!item_matches_language(&item, "english"));
        assert!(item_matches_language(&item, "russian"));
        assert_eq!(filter_by_script(vec![item.clone()], "english").len(), 0);
        assert_eq!(filter_by_script(vec![item], "russian").len(), 1);
    }

    #[test]
    fn drops_english_posts_for_russian() {
        let item = news_item("Patch notes for the new update", "Исправления");
        assert!(!item_matches_language(&item, "russian"));
        assert!(item_matches_language(&item, "english"));
    }

    #[test]
    fn keeps_japanese_posts_for_cjk_languages() {
        let item = news_item("テスト更新", "パッチノート");
        assert!(item_matches_language(&item, "japanese"));
        assert!(item_matches_language(&item, "schinese"));
        assert!(item_matches_language(&item, "tchinese"));
        assert!(item_matches_language(&item, "koreana"));
        assert!(!item_matches_language(&item, "english"));
        assert!(!item_matches_language(&item, "russian"));
    }

    #[test]
    fn keeps_posts_without_alphabetic_text() {
        let item = news_item("🔥🚀", "🎉 ... !!!");
        for language in SUPPORTED_LANGUAGES {
            assert!(item_matches_language(&item, language), "{language}");
        }
    }

    #[test]
    fn classifies_mixed_script_posts_by_dominant_script() {
        let mostly_russian = news_item("Большое обновление игры", "Fixed a crash");
        assert_eq!(dominant_script(&format!("{} {}", mostly_russian.title, mostly_russian.summary)), Some(Script::Cyrillic));
        let mostly_english = news_item("Patch notes for the new update", "Исправления");
        assert_eq!(dominant_script(&format!("{} {}", mostly_english.title, mostly_english.summary)), Some(Script::Latin));
    }

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
