//! Keyless ProtonDB summary (`reports/summaries/<appid>.json`) for the Linux compatibility badge.
//! Nothing is stored here: the frontend keeps the answer for the session, and the command never rejects.
use crate::util::http;
use serde::Serialize;
use serde_json::Value;
use std::time::Duration;

const MAX_BYTES: usize = 64 * 1024;
const TIERS: [&str; 6] = ["native", "platinum", "gold", "silver", "bronze", "borked"];
const USER_AGENT: &str = concat!("Mochi/", env!("CARGO_PKG_VERSION"), " (game launcher)");

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProtonDbSummary {
    pub tier: String,
    pub trending_tier: Option<String>,
    pub total: u32,
    pub confidence: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ProtonDbResult {
    /// "ok", "not-found", "offline" or "error".
    pub status: &'static str,
    pub summary: Option<ProtonDbSummary>,
    pub message: Option<String>,
}

fn known_tier(value: Option<&Value>) -> Option<String> {
    let tier = value?.as_str()?.to_ascii_lowercase();
    TIERS.contains(&tier.as_str()).then_some(tier)
}

/// Parses a summary body. Unknown tiers (for example `pending`) mean there is nothing to show.
pub fn parse_summary(body: &str) -> Result<Option<ProtonDbSummary>, String> {
    let root: Value = serde_json::from_str(body).map_err(|error| format!("ProtonDB returned unreadable data: {error}"))?;
    let Some(tier) = known_tier(root.get("tier")) else { return Ok(None) };
    Ok(Some(ProtonDbSummary {
        tier,
        trending_tier: known_tier(root.get("trendingTier")),
        total: root.get("total").and_then(Value::as_u64).map_or(0, |n| n.min(u32::MAX as u64) as u32),
        confidence: root.get("confidence").and_then(Value::as_str).map(|c| c.chars().take(16).collect()),
    }))
}

async fn fetch(appid: u32) -> Result<Option<String>, (bool, String)> {
    static CLIENT: http::SharedClient = http::SharedClient::new();
    let client = CLIENT.get(|| http::builder().user_agent(USER_AGENT)
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(8)).timeout(Duration::from_secs(15)).build(), "Unable to prepare the ProtonDB request")
        .map_err(|m| (false, m))?;
    let url = format!("https://www.protondb.com/api/v1/reports/summaries/{appid}.json");
    let mut response = client.get(url).send().await.map_err(|error| {
        if error.is_connect() || error.is_timeout() { (true, "ProtonDB could not be reached.".to_string()) } else { (false, format!("ProtonDB request failed: {error}")) }
    })?;
    if response.status().as_u16() == 404 { return Ok(None); }
    if !response.status().is_success() { return Err((false, format!("ProtonDB returned HTTP {}.", response.status()))); }
    let body = http::read_capped(&mut response, MAX_BYTES).await.map_err(|error| match error {
        http::BodyError::TooLarge => (false, "ProtonDB response is too large.".to_string()),
        http::BodyError::Network(error) => (true, format!("ProtonDB connection dropped: {error}")),
    })?;
    String::from_utf8(body).map(Some).map_err(|_| (false, "ProtonDB returned non-text data.".to_string()))
}

/// Compatibility summary for a Steam app. Never rejects; problems come back as `status`/`message`.
#[tauri::command]
pub async fn get_protondb_summary(appid: u32) -> ProtonDbResult {
    let done = |status, summary, message| ProtonDbResult { status, summary, message };
    if appid == 0 { return done("error", None, Some("Invalid Steam app id.".into())); }
    match fetch(appid).await {
        Ok(None) => done("not-found", None, None),
        Ok(Some(body)) => match parse_summary(&body) {
            Ok(Some(summary)) => done("ok", Some(summary), None),
            Ok(None) => done("not-found", None, None),
            Err(message) => done("error", None, Some(message)),
        },
        Err((offline, message)) => done(if offline { "offline" } else { "error" }, None, Some(message)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_summary() {
        let body = r#"{"bestReportedTier":"platinum","confidence":"strong","score":0.7,"tier":"Gold","total":812,"trendingTier":"platinum"}"#;
        let summary = parse_summary(body).unwrap().unwrap();
        assert_eq!((summary.tier.as_str(), summary.trending_tier.as_deref(), summary.total, summary.confidence.as_deref()), ("gold", Some("platinum"), 812, Some("strong")));
    }

    #[test]
    fn unknown_tiers_and_bad_data() {
        assert_eq!(parse_summary(r#"{"tier":"pending","total":1}"#).unwrap(), None);
        assert!(parse_summary("<html>").is_err());
        let odd = parse_summary(r#"{"tier":"silver","trendingTier":"weird","total":-5}"#).unwrap().unwrap();
        assert_eq!((odd.trending_tier, odd.total), (None, 0));
    }
}
