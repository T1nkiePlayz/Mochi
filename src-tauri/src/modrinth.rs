use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha1::{Digest, Sha1};
use std::{
    collections::HashMap,
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::{atomic::AtomicU64, Mutex, OnceLock},
    time::SystemTime,
};
use crate::util::{hex, http, MutexExt};

const API_BASE: &str = "https://api.modrinth.com/v2";
pub(crate) const MAX_DOWNLOAD_BYTES: u64 = 250 * 1024 * 1024;
/// File types Mochi installs and manages: Minecraft jars/packs plus what other games' mod sites distribute
/// (tModLoader `.tmod`, Satisfactory `.smod`, Source/Unreal `.pak`, BepInEx `.dll`, Bethesda plugins and archives).
pub(crate) const CONTENT_EXTENSIONS: &[&str] = &["jar", "zip", "mrpack", "tmod", "smod", "pak", "dll", "esp", "esm", "esl", "ba2", "7z", "rar", "vpk"];
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
    /// "downloading", "completed", "failed" or "cancelled".
    pub status: String,
    pub error: Option<String>,
    pub created_at: u64,
    pub finished_at: Option<u64>,
    /// "modrinth", "curseforge" or "nexus".
    pub provider: String,
    /// Folder the file lands in (for "Open folder").
    pub dir: String,
    /// The mod (site project id) and Tofu content folder, so lists can show "Downloading" on the right card.
    pub project_id: Option<String>,
    pub subdir: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModUpdate { pub version_id: String, pub version_number: String, pub filename: String, pub url: String, pub size: u64, pub sha1: Option<String> }

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
pub(crate) struct ApiVersion { pub id: String, pub project_id: String, pub version_number: String, #[serde(default)] pub date_published: String, #[serde(default)] files: Vec<ApiFile> }

#[derive(Debug, Deserialize)]
pub(crate) struct ApiProject { pub id: String, pub title: String, pub icon_url: Option<String> }

static DOWNLOADS: OnceLock<Mutex<HashMap<String, DownloadEntry>>> = OnceLock::new();
pub(crate) static NEXT_DOWNLOAD_ID: AtomicU64 = AtomicU64::new(1);

pub(crate) fn downloads() -> &'static Mutex<HashMap<String, DownloadEntry>> {
    DOWNLOADS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// A panic while the lock was held must not disable download tracking for the rest of the session.
pub(crate) fn lock_downloads() -> std::sync::MutexGuard<'static, HashMap<String, DownloadEntry>> {
    downloads().lock_recover()
}

/// Downloads that have not finished yet.
pub(crate) fn active_download_count() -> usize {
    lock_downloads().values().filter(|entry| entry.finished_at.is_none()).count()
}

pub(crate) use crate::util::now_ms;

pub(crate) fn validate_path(path: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(path);
    if !p.is_absolute() { return Err("Mochi requires an absolute Tofu folder path.".into()); }
    if p.components().any(|c| matches!(c, std::path::Component::ParentDir)) { return Err("Paths may not contain '..'.".into()); }
    Ok(p)
}

pub(crate) fn content_extension(name: &str) -> String {
    let base = name.strip_suffix(".disabled").unwrap_or(name);
    Path::new(base).extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase()
}

/// Content commands may only touch mod archives, never arbitrary files.
pub(crate) fn validate_content_path(path: &str) -> Result<PathBuf, String> {
    let p = validate_path(path)?;
    let name = p.file_name().and_then(|n| n.to_str()).ok_or("Invalid content filename.")?;
    if !CONTENT_EXTENSIONS.contains(&content_extension(name).as_str()) {
        return Err("Mochi only manages mod and content files (.jar, .zip, .mrpack, .tmod, .dll, ...).".into());
    }
    Ok(p)
}

pub(crate) fn validate_download_filename(filename: &str) -> Result<&str, String> {
    let name = filename.trim();
    // `.disabled` is Mochi's own marker (set_mod_file_enabled); a download may not arrive pre-disabled or collide with it.
    if name.is_empty() || name.len() > 200 || name == "." || name == ".." || name.contains(['/', '\\']) || name.chars().any(char::is_control)
        || name.ends_with(".disabled") || !CONTENT_EXTENSIONS.contains(&content_extension(name).as_str()) {
        return Err("Invalid download filename.".into());
    }
    Ok(name)
}

fn modrinth_redirect_allowed(url: &reqwest::Url) -> bool {
    url.scheme() == "https" && url.port().is_none() && url.username().is_empty() && url.password().is_none()
        && matches!(url.host_str(), Some("cdn.modrinth.com" | "api.modrinth.com"))
}

/// One shared client: connection reuse, a fixed user agent, and redirects that
/// may only land on Modrinth hosts.
pub(crate) fn client() -> Result<&'static reqwest::Client, String> {
    static CLIENT: http::SharedClient = http::SharedClient::new();
    CLIENT.get(|| {
        let policy = reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() < 5 && modrinth_redirect_allowed(attempt.url()) { attempt.follow() } else { attempt.stop() }
        });
        http::builder()
            .user_agent("T1nkiePlayz/Mochi/0.1.0 (https://github.com/T1nkiePlayz/Mochi)")
            .redirect(policy)
            .connect_timeout(std::time::Duration::from_secs(20))
            // A stalled transfer must fail instead of leaving a download "downloading" forever.
            .read_timeout(std::time::Duration::from_secs(45))
            .build()
    }, "Unable to prepare Modrinth requests")
}

pub(crate) fn cleanup_downloads() {
    let cutoff = now_ms().saturating_sub(DOWNLOAD_RETENTION_MS);
    lock_downloads().retain(|_, entry| entry.finished_at.map(|finished| finished > cutoff).unwrap_or(true));
}

pub(crate) fn update_download(id: &str, update: impl FnOnce(&mut DownloadEntry)) {
    if let Some(entry) = lock_downloads().get_mut(id) { update(entry); }
}

pub fn list_downloads() -> Vec<DownloadEntry> {
    cleanup_downloads();
    let mut entries = lock_downloads().values().cloned().collect::<Vec<_>>();
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
    if parsed.scheme() != "https" || parsed.host_str() != Some("api.modrinth.com") || !parsed.path().starts_with("/v2/") || parsed.port().is_some()
        || !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("Mochi only allows requests to the public Modrinth API.".into());
    }
    Ok(parsed)
}

fn cache_file(dir: &Path, url: &reqwest::Url) -> PathBuf {
    dir.join(format!("{}.json", hex(&Sha1::digest(url.as_str().as_bytes()))))
}

fn read_cache(path: &Path) -> Option<(Value, u64)> {
    let parsed: Value = serde_json::from_slice(&fs::read(path).ok()?).ok()?;
    Some((parsed.get("data")?.clone(), parsed.get("fetchedAt")?.as_u64()?))
}

fn prune_cache(dir: &Path) {
    let Ok(read) = fs::read_dir(dir) else { return };
    // Listing names is cheap; only stat every entry when the folder is actually over its limit.
    let names: Vec<fs::DirEntry> = read.flatten().collect();
    if names.len() <= API_CACHE_MAX_ENTRIES { return; }
    let mut entries: Vec<(SystemTime, PathBuf)> = names.iter()
        .filter_map(|entry| Some((entry.metadata().ok()?.modified().ok()?, entry.path())))
        .collect();
    entries.sort_by_key(|(modified, _)| *modified);
    let excess = entries.len() - API_CACHE_MAX_ENTRIES;
    for (_, path) in entries.into_iter().take(excess) { let _ = fs::remove_file(path); }
}

fn write_cache(dir: &Path, path: &Path, data: &Value, fetched_at: u64) {
    if fs::create_dir_all(dir).is_err() { return; }
    let body = json!({ "fetchedAt": fetched_at, "data": data });
    // Write-then-rename so a crash never leaves a truncated cache entry behind.
    if serde_json::to_vec(&body).ok().and_then(|bytes| crate::util::fsio::write_atomic(path, &bytes).ok()).is_some() { prune_cache(dir); }
}

async fn fetch_api(url: reqwest::Url) -> Result<Value, String> {
    let mut response = client()?.get(url).header(reqwest::header::ACCEPT, "application/json").timeout(std::time::Duration::from_secs(20))
        .send().await.map_err(|error| format!("Unable to reach Modrinth: {error}"))?;
    let status = response.status();
    if status == reqwest::StatusCode::TOO_MANY_REQUESTS { return Err("Modrinth is rate limiting requests right now (429). Try again in a minute.".into()); }
    if !status.is_success() { return Err(format!("Modrinth request failed ({status}).")); }
    let body = http::read_capped(&mut response, API_MAX_RESPONSE_BYTES).await.map_err(|error| match error {
        http::BodyError::TooLarge => "Modrinth returned an unexpectedly large response.".to_string(),
        http::BodyError::Network(error) => format!("Modrinth connection dropped: {error}"),
    })?;
    serde_json::from_slice(&body).map_err(|error| format!("Modrinth returned invalid data: {error}"))
}

#[tauri::command]
pub async fn get_public_api(app: tauri::AppHandle, url: String) -> Result<PublicApiResponse, String> {
    use tauri::Manager;
    let parsed = parse_api_url(&url)?;
    let dir = app.path().app_cache_dir().ok().map(|dir| dir.join("modrinth-api"));
    let path = dir.as_ref().map(|dir| cache_file(dir, &parsed));
    // Disk reads/writes stay off the async workers.
    let cached = match path.clone() { Some(path) => crate::util::blocking(move || read_cache(&path)).await?, None => None };
    if let Some((data, fetched_at)) = &cached {
        if classify_cache_age(now_ms().saturating_sub(*fetched_at)) == CacheAge::Fresh {
            return Ok(PublicApiResponse { data: data.clone(), cached: true, stale: false, fetched_at: *fetched_at });
        }
    }
    match fetch_api(parsed).await {
        Ok(data) => {
            let fetched_at = now_ms();
            if let (Some(dir), Some(path)) = (dir, path) {
                let to_store = data.clone();
                // The caller does not wait for the cache write.
                tauri::async_runtime::spawn_blocking(move || write_cache(&dir, &path, &to_store, fetched_at));
            }
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

pub(crate) fn rename_enabled(path: &Path, enabled: bool) -> Result<(), String> {
    let name = path.file_name().and_then(|n| n.to_str()).ok_or("Invalid content filename.")?;
    let target = match (enabled, name.strip_suffix(".disabled")) {
        (true, Some(base)) => path.with_file_name(base),
        (false, None) => path.with_file_name(format!("{name}.disabled")),
        _ => return Ok(()),
    };
    if fs::symlink_metadata(&target).is_ok() { return Err(format!("'{}' already exists.", target.display())); }
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
    // Keep going after a failure so one name clash does not leave the rest of the profile half-applied.
    let mut first_error = None;
    for file in list_mod_files(path)? {
        let base = file.filename.strip_suffix(".disabled").unwrap_or(&file.filename);
        if let Err(error) = rename_enabled(&root.join(&file.filename), wanted.contains(base)) { first_error.get_or_insert(error); }
    }
    first_error.map_or(Ok(()), Err)
}

/// Deletes a content file. With `tofu_id`, the Tofu's record of it goes too (unless the other on/off copy is still there).
#[tauri::command(async)]
pub fn delete_mod_file(path: String, tofu_id: Option<String>) -> Result<(), String> {
    let p = validate_content_path(&path)?;
    crate::modinstance::delete_content_in(crate::modinstance::instances_root().as_deref(), tofu_id.as_deref().unwrap_or(""), &p)
}

#[tauri::command(async)]
pub fn start_modrinth_download(url: String, path: String, tofu_id: String, tofu_name: String, item_name: String, filename: String) -> Result<String, String> {
    crate::downloads::start(crate::downloads::ModDownloadRequest {
        provider: crate::downloads::Provider::Modrinth, url, path, tofu_id, tofu_name, item_name, filename,
        sha1: None, extract: None, keep_archive: None, subdir: None, record: None,
    })
}

/// Downloads `url` next to `path`, keeps the old file as a rollback copy, then removes it. A disabled mod stays disabled.
/// The new file is only put in place after its SHA-1 matched (when one is known).
#[tauri::command]
pub async fn update_mod_file(
    path: String, url: String, filename: String, sha1: Option<String>, provider: Option<String>, tofu_id: Option<String>, record: Option<crate::modinstance::RecordInput>,
) -> Result<(), String> {
    use crate::downloads::Provider;
    // The list may still show the name from before the file was switched on or off.
    let old = validate_content_path(&path)?;
    let old = crate::modinstance::existing_variant(&old).ok_or("The file is no longer in the folder. Refresh the list and try again.")?;
    let provider = match provider.as_deref() { None | Some("modrinth") => Provider::Modrinth, Some("curseforge") => Provider::Curseforge, Some("nexus") => Provider::Nexus, Some(_) => return Err("Unknown mod source.".into()) };
    let parsed = crate::downloads::parse_download_url(provider, &url)?;
    let filename = validate_download_filename(&filename)?;
    let sha1 = sha1.as_deref().filter(|value| !value.trim().is_empty()).map(crate::downloads::normalize_sha1).transpose()?;
    let was_disabled = old.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.ends_with(".disabled"));
    let target_name = if was_disabled { format!("{filename}.disabled") } else { filename.to_string() };
    let target = old.with_file_name(target_name);
    let old_base = crate::modinstance::base_name(old.file_name().and_then(|n| n.to_str()).unwrap_or_default()).to_string();
    // A hard link keeps the old data alive even when the new file takes over the same name. The copy only replaces an
    // earlier rollback copy once the download verified: a failed update must leave "Roll back" pointing at the right file.
    let staged = crate::modinstance::stage_rollback_copy(&old).ok();
    let actual = crate::downloads::fetch_to_file(provider, parsed, &target, sha1.as_deref(), |_, _| {}).await?;
    let saved = staged.map(|staged| staged.commit());
    if target != old { let _ = fs::remove_file(&old); }
    if let (Some(tofu_id), Some(record)) = (tofu_id.filter(|id| !id.is_empty()), record) {
        let subdir = crate::modinstance::subdir_of(&old);
        let mut next = record.into_record(filename, &subdir, Some(actual));
        next.enabled = !was_disabled;
        if let Some(saved) = saved {
            // Remember what to restore: the previous file and, if we knew it, its metadata.
            let previous = crate::modinstance::previous_record(&tofu_id, &subdir, &old_base);
            next.rollback = Some(crate::modinstance::Rollback { file: saved, version: previous.as_ref().map(|r| r.version.clone()).unwrap_or_default(), file_id: previous.as_ref().map(|r| r.file_id.clone()).unwrap_or_default(), sha1: previous.as_ref().and_then(|r| r.sha1.clone()), file_date: previous.and_then(|r| r.file_date) });
        }
        crate::modinstance::drop_record(&tofu_id, &subdir, &old_base);
        crate::modinstance::record_install(&tofu_id, next);
    }
    Ok(())
}

pub(crate) fn sha1_hex(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha1::new();
    let mut buffer = vec![0u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if read == 0 { break; }
        hasher.update(&buffer[..read]);
    }
    Ok(hex(&hasher.finalize()))
}

pub(crate) async fn post_versions(endpoint: &str, body: Value) -> Result<HashMap<String, ApiVersion>, String> {
    let response = client()?.post(format!("{API_BASE}/{endpoint}")).json(&body).timeout(std::time::Duration::from_secs(30))
        .send().await.map_err(|e| format!("Unable to reach Modrinth: {e}"))?;
    if !response.status().is_success() { return Err(format!("Modrinth request failed ({}).", response.status())); }
    response.json().await.map_err(|e| format!("Modrinth returned invalid data: {e}"))
}

/// Titles and icons of Modrinth projects by id. Chunked so a big mod folder never produces a URL the API rejects;
/// failures leave entries out (callers fall back to ids).
pub(crate) async fn fetch_projects(mut ids: Vec<&str>) -> HashMap<String, ApiProject> {
    ids.sort_unstable();
    ids.dedup();
    let mut projects: HashMap<String, ApiProject> = HashMap::new();
    let Ok(client) = client() else { return projects };
    for chunk in ids.chunks(100) {
        let Ok(url) = reqwest::Url::parse_with_params(&format!("{API_BASE}/projects"), [("ids", serde_json::to_string(chunk).unwrap_or_default())]) else { continue };
        let response = client.get(url).timeout(std::time::Duration::from_secs(30)).send().await;
        let found: Vec<ApiProject> = match response { Ok(response) if response.status().is_success() => response.json().await.unwrap_or_default(), _ => Vec::new() };
        projects.extend(found.into_iter().map(|project| (project.id.clone(), project)));
    }
    projects
}

/// Identifies installed files on Modrinth and reports newer compatible versions.
#[tauri::command]
pub async fn analyze_mod_files(path: String, game_version: Option<String>, loader: Option<String>) -> Result<Vec<ModAnalysis>, String> {
    let hashed: Vec<(InstalledModFile, String)> = crate::util::blocking(move || -> Result<_, String> {
        Ok(list_mod_files(path)?.into_iter().filter_map(|file| sha1_hex(Path::new(&file.path)).ok().map(|hash| (file, hash))).collect())
    }).await??;
    if hashed.is_empty() { return Ok(Vec::new()); }

    let hashes: Vec<&str> = hashed.iter().map(|(_, hash)| hash.as_str()).collect();
    let current = post_versions("version_files", json!({ "hashes": hashes, "algorithm": "sha1" })).await?;
    let mut filters = json!({ "hashes": hashes, "algorithm": "sha1" });
    if let Some(loader) = loader.filter(|l| !l.is_empty()) { filters["loaders"] = json!([loader]); }
    if let Some(version) = game_version.filter(|v| !v.is_empty()) { filters["game_versions"] = json!([version]); }
    let latest = post_versions("version_files/update", filters).await.unwrap_or_default();

    let projects = fetch_projects(current.values().map(|v| v.project_id.as_str()).collect()).await;

    Ok(hashed.into_iter().filter_map(|(file, hash)| {
        let version = current.get(&hash)?;
        let project = projects.get(&version.project_id);
        let update = latest.get(&hash).filter(|newest| newest.id != version.id && newest.date_published > version.date_published).and_then(|newest| {
            let asset = newest.files.iter().find(|f| f.primary).or_else(|| newest.files.first())?;
            // A "newer" version whose primary file hashes the same is not an update.
            if asset.hashes.get("sha1").is_some_and(|h| *h == hash) { return None; }
            Some(ModUpdate { version_id: newest.id.clone(), version_number: newest.version_number.clone(), filename: asset.filename.clone(), url: asset.url.clone(), size: asset.size, sha1: asset.hashes.get("sha1").cloned() })
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
    fn api_urls_reject_userinfo() {
        assert!(parse_api_url("https://user:pw@api.modrinth.com/v2/search").is_err());
        assert!(parse_api_url("https://user@api.modrinth.com/v2/search").is_err());
    }

    #[test]
    fn redirects_stay_on_modrinth() {
        let ok = |u: &str| modrinth_redirect_allowed(&reqwest::Url::parse(u).unwrap());
        assert!(ok("https://cdn.modrinth.com/data/a.jar"));
        assert!(!ok("http://cdn.modrinth.com/a.jar"));
        assert!(!ok("https://cdn.modrinth.com:444/a.jar"));
        assert!(!ok("https://u@cdn.modrinth.com/a.jar"));
        assert!(!ok("https://evil.example/a.jar"));
    }

    #[test]
    fn download_filenames_reject_control_and_marker_names() {
        for bad in ["a\0.jar", "a\n.jar", "a.jar.disabled", ".jar", "..", "a/b.jar"] { assert!(validate_download_filename(bad).is_err(), "{bad:?}"); }
        assert!(validate_download_filename(&format!("{}.jar", "a".repeat(300))).is_err());
        assert!(validate_download_filename("  ok.jar ").is_ok());
    }

    #[test]
    fn delete_removes_dangling_symlinks_and_profile_applies() {
        let dir = std::env::temp_dir().join(format!("mochi-mods-{}-{}", std::process::id(), now_ms()));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("a.jar"), b"a").unwrap();
        fs::write(dir.join("b.jar.disabled"), b"b").unwrap();
        apply_mod_profile(dir.to_string_lossy().into_owned(), vec!["b.jar".into()]).unwrap();
        assert!(dir.join("a.jar.disabled").exists() && dir.join("b.jar").exists());
        #[cfg(unix)]
        {
            let link = dir.join("gone.jar");
            std::os::unix::fs::symlink(dir.join("missing-target"), &link).unwrap();
            delete_mod_file(link.to_string_lossy().into_owned(), None).unwrap();
            assert!(fs::symlink_metadata(&link).is_err());
        }
        // A clash is reported but the rest of the profile is still applied.
        fs::write(dir.join("a.jar"), b"dup").unwrap();
        fs::write(dir.join("c.jar"), b"c").unwrap();
        assert!(apply_mod_profile(dir.to_string_lossy().into_owned(), vec!["a.jar".into()]).is_err());
        assert!(dir.join("c.jar.disabled").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn download_filenames_are_restricted() {
        assert!(validate_download_filename("sodium-1.0.jar").is_ok());
        assert!(validate_download_filename("../evil.jar").is_err());
        assert!(validate_download_filename("run.sh").is_err());
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
