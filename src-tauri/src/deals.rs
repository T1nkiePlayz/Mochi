//! Free-game and sale lookups for the experimental "Deal alerts" feature. Keyless and metadata-only:
//! Epic's public free-games promotions feed and the CheapShark API (https://apidocs.cheapshark.com).
//! Requests are throttled (at least one second apart, one at a time), answers are cached in memory for an
//! hour and nothing is written to disk. See docs/deals.md for sources and terms.
use crate::util::http;
use serde::Serialize;
use serde_json::Value;
use std::{collections::HashMap, sync::{Mutex, OnceLock}, time::{Duration, Instant}};

const USER_AGENT: &str = concat!("Mochi/", env!("CARGO_PKG_VERSION"), " (game launcher; https://github.com/T1nkiePlayz/Mochi)");
const CACHE_TTL: Duration = Duration::from_secs(60 * 60);
const MIN_GAP: Duration = Duration::from_millis(1100);
const RATE_LIMIT_BACKOFF: Duration = Duration::from_secs(15 * 60);
const MAX_BYTES: usize = 2 * 1024 * 1024;
const CACHE_LIMIT: usize = 64;
const EPIC_URL: &str = "https://store-site-backend-static-ipv4.ak.epicgames.com/freeGamesPromotions";
const SHARK_API: &str = "https://www.cheapshark.com/api/1.0";
/// CheapShark's own redirect: every deal link goes through it, as its terms ask.
const SHARK_REDIRECT: &str = "https://www.cheapshark.com/redirect?dealID=";

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EpicFreeGame {
    pub id: String,
    pub title: String,
    pub url: String,
    /// "free-now" or "upcoming".
    pub state: &'static str,
    /// ISO-8601 timestamps of the free window.
    pub start: Option<String>,
    pub end: Option<String>,
    /// Regular price as the store formats it ("$19.99").
    pub original_price: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Deal {
    pub deal_id: String,
    pub store_id: String,
    pub game_id: String,
    pub title: String,
    pub sale_price: f64,
    pub normal_price: f64,
    pub savings: f64,
    pub steam_app_id: Option<String>,
    pub link: String,
    pub last_change: i64,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StoreDeal {
    pub store_id: String,
    pub price: f64,
    pub retail_price: f64,
    pub savings: f64,
    pub link: String,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PriceInfo {
    pub game_id: String,
    pub title: String,
    pub steam_app_id: Option<String>,
    pub cheapest_now: Option<f64>,
    pub cheapest_ever: Option<f64>,
    /// Unix seconds.
    pub cheapest_ever_date: Option<i64>,
    pub deals: Vec<StoreDeal>,
}

/// Never rejects: `status` is "ok", "offline" or "error".
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DealsResult<T> {
    pub status: &'static str,
    pub data: Option<T>,
    pub message: Option<String>,
}

fn text(value: Option<&Value>) -> String { value.and_then(Value::as_str).unwrap_or("").trim().to_string() }

/// CheapShark sends numbers as strings ("22.26").
fn number(value: Option<&Value>) -> Option<f64> {
    match value? { Value::String(s) => s.parse().ok(), Value::Number(n) => n.as_f64(), _ => None }.filter(|n: &f64| n.is_finite())
}

fn deal_link(deal_id: &str) -> String { format!("{SHARK_REDIRECT}{deal_id}") }

/// Deal ids are opaque, already URL-encoded tokens; anything else is dropped rather than put in a link.
fn valid_deal_id(id: &str) -> bool { !id.is_empty() && id.len() < 200 && id.chars().all(|c| c.is_ascii_alphanumeric() || "%-_.~".contains(c)) }

pub fn parse_epic_free_games(body: &str) -> Result<Vec<EpicFreeGame>, String> {
    let root: Value = serde_json::from_str(body).map_err(|error| format!("Epic returned unreadable data: {error}"))?;
    let elements = root.pointer("/data/Catalog/searchStore/elements").and_then(Value::as_array).ok_or("Epic response had no games.")?;
    let mut out = Vec::new();
    for element in elements {
        let title = text(element.get("title"));
        let id = text(element.get("id"));
        if title.is_empty() || id.is_empty() { continue; }
        let Some(promotions) = element.get("promotions").filter(|p| p.is_object()) else { continue };
        // Only a 100% discount is a free game; other promotions are ordinary sales.
        let window = |key: &str, state: &'static str| -> Option<(&'static str, String, String)> {
            promotions.get(key)?.as_array()?.iter().flat_map(|group| group.get("promotionalOffers").and_then(Value::as_array).into_iter().flatten())
                .find(|offer| offer.pointer("/discountSetting/discountPercentage").and_then(Value::as_i64) == Some(0))
                .map(|offer| (state, text(offer.get("startDate")), text(offer.get("endDate"))))
        };
        let Some((state, start, end)) = window("promotionalOffers", "free-now").or_else(|| window("upcomingPromotionalOffers", "upcoming")) else { continue };
        let slug = element.get("offerMappings").and_then(Value::as_array).and_then(|m| m.iter().find_map(|m| m.get("pageSlug").and_then(Value::as_str)))
            .or_else(|| element.get("productSlug").and_then(Value::as_str)).or_else(|| element.get("urlSlug").and_then(Value::as_str)).unwrap_or("");
        let slug = slug.trim_matches('/');
        if slug.is_empty() || !slug.chars().all(|c| c.is_ascii_alphanumeric() || "-_/".contains(c)) { continue; }
        let slug = slug.strip_suffix("/home").unwrap_or(slug);
        out.push(EpicFreeGame {
            id, title, url: format!("https://store.epicgames.com/en-US/p/{slug}"), state,
            start: Some(start).filter(|s| !s.is_empty()), end: Some(end).filter(|s| !s.is_empty()),
            original_price: Some(text(element.pointer("/price/totalPrice/fmtPrice/originalPrice"))).filter(|s| !s.is_empty()),
        });
    }
    Ok(out)
}

pub fn parse_deals(body: &str) -> Result<Vec<Deal>, String> {
    let root: Value = serde_json::from_str(body).map_err(|error| format!("CheapShark returned unreadable data: {error}"))?;
    let list = root.as_array().ok_or("CheapShark response was not a list.")?;
    Ok(list.iter().filter_map(|item| {
        let deal_id = text(item.get("dealID"));
        let title = text(item.get("title"));
        if title.is_empty() || !valid_deal_id(&deal_id) { return None; }
        Some(Deal {
            link: deal_link(&deal_id), deal_id, store_id: text(item.get("storeID")), game_id: text(item.get("gameID")), title,
            sale_price: number(item.get("salePrice"))?, normal_price: number(item.get("normalPrice"))?, savings: number(item.get("savings")).unwrap_or(0.0),
            steam_app_id: Some(text(item.get("steamAppID"))).filter(|s| !s.is_empty() && s != "0"),
            last_change: item.get("lastChange").and_then(Value::as_i64).unwrap_or(0),
        })
    }).collect())
}

/// A `/games?title=` or `/games?steamAppID=` answer: the best match's game id (an exact title wins over the first hit).
pub fn parse_game_match(body: &str, title: Option<&str>) -> Result<Option<String>, String> {
    let root: Value = serde_json::from_str(body).map_err(|error| format!("CheapShark returned unreadable data: {error}"))?;
    let list = root.as_array().ok_or("CheapShark response was not a list.")?;
    let wanted = title.map(|t| t.trim().to_lowercase());
    let pick = wanted.as_ref().and_then(|w| list.iter().find(|g| text(g.get("external")).to_lowercase() == *w)).or_else(|| list.first());
    Ok(pick.map(|g| text(g.get("gameID"))).filter(|id| !id.is_empty() && id.chars().all(|c| c.is_ascii_digit())))
}

/// A `/games?id=` answer.
pub fn parse_price_info(game_id: &str, body: &str) -> Result<Option<PriceInfo>, String> {
    let root: Value = serde_json::from_str(body).map_err(|error| format!("CheapShark returned unreadable data: {error}"))?;
    let Some(info) = root.get("info").filter(|i| i.is_object()) else { return Ok(None) };
    let deals: Vec<StoreDeal> = root.get("deals").and_then(Value::as_array).map(|list| list.iter().filter_map(|d| {
        let id = text(d.get("dealID"));
        if !valid_deal_id(&id) { return None; }
        Some(StoreDeal { store_id: text(d.get("storeID")), price: number(d.get("price"))?, retail_price: number(d.get("retailPrice")).unwrap_or(0.0), savings: number(d.get("savings")).unwrap_or(0.0), link: deal_link(&id) })
    }).collect()).unwrap_or_default();
    let ever = root.get("cheapestPriceEver");
    Ok(Some(PriceInfo {
        game_id: game_id.to_string(), title: text(info.get("title")),
        steam_app_id: Some(text(info.get("steamAppID"))).filter(|s| !s.is_empty()),
        cheapest_now: deals.iter().map(|d| d.price).reduce(f64::min),
        cheapest_ever: number(ever.and_then(|e| e.get("price"))),
        cheapest_ever_date: ever.and_then(|e| e.get("date")).and_then(Value::as_i64),
        deals,
    }))
}

enum FetchError { Offline(String), Other(String) }

struct Gate { next_at: Option<Instant>, blocked_until: Option<Instant> }

fn gate() -> &'static tokio::sync::Mutex<Gate> {
    static GATE: OnceLock<tokio::sync::Mutex<Gate>> = OnceLock::new();
    GATE.get_or_init(|| tokio::sync::Mutex::new(Gate { next_at: None, blocked_until: None }))
}

fn cache() -> &'static Mutex<HashMap<String, (Instant, String)>> {
    static CACHE: OnceLock<Mutex<HashMap<String, (Instant, String)>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn cache_get(url: &str) -> Option<String> {
    let map = cache().lock().ok()?;
    map.get(url).filter(|(at, _)| at.elapsed() < CACHE_TTL).map(|(_, body)| body.clone())
}

fn cache_put(url: &str, body: &str) {
    let Ok(mut map) = cache().lock() else { return };
    map.retain(|_, (at, _)| at.elapsed() < CACHE_TTL);
    if map.len() >= CACHE_LIMIT { if let Some(oldest) = map.iter().min_by_key(|(_, (at, _))| *at).map(|(key, _)| key.clone()) { map.remove(&oldest); } }
    map.insert(url.to_string(), (Instant::now(), body.to_string()));
}

/// One request at a time, at least `MIN_GAP` apart; a 429 pauses every request for a while.
async fn fetch(url: &str) -> Result<String, FetchError> {
    if let Some(body) = cache_get(url) { return Ok(body); }
    static CLIENT: http::SharedClient = http::SharedClient::new();
    let client = CLIENT.get(|| http::builder().user_agent(USER_AGENT).redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(8)).timeout(Duration::from_secs(20)).build(), "Unable to prepare the deals request").map_err(FetchError::Other)?;
    let mut guard = gate().lock().await;
    // Another caller may have filled the cache while this one waited for its turn.
    if let Some(body) = cache_get(url) { return Ok(body); }
    if guard.blocked_until.is_some_and(|until| until > Instant::now()) { return Err(FetchError::Other("The deals service asked Mochi to slow down. Try again later.".into())); }
    if let Some(next) = guard.next_at { tokio::time::sleep_until(tokio::time::Instant::from_std(next)).await; }
    let sent = client.get(url).send().await;
    guard.next_at = Some(Instant::now() + MIN_GAP);
    let mut response = sent.map_err(|error| if error.is_connect() || error.is_timeout() { FetchError::Offline("The deals service could not be reached.".into()) } else { FetchError::Other(format!("Deals request failed: {error}")) })?;
    if response.status().as_u16() == 429 { guard.blocked_until = Some(Instant::now() + RATE_LIMIT_BACKOFF); return Err(FetchError::Other("The deals service is rate limiting requests (HTTP 429). Try again later.".into())); }
    if !response.status().is_success() { return Err(FetchError::Other(format!("The deals service returned HTTP {}.", response.status()))); }
    let body = http::read_capped(&mut response, MAX_BYTES).await.map_err(|error| match error {
        http::BodyError::TooLarge => FetchError::Other("The deals response is too large.".into()),
        http::BodyError::Network(error) => FetchError::Offline(format!("Connection dropped: {error}")),
    })?;
    let body = String::from_utf8(body).map_err(|_| FetchError::Other("The deals service returned non-text data.".into()))?;
    cache_put(url, &body);
    Ok(body)
}

fn finish<T>(result: Result<Option<T>, FetchError>) -> DealsResult<T> {
    match result {
        Ok(data) => DealsResult { status: "ok", data, message: None },
        Err(FetchError::Offline(message)) => DealsResult { status: "offline", data: None, message: Some(message) },
        Err(FetchError::Other(message)) => DealsResult { status: "error", data: None, message: Some(message) },
    }
}

/// Games currently (or soon) free on the Epic Games Store.
#[tauri::command]
pub async fn get_epic_free_games() -> DealsResult<Vec<EpicFreeGame>> {
    let url = format!("{EPIC_URL}?locale=en-US&country=US");
    finish(async { parse_epic_free_games(&fetch(&url).await?).map(Some).map_err(FetchError::Other) }.await)
}

/// Current CheapShark sales for the given store ids (numeric strings such as "1" for Steam).
#[tauri::command]
pub async fn get_cheapshark_deals(store_ids: Vec<String>) -> DealsResult<Vec<Deal>> {
    let mut ids: Vec<String> = store_ids.into_iter().filter(|id| !id.is_empty() && id.len() <= 3 && id.chars().all(|c| c.is_ascii_digit())).collect();
    ids.sort();
    ids.dedup();
    if ids.is_empty() { return DealsResult { status: "ok", data: Some(Vec::new()), message: None }; }
    let url = format!("{SHARK_API}/deals?storeID={}&onSale=1&pageSize=40&sortBy=Deal%20Rating", ids.join(","));
    finish(async { parse_deals(&fetch(&url).await?).map(Some).map_err(FetchError::Other) }.await)
}

/// Prices of one game: by Steam app id when known, otherwise by title. `Ok(None)` data means no match.
#[tauri::command]
pub async fn get_price_info(title: Option<String>, steam_app_id: Option<u32>) -> DealsResult<PriceInfo> {
    let title = title.map(|t| t.trim().chars().take(100).collect::<String>()).filter(|t| !t.is_empty());
    let lookup = match (steam_app_id.filter(|id| *id > 0), &title) {
        (Some(id), _) => format!("{SHARK_API}/games?steamAppID={id}"),
        (None, Some(title)) => match reqwest::Url::parse_with_params(&format!("{SHARK_API}/games"), &[("title", title.as_str()), ("limit", "5")]) { Ok(url) => url.to_string(), Err(_) => return DealsResult { status: "error", data: None, message: Some("Invalid title.".into()) } },
        (None, None) => return DealsResult { status: "error", data: None, message: Some("A title or Steam app id is needed.".into()) },
    };
    finish(async {
        let Some(game_id) = parse_game_match(&fetch(&lookup).await?, title.as_deref()).map_err(FetchError::Other)? else { return Ok(None) };
        let body = fetch(&format!("{SHARK_API}/games?id={game_id}")).await?;
        parse_price_info(&game_id, &body).map_err(FetchError::Other)
    }.await)
}

#[cfg(test)]
mod tests {
    use super::*;

    const EPIC: &str = include_str!("deals_fixtures/epic.json");
    const DEALS: &str = include_str!("deals_fixtures/deals.json");
    const GAME: &str = include_str!("deals_fixtures/game.json");

    #[test]
    fn epic_keeps_only_free_windows() {
        let games = parse_epic_free_games(EPIC).unwrap();
        let ids: Vec<_> = games.iter().map(|g| (g.title.as_str(), g.state)).collect();
        assert_eq!(ids, vec![("Free Now Game", "free-now"), ("Next Week Game", "upcoming")]);
        assert_eq!(games[0].url, "https://store.epicgames.com/en-US/p/free-now-game");
        assert_eq!(games[0].end.as_deref(), Some("2026-10-16T15:00:00.000Z"));
        assert_eq!(games[0].original_price.as_deref(), Some("$19.99"));
    }

    #[test]
    fn epic_rejects_garbage() {
        assert!(parse_epic_free_games("not json").is_err());
        assert!(parse_epic_free_games("{}").is_err());
    }

    #[test]
    fn deals_parse_string_numbers_and_route_links_through_cheapshark() {
        let deals = parse_deals(DEALS).unwrap();
        assert_eq!(deals.len(), 1, "the entry with a bad price is skipped, an unsafe deal id is dropped");
        assert_eq!(deals[0].title, "Silver Pines");
        assert_eq!(deals[0].sale_price, 22.26);
        assert_eq!(deals[0].steam_app_id.as_deref(), Some("2333000"));
        assert!(deals[0].link.starts_with("https://www.cheapshark.com/redirect?dealID=HNPl2c6%2BV040"));
    }

    #[test]
    fn game_match_prefers_exact_title() {
        let body = r#"[{"gameID":"2","external":"Hades II"},{"gameID":"1","external":"Hades"}]"#;
        assert_eq!(parse_game_match(body, Some("hades")).unwrap().as_deref(), Some("1"));
        assert_eq!(parse_game_match(body, Some("zzz")).unwrap().as_deref(), Some("2"));
        assert_eq!(parse_game_match("[]", None).unwrap(), None);
    }

    #[test]
    fn price_info_has_cheapest_now_and_ever() {
        let info = parse_price_info("612", GAME).unwrap().unwrap();
        assert_eq!(info.title, "LEGO Batman");
        assert_eq!(info.cheapest_now, Some(15.89));
        assert_eq!(info.cheapest_ever, Some(2.28));
        assert_eq!(info.cheapest_ever_date, Some(1759177295));
        assert_eq!(info.deals.len(), 4);
        assert_eq!(info.steam_app_id, None);
        assert_eq!(parse_price_info("1", "{}").unwrap(), None);
    }

    #[test]
    fn cache_serves_fresh_bodies_and_stays_bounded() {
        for n in 0..(CACHE_LIMIT + 10) { cache_put(&format!("https://x.test/{n}"), "{}"); }
        assert!(cache().lock().unwrap().len() <= CACHE_LIMIT);
        assert_eq!(cache_get(&format!("https://x.test/{}", CACHE_LIMIT + 9)).as_deref(), Some("{}"));
    }
}
