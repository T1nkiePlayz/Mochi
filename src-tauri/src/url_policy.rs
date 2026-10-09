//! Which external links Mochi will hand to the system browser.
//!
//! Links come from content we do not control (mod descriptions, metadata), so the backend decides:
//! only `https`/`http`, no embedded credentials, a real host, and no custom schemes such as
//! `mochi://` (which would let page content trigger sign-in callbacks) or `file://`.
//! Hosts on the trusted list open straight away; any other host needs the user's confirmation.

use url::Url;

/// Sites Mochi itself links to or that host the content it shows. Subdomains are included.
const TRUSTED_HOSTS: &[&str] = &[
    "github.com", "githubusercontent.com", "modrinth.com", "curseforge.com", "nexusmods.com",
    "steampowered.com", "steamcommunity.com", "youtube.com", "youtu.be", "youtube-nocookie.com",
    "igdb.com", "steamgriddb.com", "supabase.co", "discord.gg", "discord.com", "ko-fi.com", "patreon.com",
    "twitter.com", "x.com", "reddit.com", "wikipedia.org", "gitlab.com", "itch.io", "ashtontink.com", "mochi.ashtontink.com",
];

#[derive(Debug, PartialEq, Eq)]
pub enum UrlDecision {
    /// Open without asking.
    Open(String),
    /// Ask the user first; carries the normalised URL and the host to show.
    Confirm { url: String, host: String },
}

fn is_trusted(host: &str) -> bool {
    TRUSTED_HOSTS.iter().any(|trusted| host == *trusted || host.strip_suffix(trusted).is_some_and(|rest| rest.ends_with('.')))
}

pub fn evaluate(raw: &str) -> Result<UrlDecision, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.len() > 2048 || trimmed.chars().any(|c| c.is_control()) {
        return Err("That link is not valid.".into());
    }
    let parsed = Url::parse(trimmed).map_err(|_| "That link is not valid.".to_string())?;
    if !matches!(parsed.scheme(), "https" | "http") { return Err("Only web links can be opened.".into()); }
    if !parsed.username().is_empty() || parsed.password().is_some() { return Err("Links with embedded credentials are blocked.".into()); }
    let host = parsed.host_str().ok_or("That link has no website address.")?.trim_end_matches('.').to_ascii_lowercase();
    if host.is_empty() { return Err("That link has no website address.".into()); }
    let url = parsed.to_string();
    // Plain http is never trusted, even for a trusted host.
    if parsed.scheme() == "https" && is_trusted(&host) { Ok(UrlDecision::Open(url)) } else { Ok(UrlDecision::Confirm { url, host }) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trusted_https_opens() {
        assert!(matches!(evaluate("https://modrinth.com/mod/sodium"), Ok(UrlDecision::Open(_))));
        assert!(matches!(evaluate("https://www.curseforge.com/minecraft"), Ok(UrlDecision::Open(_))));
        assert!(matches!(evaluate("https://t1nkieplayz.github.io/Mochi-Website/#/signin"), Ok(UrlDecision::Confirm { .. })));
        assert!(matches!(evaluate("https://example.github.io/"), Ok(UrlDecision::Confirm { .. })));
        assert!(matches!(evaluate("https://github.io/"), Ok(UrlDecision::Confirm { .. })));
    }

    #[test]
    fn website_dashboard_opens_without_asking() {
        assert!(matches!(evaluate("https://mochi.ashtontink.com/#/dashboard"), Ok(UrlDecision::Open(_))));
        assert!(matches!(evaluate("https://mochi.ashtontink.com/#/signin?app=mochi"), Ok(UrlDecision::Open(_))));
        assert!(matches!(evaluate("https://ashtontink.com/"), Ok(UrlDecision::Open(_))));
        assert!(!matches!(evaluate("https://evilashtontink.com/"), Ok(UrlDecision::Open(_))));
    }

    #[test]
    fn lookalike_hosts_are_not_trusted() {
        for url in ["https://evilmodrinth.com/", "https://modrinth.com.evil.io/", "https://github.com@evil.io/", "https://notgithub.com/"] {
            assert!(!matches!(evaluate(url), Ok(UrlDecision::Open(_))), "{url}");
        }
    }

    #[test]
    fn unknown_hosts_and_plain_http_need_confirmation() {
        assert!(matches!(evaluate("https://example.org/page"), Ok(UrlDecision::Confirm { .. })));
        assert!(matches!(evaluate("http://modrinth.com/"), Ok(UrlDecision::Confirm { .. })));
    }

    #[test]
    fn dangerous_or_malformed_links_are_rejected() {
        for url in ["mochi://auth/callback#access_token=x", "file:///etc/passwd", "javascript:alert(1)", "ftp://x.org/", "https://", "", "   ", "https://a.org/\nb", "https://user:pw@example.org/", "data:text/html,hi", "steam://run/1"] {
            assert!(evaluate(url).is_err(), "{url}");
        }
        assert!(evaluate(&format!("https://example.org/{}", "a".repeat(3000))).is_err());
    }
}
