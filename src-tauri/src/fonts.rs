//! Offline cache for Google Fonts requested by user/imported themes.
//!
//! Built-in themes bundle their fonts (see scripts/fetch-fonts.mjs); this covers themes that still
//! declare `fonts` URLs. CSS and woff2 files are downloaded once into `<config>/fonts/<theme-id>/`
//! and later served from disk, so a theme never needs the network after its first load.
use base64::{engine::general_purpose::STANDARD, Engine as _};
use crate::util::{fsio::write_atomic, http, valid_id};
use std::{
    fs,
    path::{Path, PathBuf},
    time::Duration,
};
use tauri::AppHandle;

const MAX_URLS: usize = 6;
const MAX_CSS_BYTES: usize = 256 * 1024;
const MAX_FONT_BYTES: usize = 2 * 1024 * 1024;
const MAX_FONTS_PER_THEME: usize = 48;
/// Fonts are inlined as base64 data URLs, so the combined result is capped (the raw limits alone allow hundreds of MiB).
const MAX_OUTPUT_BYTES: usize = 12 * 1024 * 1024;
const USER_AGENT: &str = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

fn valid_theme_id(id: &str) -> bool { valid_id(id, 80) }

fn parsed_https(url: &str, host: &str) -> Option<reqwest::Url> {
    if url.len() > 2048 || url.chars().any(|c| c.is_control() || c.is_whitespace() || c == '\\') {
        return None;
    }
    let parsed = reqwest::Url::parse(url).ok()?;
    let ok = parsed.scheme() == "https"
        && parsed.host_str() == Some(host)
        && parsed.username().is_empty()
        && parsed.password().is_none()
        && parsed.port().is_none();
    ok.then_some(parsed)
}

/// Only Google Fonts CSS endpoints may be fetched as stylesheets.
pub fn allowed_css_url(url: &str) -> Option<reqwest::Url> {
    parsed_https(url, "fonts.googleapis.com").filter(|parsed| parsed.path().starts_with("/css"))
}

/// Only woff2 files from the Google Fonts static host may be fetched as fonts.
pub fn allowed_font_url(url: &str) -> Option<reqwest::Url> {
    parsed_https(url, "fonts.gstatic.com").filter(|parsed| parsed.path().ends_with(".woff2"))
}

/// Stable 64-bit FNV-1a hash (std's hasher is not guaranteed stable between releases).
fn fnv(value: &str) -> u64 {
    value.bytes().fold(0xcbf29ce484222325, |hash, byte| (hash ^ u64::from(byte)).wrapping_mul(0x100000001b3))
}

/// Cache file name for a font URL: hash prefix plus a sanitised copy of the last path segment.
pub fn font_file_name(url: &str) -> String {
    let segment = url.split(['?', '#']).next().unwrap_or("").rsplit('/').next().unwrap_or("");
    let stem: String = segment
        .trim_end_matches(".woff2")
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '_' })
        .take(40)
        .collect();
    format!("{:016x}-{}.woff2", fnv(url), stem)
}

fn safe_cache_name(name: &str) -> bool {
    name.len() <= 80
        && name.ends_with(".woff2")
        && !name.starts_with('.')
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
        && !name.contains("..")
}

/// Splits a Google Fonts stylesheet into `@font-face` bodies, dropping everything else (imports, stray rules).
/// Faces labelled with a non-latin subset comment are skipped to keep the cache small.
fn font_faces(css: &str) -> Vec<String> {
    let mut faces = Vec::new();
    let mut rest = css;
    while let Some(start) = rest.find("@font-face") {
        let before = &rest[..start];
        let label = before.rfind("/*").and_then(|open| {
            let tail = &before[open + 2..];
            tail.find("*/").map(|close| tail[..close].trim().to_string())
        });
        let after = &rest[start..];
        let Some(open) = after.find('{') else { break };
        let Some(close) = after[open..].find('}') else { break };
        let body = &after[open + 1..open + close];
        if label.as_deref().is_none_or(|name| name == "latin" || name == "latin-ext") {
            faces.push(body.trim().to_string());
        }
        rest = &after[open + close + 1..];
    }
    faces
}

fn src_url(face: &str) -> Option<(usize, usize, String)> {
    let start = face.find("url(")?;
    let end = start + face[start..].find(')')?;
    let url = face[start + 4..end].trim().trim_matches(['\'', '"']).to_string();
    Some((start, end + 1, url))
}

fn read_cache(dir: &Path, css_file: &Path) -> Option<String> {
    let css = fs::read_to_string(css_file).ok()?;
    let mut out = String::new();
    let mut rest = css.as_str();
    while let Some(start) = rest.find("url(") {
        let end = start + rest[start..].find(')')?;
        let name = rest[start + 4..end].trim();
        if !safe_cache_name(name) {
            return None;
        }
        let bytes = fs::read(dir.join(name)).ok()?;
        out.push_str(&rest[..start]);
        out.push_str(&format!("url(data:font/woff2;base64,{})", STANDARD.encode(bytes)));
        rest = &rest[end + 1..];
    }
    out.push_str(rest);
    Some(out)
}

async fn download(client: &reqwest::Client, url: reqwest::Url, max: usize) -> Option<Vec<u8>> {
    let mut response = client.get(url).send().await.ok()?;
    if !response.status().is_success() {
        return None;
    }
    let bytes = http::read_capped(&mut response, max).await.ok()?;
    (!bytes.is_empty()).then_some(bytes)
}

async fn fetch_stylesheet(client: &reqwest::Client, dir: &Path, css_url: reqwest::Url) -> Option<String> {
    let css = String::from_utf8(download(client, css_url, MAX_CSS_BYTES).await?).ok()?;
    let faces = font_faces(&css);
    if faces.is_empty() || faces.len() > MAX_FONTS_PER_THEME {
        return None;
    }
    let mut rewritten = String::new();
    for face in faces {
        // Exactly one url(): anything else could not be mapped back to cached files when the CSS is read again.
        if face.matches("url(").count() != 1 {
            return None;
        }
        let (start, end, url) = src_url(&face)?;
        let font_url = allowed_font_url(&url)?;
        let name = font_file_name(&url);
        let target = dir.join(&name);
        if !target.exists() {
            let bytes = download(client, font_url, MAX_FONT_BYTES).await?;
            let path = target.clone();
            crate::util::blocking(move || write_atomic(&path, &bytes)).await.ok()?.ok()?;
        }
        rewritten.push_str(&format!("@font-face {{ {}url({}){} }}\n", &face[..start], name, &face[end..]));
    }
    Some(rewritten)
}

fn theme_font_dir(app: &AppHandle, theme_id: &str) -> Result<PathBuf, String> {
    let dir = crate::themes::config_dir(app)?.join("fonts").join(theme_id);
    fs::create_dir_all(&dir).map_err(|error| format!("Unable to create the theme font cache: {error}"))?;
    Ok(dir)
}

async fn cached_css(dir: &Path, css_file: &Path) -> Option<String> {
    let (dir, css_file) = (dir.to_path_buf(), css_file.to_path_buf());
    crate::util::blocking(move || read_cache(&dir, &css_file)).await.ok().flatten()
}

/// Returns `@font-face` CSS (fonts inlined as data URLs) for the theme's Google Fonts URLs.
/// Offline and uncached URLs are skipped, so the result may be empty and the theme uses system fonts.
#[tauri::command]
pub async fn cache_theme_fonts(app: AppHandle, theme_id: String, urls: Vec<String>) -> Result<String, String> {
    if !valid_theme_id(&theme_id) {
        return Err("Invalid theme id.".into());
    }
    if urls.len() > MAX_URLS {
        return Err(format!("A theme may list at most {MAX_URLS} font stylesheets."));
    }
    let mut parsed = Vec::new();
    for url in &urls {
        parsed.push((url, allowed_css_url(url).ok_or("Theme fonts must be Google Fonts stylesheets (https://fonts.googleapis.com/css...).")?));
    }
    if parsed.is_empty() {
        return Ok(String::new());
    }
    let dir = theme_font_dir(&app, &theme_id)?;
    static CLIENT: http::SharedClient = http::SharedClient::new();
    let client = CLIENT.get(|| http::builder()
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(USER_AGENT)
        .build(), "Unable to prepare font request")?;

    let mut output = String::new();
    for (url, css_url) in parsed {
        let css_file = dir.join(format!("{:016x}.css", fnv(url)));
        if output.len() > MAX_OUTPUT_BYTES {
            break;
        }
        // Reading and base64-encoding cached fonts is disk and CPU work: keep it off the async workers.
        if let Some(cached) = cached_css(&dir, &css_file).await {
            output.push_str(&cached);
            continue;
        }
        if let Some(rewritten) = fetch_stylesheet(client, &dir, css_url).await {
            if write_atomic(&css_file, rewritten.as_bytes()).is_ok() {
                if let Some(cached) = cached_css(&dir, &css_file).await {
                    output.push_str(&cached);
                }
            }
        }
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn css_urls_are_allow_listed() {
        assert!(allowed_css_url("https://fonts.googleapis.com/css2?family=Fredoka:wght@400&display=swap").is_some());
        for bad in [
            "http://fonts.googleapis.com/css2?family=A",
            "https://fonts.googleapis.com.evil.com/css2?family=A",
            "https://evil.com/fonts.googleapis.com/css2",
            "https://fonts.googleapis.com@evil.com/css2",
            "https://user@fonts.googleapis.com/css2",
            "https://fonts.googleapis.com:8443/css2",
            "https://fonts.googleapis.com/other",
            "https://fonts.gstatic.com/s/a.woff2",
            "file:///etc/passwd",
            "https://fonts.googleapis.com/css2 evil",
            "",
        ] {
            assert!(allowed_css_url(bad).is_none(), "{bad}");
        }
    }

    #[test]
    fn font_urls_are_allow_listed() {
        assert!(allowed_font_url("https://fonts.gstatic.com/s/fredoka/v1/abc.woff2").is_some());
        for bad in [
            "https://fonts.gstatic.com/s/fredoka/v1/abc.ttf",
            "https://fonts.googleapis.com/s/a.woff2",
            "https://fonts.gstatic.com.evil.com/a.woff2",
            "http://fonts.gstatic.com/a.woff2",
        ] {
            assert!(allowed_font_url(bad).is_none(), "{bad}");
        }
    }

    #[test]
    fn file_names_are_sanitised() {
        for url in ["https://fonts.gstatic.com/s/x/../../etc/pass wd.woff2", "https://fonts.gstatic.com/s/a%2F..%2Fb.woff2?x=1", "https://fonts.gstatic.com/s/ünï.woff2"] {
            let name = font_file_name(url);
            assert!(safe_cache_name(&name), "{name}");
            assert!(!name.contains('/') && !name.contains(".."));
        }
        assert_eq!(font_file_name("https://a/b.woff2"), font_file_name("https://a/b.woff2"));
        assert!(!safe_cache_name("../x.woff2"));
        assert!(!safe_cache_name("a/b.woff2"));
        assert!(!safe_cache_name("x.css"));
    }

    #[test]
    fn cache_reads_reject_unsafe_names_and_inline_fonts() {
        let dir = std::env::temp_dir().join(format!("mochi-fontcache-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("abc-x.woff2"), b"font").unwrap();
        fs::write(dir.join("ok.css"), "@font-face { src: url(abc-x.woff2) format('woff2'); }").unwrap();
        let out = read_cache(&dir, &dir.join("ok.css")).unwrap();
        assert!(out.contains("url(data:font/woff2;base64,Zm9udA==)"));
        for evil in ["url(../secret.woff2)", "url(https://evil.example/a.woff2)", "url(/etc/passwd)", "url(a.png)"] {
            fs::write(dir.join("bad.css"), format!("@font-face {{ src: {evil}; }}")).unwrap();
            assert!(read_cache(&dir, &dir.join("bad.css")).is_none(), "{evil}");
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn malformed_css_never_panics() {
        for css in ["@font-face", "@font-face {", "/* latin */ @font-face { src: url(", "é@font-face{é}é", "/*", "@font-face } {"] {
            let _ = font_faces(css);
        }
        assert!(src_url("url(").is_none());
        assert!(src_url("src: url(é)").is_some());
    }

    #[test]
    fn stylesheet_keeps_only_latin_faces() {
        let css = "@import url(https://evil.com/x.css);\n/* cyrillic */\n@font-face { font-family: 'A'; src: url(https://fonts.gstatic.com/c.woff2); }\n/* latin */\n@font-face { font-family: 'A'; src: url(https://fonts.gstatic.com/l.woff2) format('woff2'); }\n";
        let faces = font_faces(css);
        assert_eq!(faces.len(), 1);
        assert_eq!(src_url(&faces[0]).unwrap().2, "https://fonts.gstatic.com/l.woff2");
        assert!(valid_theme_id("my-theme_1") && !valid_theme_id("../x") && !valid_theme_id(""));
    }
}
