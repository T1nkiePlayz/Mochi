use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha1::{Digest, Sha1};
use std::{
    collections::HashMap,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{atomic::{AtomicU64, Ordering}, Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};

const API_BASE: &str = "https://api.modrinth.com/v2";
const MAX_DOWNLOAD_BYTES: u64 = 250 * 1024 * 1024;
const CONTENT_EXTENSIONS: [&str; 3] = ["jar", "zip", "mrpack"];
const DOWNLOAD_RETENTION_MS: u64 = 10 * 60 * 1000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledModFile { pub filename: String, pub path: String, pub enabled: bool, pub size: u64 }

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadEntry {
    pub id: String,
    pub tofu_id: String,
    pub tofu_name: String,
    pub item_name: String,
    pub filename: String,
    pub downloaded: u64,
    pub total: Option<u64>,
    pub status: String,
    pub error: Option<String>,
    pub created_at: u64,
    pub finished_at: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModUpdate { pub version_id: String, pub version_number: String, pub filename: String, pub url: String, pub size: u64 }

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModAnalysis {
    pub filename: String,
    pub path: String,
    pub enabled: bool,
    pub project_id: String,
    pub title: String,
    pub icon_url: Option<String>,
    pub current_version: String,
    pub update: Option<ModUpdate>,
}

#[derive(Debug, Deserialize)]
struct ApiFile { url: String, filename: String, #[serde(default)] primary: bool, #[serde(default)] size: u64, #[serde(default)] hashes: HashMap<String, String> }

#[derive(Debug, Deserialize)]
struct ApiVersion { id: String, project_id: String, version_number: String, #[serde(default)] date_published: String, #[serde(default)] files: Vec<ApiFile> }

#[derive(Debug, Deserialize)]
struct ApiProject { id: String, title: String, icon_url: Option<String> }

static DOWNLOADS: OnceLock<Mutex<HashMap<String, DownloadEntry>>> = OnceLock::new();
static NEXT_DOWNLOAD_ID: AtomicU64 = AtomicU64::new(1);

fn downloads() -> &'static Mutex<HashMap<String, DownloadEntry>> {
    DOWNLOADS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or_default()
}

fn validate_path(path: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(path);
    if !p.is_absolute() { return Err("Mochi requires an absolute Tofu folder path.".into()); }
    if p.components().any(|c| matches!(c, std::path::Component::ParentDir)) { return Err("Paths may not contain '..'.".into()); }
    Ok(p)
}

fn content_extension(name: &str) -> String {
    let base = name.strip_suffix(".disabled").unwrap_or(name);
    Path::new(base).extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase()
}

/// Content commands may only touch mod archives, never arbitrary files.
fn validate_content_path(path: &str) -> Result<PathBuf, String> {
    let p = validate_path(path)?;
    let name = p.file_name().and_then(|n| n.to_str()).ok_or("Invalid content filename.")?;
    if !CONTENT_EXTENSIONS.contains(&content_extension(name).as_str()) {
        return Err("Mochi only manages .jar, .zip and .mrpack content files.".into());
    }
    Ok(p)
}

fn validate_download_filename(filename: &str) -> Result<&str, String> {
    let name = filename.trim();
    if name.is_empty() || name == "." || name == ".." || name.contains(['/', '\\']) || name.chars().any(char::is_control) || !CONTENT_EXTENSIONS.contains(&content_extension(name).as_str()) {
        return Err("Invalid download filename.".into());
    }
    Ok(name)
}

/// Only the Modrinth CDN over HTTPS may serve downloads.
fn is_modrinth_cdn(url: &reqwest::Url) -> bool {
    url.scheme() == "https" && url.host_str() == Some("cdn.modrinth.com")
}

fn parse_cdn_url(url: &str) -> Result<reqwest::Url, String> {
    let parsed = reqwest::Url::parse(url).map_err(|_| "Invalid Modrinth download URL.".to_string())?;
    if is_modrinth_cdn(&parsed) { Ok(parsed) } else { Err("Mochi only downloads from the official Modrinth CDN.".into()) }
}

/// One shared client: connection reuse, a fixed user agent, and redirects that
/// may only land on Modrinth hosts.
fn client() -> Result<&'static reqwest::Client, String> {
    static CLIENT: OnceLock<Result<reqwest::Client, String>> = OnceLock::new();
    CLIENT.get_or_init(|| {
        let policy = reqwest::redirect::Policy::custom(|attempt| {
            let allowed = attempt.url().scheme() == "https" && matches!(attempt.url().host_str(), Some("cdn.modrinth.com") | Some("api.modrinth.com"));
            if attempt.previous().len() < 5 && allowed { attempt.follow() } else { attempt.stop() }
        });
        reqwest::Client::builder()
            .user_agent("T1nkiePlayz/Mochi/0.1.0 (https://github.com/T1nkiePlayz/Mochi)")
            .redirect(policy)
            .connect_timeout(std::time::Duration::from_secs(20))
            .build()
            .map_err(|e| format!("Unable to prepare Modrinth requests: {e}"))
    }).as_ref().map_err(Clone::clone)
}

fn cleanup_downloads() {
    let cutoff = now_ms().saturating_sub(DOWNLOAD_RETENTION_MS);
    if let Ok(mut state) = downloads().lock() {
        state.retain(|_, entry| entry.finished_at.map(|finished| finished > cutoff).unwrap_or(true));
    }
}

fn update_download(id: &str, update: impl FnOnce(&mut DownloadEntry)) {
    if let Ok(mut state) = downloads().lock() {
        if let Some(entry) = state.get_mut(id) { update(entry); }
    }
}

pub fn list_downloads() -> Vec<DownloadEntry> {
    cleanup_downloads();
    let mut entries = downloads().lock().map(|state| state.values().cloned().collect::<Vec<_>>()).unwrap_or_default();
    entries.sort_by_key(|entry| entry.created_at);
    entries
}

/// Public API responses are cached on disk so Discover keeps working offline.
const API_CACHE_FRESH_MS: u64 = 15 * 60 * 1000;
const API_CACHE_MAX_STALE_MS: u64 = 30 * 24 * 60 * 60 * 1000;
const API_CACHE_MAX_ENTRIES: usize = 400;
const API_MAX_RESPONSE_BYTES: usize = 8 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicApiResponse {
    pub data: Value,
    /// Served from the disk cache instead of the network.
    pub cached: bool,
    /// Served from the cache because the network request failed (offline, rate limited, ...).
    pub stale: bool,
    pub fetched_at: u64,
}

#[derive(Debug, PartialEq, Eq)]
enum CacheAge { Fresh, Usable, Expired }

fn classify_cache_age(age_ms: u64) -> CacheAge {
    if age_ms <= API_CACHE_FRESH_MS { CacheAge::Fresh } else if age_ms <= API_CACHE_MAX_STALE_MS { CacheAge::Usable } else { CacheAge::Expired }
}

/// Only the public Modrinth API over HTTPS may be queried.
fn parse_api_url(url: &str) -> Result<reqwest::Url, String> {
    let parsed = reqwest::Url::parse(url).map_err(|_| "Invalid Modrinth API URL.".to_string())?;
    if parsed.scheme() != "https" || parsed.host_str() != Some("api.modrinth.com") || !parsed.path().starts_with("/v2/") || parsed.port().is_some() {
        return Err("Mochi only allows requests to the public Modrinth API.".into());
    }
    Ok(parsed)
}

fn cache_file(dir: &Path, url: &reqwest::Url) -> PathBuf {
    let mut hasher = Sha1::new();
    hasher.update(url.as_str().as_bytes());
    let hex: String = hasher.finalize().iter().map(|byte| format!("{byte:02x}")).collect();
    dir.join(format!("{hex}.json"))
}

fn read_cache(path: &Path) -> Option<(Value, u64)> {
    let parsed: Value = serde_json::from_slice(&fs::read(path).ok()?).ok()?;
    Some((parsed.get("data")?.clone(), parsed.get("fetchedAt")?.as_u64()?))
}

fn prune_cache(dir: &Path) {
    let Ok(read) = fs::read_dir(dir) else { return };
    let mut entries: Vec<(SystemTime, PathBuf)> = read.flatten()
        .filter_map(|entry| Some((entry.metadata().ok()?.modified().ok()?, entry.path())))
        .collect();
    if entries.len() <= API_CACHE_MAX_ENTRIES { return; }
    entries.sort_by_key(|(modified, _)| *modified);
    let excess = entries.len() - API_CACHE_MAX_ENTRIES;
    for (_, path) in entries.into_iter().take(excess) { let _ = fs::remove_file(path); }
}

fn write_cache(dir: &Path, path: &Path, data: &Value, fetched_at: u64) {
    if fs::create_dir_all(dir).is_err() { return; }
    let body = json!({ "fetchedAt": fetched_at, "data": data });
    // Write-then-rename so a crash never leaves a truncated cache entry behind.
    let tmp = path.with_extension("tmp");
    if serde_json::to_vec(&body).ok().and_then(|bytes| fs::write(&tmp, bytes).ok()).is_some() && fs::rename(&tmp, path).is_err() {
        let _ = fs::remove_file(&tmp);
    }
    prune_cache(dir);
}

async fn fetch_api(url: reqwest::Url) -> Result<Value, String> {
    let mut response = client()?.get(url).header(reqwest::header::ACCEPT, "application/json").timeout(std::time::Duration::from_secs(20))
        .send().await.map_err(|error| format!("Unable to reach Modrinth: {error}"))?;
    let status = response.status();
    if status == reqwest::StatusCode::TOO_MANY_REQUESTS { return Err("Modrinth is rate limiting requests right now (429). Try again in a minute.".into()); }
    if !status.is_success() { return Err(format!("Modrinth request failed ({status}).")); }
    if response.content_length().map(|length| length as usize > API_MAX_RESPONSE_BYTES).unwrap_or(false) {
        return Err("Modrinth returned an unexpectedly large response.".into());
    }
    let mut body: Vec<u8> = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|error| format!("Modrinth connection dropped: {error}"))? {
        if body.len() + chunk.len() > API_MAX_RESPONSE_BYTES { return Err("Modrinth returned an unexpectedly large response.".into()); }
        body.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&body).map_err(|error| format!("Modrinth returned invalid data: {error}"))
}

#[tauri::command]
pub async fn get_public_api(app: tauri::AppHandle, url: String) -> Result<PublicApiResponse, String> {
    use tauri::Manager;
    let parsed = parse_api_url(&url)?;
    let dir = app.path().app_cache_dir().ok().map(|dir| dir.join("modrinth-api"));
    let path = dir.as_ref().map(|dir| cache_file(dir, &parsed));
    let cached = path.as_deref().and_then(read_cache);
    if let Some((data, fetched_at)) = &cached {
        if classify_cache_age(now_ms().saturating_sub(*fetched_at)) == CacheAge::Fresh {
            return Ok(PublicApiResponse { data: data.clone(), cached: true, stale: false, fetched_at: *fetched_at });
        }
    }
    match fetch_api(parsed).await {
        Ok(data) => {
            let fetched_at = now_ms();
            if let (Some(dir), Some(path)) = (&dir, &path) { write_cache(dir, path, &data, fetched_at); }
            Ok(PublicApiResponse { data, cached: false, stale: false, fetched_at })
        }
        Err(error) => match cached {
            Some((data, fetched_at)) if classify_cache_age(now_ms().saturating_sub(fetched_at)) != CacheAge::Expired =>
                Ok(PublicApiResponse { data, cached: true, stale: true, fetched_at }),
            _ => Err(error),
        },
    }
}

#[tauri::command(async)]
pub fn list_mod_files(path: String) -> Result<Vec<InstalledModFile>, String> {
    let root = validate_path(&path)?;
    fs::create_dir_all(&root).map_err(|e| format!("Unable to access Tofu folder: {e}"))?;
    let mut files = Vec::new();
    for entry in fs::read_dir(&root).map_err(|e| e.to_string())?.flatten() {
        let Ok(meta) = entry.metadata() else { continue };
        let name = entry.file_name().to_string_lossy().into_owned();
        if !meta.is_file() || !CONTENT_EXTENSIONS.contains(&content_extension(&name).as_str()) { continue; }
        files.push(InstalledModFile { enabled: !name.ends_with(".disabled"), filename: name, path: entry.path().to_string_lossy().into_owned(), size: meta.len() });
    }
    files.sort_by_key(|file| file.filename.to_lowercase());
    Ok(files)
}

fn rename_enabled(path: &Path, enabled: bool) -> Result<(), String> {
    let name = path.file_name().and_then(|n| n.to_str()).ok_or("Invalid content filename.")?;
    let target = match (enabled, name.strip_suffix(".disabled")) {
        (true, Some(base)) => path.with_file_name(base),
        (false, None) => path.with_file_name(format!("{name}.disabled")),
        _ => return Ok(()),
    };
    if target.exists() { return Err(format!("'{}' already exists.", target.display())); }
    fs::rename(path, &target).map_err(|e| format!("Unable to change content state: {e}"))
}

#[tauri::command(async)]
pub fn set_mod_file_enabled(path: String, enabled: bool) -> Result<(), String> {
    rename_enabled(&validate_content_path(&path)?, enabled)
}

/// Enables exactly the named files in a Tofu folder and disables the rest.
#[tauri::command(async)]
pub fn apply_mod_profile(path: String, enabled_files: Vec<String>) -> Result<(), String> {
    let root = validate_path(&path)?;
    let wanted: std::collections::HashSet<&str> = enabled_files.iter().map(String::as_str).collect();
    for file in list_mod_files(path)? {
        let base = file.filename.strip_suffix(".disabled").unwrap_or(&file.filename);
        rename_enabled(&root.join(&file.filename), wanted.contains(base))?;
    }
    Ok(())
}

#[tauri::command(async)]
pub fn delete_mod_file(path: String) -> Result<(), String> {
    let p = validate_content_path(&path)?;
    if p.exists() { fs::remove_file(p).map_err(|e| format!("Unable to delete content: {e}"))?; }
    Ok(())
}

/// Streams `url` into `destination` through a temp file, enforcing the size cap.
async fn fetch_to_file(url: reqwest::Url, destination: &Path, progress: impl Fn(u64, Option<u64>)) -> Result<(), String> {
    let mut response = client()?.get(url).send().await.map_err(|e| format!("Modrinth download failed: {e}"))?;
    if !response.status().is_success() { return Err(format!("Modrinth download failed ({}).", response.status())); }
    let total = response.content_length();
    if total.is_some_and(|length| length > MAX_DOWNLOAD_BYTES) { return Err("Modrinth file exceeds Mochi's 250 MiB safety limit.".into()); }
    progress(0, total);

    let name = destination.file_name().and_then(|n| n.to_str()).unwrap_or("download");
    let temp = destination.with_file_name(format!("{name}.mochi-download-{}", NEXT_DOWNLOAD_ID.fetch_add(1, Ordering::Relaxed)));
    let result: Result<(), String> = async {
        let mut file = fs::File::create(&temp).map_err(|e| format!("Unable to create temporary download: {e}"))?;
        let mut downloaded = 0u64;
        while let Some(chunk) = response.chunk().await.map_err(|e| format!("Unable to read download: {e}"))? {
            downloaded = downloaded.saturating_add(chunk.len() as u64);
            if downloaded > MAX_DOWNLOAD_BYTES { return Err("Modrinth file exceeds Mochi's 250 MiB safety limit.".into()); }
            file.write_all(&chunk).map_err(|e| format!("Unable to write downloaded file: {e}"))?;
            progress(downloaded, total);
        }
        file.flush().map_err(|e| format!("Unable to finalize downloaded file: {e}"))?;
        fs::rename(&temp, destination).map_err(|e| format!("Unable to finalize downloaded file: {e}"))
    }.await;
    if result.is_err() { let _ = fs::remove_file(&temp); }
    result
}

#[tauri::command]
pub fn start_modrinth_download(url: String, path: String, tofu_id: String, tofu_name: String, item_name: String, filename: String) -> Result<String, String> {
    let parsed = parse_cdn_url(&url)?;
    let root = validate_path(&path)?;
    let safe_filename = validate_download_filename(&filename)?.to_string();
    fs::create_dir_all(&root).map_err(|e| format!("Unable to create Tofu folder: {e}"))?;

    cleanup_downloads();
    let id = format!("download-{}-{}", now_ms(), NEXT_DOWNLOAD_ID.fetch_add(1, Ordering::Relaxed));
    let entry = DownloadEntry {
        id: id.clone(), tofu_id, tofu_name, item_name, filename: safe_filename.clone(), downloaded: 0, total: None,
        status: "downloading".into(), error: None, created_at: now_ms(), finished_at: None,
    };
    downloads().lock().map_err(|_| "Download state is unavailable.".to_string())?.insert(id.clone(), entry);

    let destination = root.join(&safe_filename);
    let task_id = id.clone();
    tauri::async_runtime::spawn(async move {
        let result = fetch_to_file(parsed, &destination, |downloaded, total| update_download(&task_id, |entry| { entry.downloaded = downloaded; entry.total = total; })).await;
        update_download(&task_id, |entry| {
            entry.finished_at = Some(now_ms());
            match result {
                Ok(()) => { entry.status = "completed".into(); entry.error = None; }
                Err(error) => { entry.status = "failed".into(); entry.error = Some(error); }
            }
        });
    });
    Ok(id)
}

/// Downloads `url` next to `path`, then removes the old file. A disabled mod stays disabled.
#[tauri::command]
pub async fn update_mod_file(path: String, url: String, filename: String) -> Result<(), String> {
    let old = validate_content_path(&path)?;
    let parsed = parse_cdn_url(&url)?;
    let filename = validate_download_filename(&filename)?;
    let was_disabled = old.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.ends_with(".disabled"));
    let target_name = if was_disabled { format!("{filename}.disabled") } else { filename.to_string() };
    let target = old.with_file_name(target_name);
    fetch_to_file(parsed, &target, |_, _| {}).await?;
    if target != old { let _ = fs::remove_file(&old); }
    Ok(())
}

fn sha1_hex(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha1::new();
    let mut buffer = vec![0u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if read == 0 { break; }
        hasher.update(&buffer[..read]);
    }
    Ok(hasher.finalize().iter().map(|byte| format!("{byte:02x}")).collect())
}

async fn post_versions(endpoint: &str, body: Value) -> Result<HashMap<String, ApiVersion>, String> {
    let response = client()?.post(format!("{API_BASE}/{endpoint}")).json(&body).timeout(std::time::Duration::from_secs(30))
        .send().await.map_err(|e| format!("Unable to reach Modrinth: {e}"))?;
    if !response.status().is_success() { return Err(format!("Modrinth request failed ({}).", response.status())); }
    response.json().await.map_err(|e| format!("Modrinth returned invalid data: {e}"))
}

/// Identifies installed files on Modrinth and reports newer compatible versions.
#[tauri::command]
pub async fn analyze_mod_files(path: String, game_version: Option<String>, loader: Option<String>) -> Result<Vec<ModAnalysis>, String> {
    let files = list_mod_files(path)?;
    let hashed: Vec<(InstalledModFile, String)> = tauri::async_runtime::spawn_blocking(move || {
        files.into_iter().filter_map(|file| sha1_hex(Path::new(&file.path)).ok().map(|hash| (file, hash))).collect()
    }).await.map_err(|e| e.to_string())?;
    if hashed.is_empty() { return Ok(Vec::new()); }

    let hashes: Vec<&str> = hashed.iter().map(|(_, hash)| hash.as_str()).collect();
    let current = post_versions("version_files", json!({ "hashes": hashes, "algorithm": "sha1" })).await?;
    let mut filters = json!({ "hashes": hashes, "algorithm": "sha1" });
    if let Some(loader) = loader.filter(|l| !l.is_empty()) { filters["loaders"] = json!([loader]); }
    if let Some(version) = game_version.filter(|v| !v.is_empty()) { filters["game_versions"] = json!([version]); }
    let latest = post_versions("version_files/update", filters).await.unwrap_or_default();

    let project_ids: Vec<&str> = { let mut ids: Vec<&str> = current.values().map(|v| v.project_id.as_str()).collect(); ids.sort_unstable(); ids.dedup(); ids };
    let projects: HashMap<String, ApiProject> = if project_ids.is_empty() { HashMap::new() } else {
        let url = reqwest::Url::parse_with_params(&format!("{API_BASE}/projects"), [("ids", serde_json::to_string(&project_ids).unwrap_or_default())]).map_err(|e| e.to_string())?;
        let found: Vec<ApiProject> = client()?.get(url).send().await.map_err(|e| e.to_string())?.json().await.unwrap_or_default();
        found.into_iter().map(|project| (project.id.clone(), project)).collect()
    };

    Ok(hashed.into_iter().filter_map(|(file, hash)| {
        let version = current.get(&hash)?;
        let project = projects.get(&version.project_id);
        let update = latest.get(&hash).filter(|newest| newest.id != version.id && newest.date_published > version.date_published).and_then(|newest| {
            let asset = newest.files.iter().find(|f| f.primary).or_else(|| newest.files.first())?;
            // A "newer" version whose primary file hashes the same is not an update.
            if asset.hashes.get("sha1").is_some_and(|h| *h == hash) { return None; }
            Some(ModUpdate { version_id: newest.id.clone(), version_number: newest.version_number.clone(), filename: asset.filename.clone(), url: asset.url.clone(), size: asset.size })
        });
        Some(ModAnalysis {
            enabled: file.enabled, filename: file.filename, path: file.path, project_id: version.project_id.clone(),
            title: project.map(|p| p.title.clone()).unwrap_or_else(|| version.project_id.clone()),
            icon_url: project.and_then(|p| p.icon_url.clone()), current_version: version.version_number.clone(), update,
        })
    }).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn content_paths_are_restricted() {
        assert!(validate_content_path("/tmp/mods/a.jar").is_ok());
        assert!(validate_content_path("/tmp/mods/a.jar.disabled").is_ok());
        assert!(validate_content_path("/etc/passwd").is_err());
        assert!(validate_content_path("/tmp/../etc/a.jar").is_err());
        assert!(validate_content_path("relative/a.jar").is_err());
    }

    #[test]
    fn download_filenames_are_restricted() {
        assert!(validate_download_filename("sodium-1.0.jar").is_ok());
        assert!(validate_download_filename("../evil.jar").is_err());
        assert!(validate_download_filename("run.sh").is_err());
    }

    #[test]
    fn only_the_modrinth_cdn_is_allowed() {
        assert!(parse_cdn_url("https://cdn.modrinth.com/data/x/y.jar").is_ok());
        assert!(parse_cdn_url("http://cdn.modrinth.com/data/x/y.jar").is_err());
        assert!(parse_cdn_url("https://evil.example/y.jar").is_err());
    }

    #[test]
    fn api_hosts_are_whitelisted() {
        assert!(parse_api_url("https://api.modrinth.com/v2/search?limit=1").is_ok());
        assert!(parse_api_url("http://api.modrinth.com/v2/search").is_err());
        assert!(parse_api_url("https://api.modrinth.com.evil.example/v2/search").is_err());
        assert!(parse_api_url("https://evil.example/v2/search").is_err());
        assert!(parse_api_url("https://api.modrinth.com/other").is_err());
        assert!(parse_api_url("https://api.modrinth.com:8443/v2/search").is_err());
    }

    #[test]
    fn cache_age_is_classified() {
        assert_eq!(classify_cache_age(0), CacheAge::Fresh);
        assert_eq!(classify_cache_age(API_CACHE_FRESH_MS), CacheAge::Fresh);
        assert_eq!(classify_cache_age(API_CACHE_FRESH_MS + 1), CacheAge::Usable);
        assert_eq!(classify_cache_age(API_CACHE_MAX_STALE_MS), CacheAge::Usable);
        assert_eq!(classify_cache_age(API_CACHE_MAX_STALE_MS + 1), CacheAge::Expired);
    }

    #[test]
    fn cache_round_trips_and_keys_differ_per_url() {
        let dir = std::env::temp_dir().join(format!("mochi-api-cache-test-{}", now_ms()));
        let a = reqwest::Url::parse("https://api.modrinth.com/v2/search?offset=0").unwrap();
        let b = reqwest::Url::parse("https://api.modrinth.com/v2/search?offset=20").unwrap();
        assert_ne!(cache_file(&dir, &a), cache_file(&dir, &b));
        assert!(read_cache(&cache_file(&dir, &a)).is_none());
        write_cache(&dir, &cache_file(&dir, &a), &json!({ "hits": [1, 2] }), 1234);
        let (data, at) = read_cache(&cache_file(&dir, &a)).expect("cache entry");
        assert_eq!(at, 1234);
        assert_eq!(data["hits"][1], 2);
        let _ = fs::remove_dir_all(&dir);
    }
}
