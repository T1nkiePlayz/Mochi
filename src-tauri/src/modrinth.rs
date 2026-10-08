use serde::Serialize;
use std::{
    collections::HashMap,
    fs,
    io::Write,
    path::PathBuf,
    sync::{atomic::{AtomicU64, Ordering}, Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};

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
    Ok(p)
}

const MAX_DOWNLOAD_BYTES: u64 = 250 * 1024 * 1024;
const CONTENT_EXTENSIONS: [&str; 3] = ["jar", "zip", "mrpack"];

/// Only the Modrinth CDN over HTTPS may serve downloads.
fn is_modrinth_cdn(url: &reqwest::Url) -> bool {
    url.scheme() == "https" && url.host_str() == Some("cdn.modrinth.com")
}

/// Content commands may only touch mod archives, never arbitrary files.
fn validate_content_path(path: &str) -> Result<PathBuf, String> {
    let p = validate_path(path)?;
    if p.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
        return Err("Content paths may not contain '..'.".into());
    }
    let name = p.file_name().and_then(|n| n.to_str()).ok_or("Invalid content filename.")?;
    let base = name.strip_suffix(".disabled").unwrap_or(name);
    let extension = std::path::Path::new(base).extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    if !CONTENT_EXTENSIONS.contains(&extension.as_str()) {
        return Err("Mochi only manages .jar, .zip and .mrpack content files.".into());
    }
    Ok(p)
}

fn validate_download_filename(filename: &str) -> Result<&str, String> {
    let name = filename.trim();
    let extension = std::path::Path::new(name).extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    if name.is_empty() || name == "." || name == ".." || name.contains(['/', '\\']) || name.chars().any(char::is_control) || !CONTENT_EXTENSIONS.contains(&extension.as_str()) {
        return Err("Invalid download filename.".into());
    }
    Ok(name)
}

/// Redirects are only followed while they stay on the Modrinth CDN.
fn cdn_client() -> Result<reqwest::Client, String> {
    let policy = reqwest::redirect::Policy::custom(|attempt| {
        if attempt.previous().len() < 5 && is_modrinth_cdn(attempt.url()) { attempt.follow() } else { attempt.stop() }
    });
    reqwest::Client::builder()
        .user_agent("T1nkiePlayz/Mochi/0.1.0 (https://github.com/T1nkiePlayz/Mochi)")
        .redirect(policy)
        .connect_timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| format!("Unable to prepare download: {e}"))
}

fn cleanup_downloads() {
    let cutoff = now_ms().saturating_sub(10 * 60 * 1000);
    if let Ok(mut state) = downloads().lock() {
        state.retain(|_, entry| {
            entry.finished_at.map(|finished| finished > cutoff).unwrap_or(true)
        });
    }
}

pub fn initialize_downloads() {
    std::thread::spawn(|| loop {
        std::thread::sleep(std::time::Duration::from_secs(60));
        cleanup_downloads();
    });
}

#[tauri::command]
pub async fn get_public_api(url: String) -> Result<serde_json::Value, String> {
    let parsed = reqwest::Url::parse(&url).map_err(|_| "Invalid Modrinth API URL.".to_string())?;
    if parsed.scheme() != "https" || parsed.host_str() != Some("api.modrinth.com") || !parsed.path().starts_with("/v2/") {
        return Err("Mochi only allows requests to the public Modrinth API.".into());
    }
    let response = reqwest::Client::builder()
        .user_agent("T1nkiePlayz/Mochi/0.1.0 (https://github.com/T1nkiePlayz/Mochi)")
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(20))
        .build().map_err(|error| format!("Unable to prepare Modrinth request: {error}"))?
        .get(parsed).header(reqwest::header::ACCEPT, "application/json")
        .send().await.map_err(|error| format!("Unable to reach Modrinth: {error}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("Modrinth request failed ({status})."));
    }
    let body = response.bytes().await.map_err(|error| format!("Unable to read Modrinth response: {error}"))?;
    serde_json::from_slice(&body).map_err(|error| format!("Modrinth returned invalid data: {error}"))
}

pub fn list_downloads() -> Vec<DownloadEntry> {
    cleanup_downloads();
    let mut entries = downloads().lock().map(|state| state.values().cloned().collect::<Vec<_>>()).unwrap_or_default();
    entries.sort_by_key(|entry| entry.created_at);
    entries
}

fn update_download<F>(id: &str, update: F)
where
    F: FnOnce(&mut DownloadEntry),
{
    if let Ok(mut state) = downloads().lock() {
        if let Some(entry) = state.get_mut(id) {
            update(entry);
        }
    }
}

#[tauri::command]
pub fn list_mod_files(path: String) -> Result<Vec<InstalledModFile>, String> {
    let root = validate_path(&path)?;
    fs::create_dir_all(&root).map_err(|e| format!("Unable to access Tofu folder: {e}"))?;
    let mut files = Vec::new();
    for entry in fs::read_dir(&root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let meta = entry.metadata().map_err(|e| e.to_string())?;
        if !meta.is_file() { continue; }
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.ends_with(".jar") && !name.ends_with(".jar.disabled") && !name.ends_with(".zip") && !name.ends_with(".zip.disabled") { continue; }
        files.push(InstalledModFile { filename: name.clone(), path: entry.path().to_string_lossy().to_string(), enabled: !name.ends_with(".disabled"), size: meta.len() });
    }
    files.sort_by(|a,b| a.filename.to_lowercase().cmp(&b.filename.to_lowercase()));
    Ok(files)
}

#[tauri::command]
pub fn set_mod_file_enabled(path: String, enabled: bool) -> Result<(), String> {
    let p = validate_content_path(&path)?;
    let name = p.file_name().ok_or("Invalid content filename.")?.to_string_lossy().to_string();
    let target = if enabled && name.ends_with(".disabled") { p.with_file_name(name.trim_end_matches(".disabled")) }
        else if !enabled && !name.ends_with(".disabled") { p.with_file_name(format!("{name}.disabled")) } else { p.clone() };
    if target != p && target.exists() { return Err("A file with the target name already exists.".into()); }
    if target != p { fs::rename(&p, &target).map_err(|e| format!("Unable to change content state: {e}"))?; }
    Ok(())
}

#[tauri::command]
pub fn delete_mod_file(path: String) -> Result<(), String> {
    let p = validate_content_path(&path)?;
    if p.exists() { fs::remove_file(p).map_err(|e| format!("Unable to delete content: {e}"))?; }
    Ok(())
}

#[tauri::command]
pub fn start_modrinth_download(
    url: String,
    path: String,
    tofu_id: String,
    tofu_name: String,
    item_name: String,
    filename: String,
) -> Result<String, String> {
    let parsed = reqwest::Url::parse(&url).map_err(|_| "Invalid Modrinth download URL.".to_string())?;
    if !is_modrinth_cdn(&parsed) { return Err("Mochi only downloads from the official Modrinth CDN.".into()); }
    let root = validate_path(&path)?;
    let safe_filename = validate_download_filename(&filename)?;
    fs::create_dir_all(&root).map_err(|e| format!("Unable to create Tofu folder: {e}"))?;

    cleanup_downloads();
    let id = format!("download-{}-{}", now_ms(), NEXT_DOWNLOAD_ID.fetch_add(1, Ordering::Relaxed));
    let entry = DownloadEntry {
        id: id.clone(),
        tofu_id,
        tofu_name,
        item_name,
        filename: safe_filename.to_string(),
        downloaded: 0,
        total: None,
        status: "downloading".into(),
        error: None,
        created_at: now_ms(),
        finished_at: None,
    };
    downloads().lock().map_err(|_| "Download state is unavailable.".to_string())?.insert(id.clone(), entry);

    let destination = root.join(safe_filename);
    let temp = destination.with_extension(format!("mochi-download-{}", id));
    let id_for_task = id.clone();

    tauri::async_runtime::spawn(async move {
        let result: Result<(), String> = async {
            let mut response = cdn_client()?.get(parsed).send().await.map_err(|e| format!("Modrinth download failed: {e}"))?;
            if !response.status().is_success() {
                return Err(format!("Modrinth download failed ({}).", response.status()));
            }
            let total = response.content_length();
            if total.is_some_and(|length| length > MAX_DOWNLOAD_BYTES) {
                return Err("Modrinth file exceeds Mochi's 250 MiB safety limit.".into());
            }
            update_download(&id_for_task, |entry| entry.total = total);

            let mut file = fs::File::create(&temp).map_err(|e| format!("Unable to create temporary download: {e}"))?;
            let mut downloaded = 0u64;
            while let Some(chunk) = response.chunk().await.map_err(|e| format!("Unable to read download: {e}"))? {
                downloaded = downloaded.saturating_add(chunk.len() as u64);
                if downloaded > MAX_DOWNLOAD_BYTES {
                    return Err("Modrinth file exceeds Mochi's 250 MiB safety limit.".into());
                }
                file.write_all(&chunk).map_err(|e| format!("Unable to write downloaded file: {e}"))?;
                update_download(&id_for_task, |entry| entry.downloaded = downloaded);
            }
            file.flush().map_err(|e| format!("Unable to finalize downloaded file: {e}"))?;
            fs::rename(&temp, &destination).map_err(|e| format!("Unable to finalize downloaded file: {e}"))?;
            Ok(())
        }.await;

        match result {
            Ok(()) => update_download(&id_for_task, |entry| {
                entry.status = "completed".into();
                entry.finished_at = Some(now_ms());
                entry.error = None;
            }),
            Err(error) => {
                let _ = fs::remove_file(&temp);
                update_download(&id_for_task, |entry| {
                    entry.status = "failed".into();
                    entry.finished_at = Some(now_ms());
                    entry.error = Some(error);
                });
            }
        }
    });

    Ok(id)
}

#[tauri::command]
pub async fn download_modrinth_file(url: String, path: String) -> Result<(), String> {
    let parsed = reqwest::Url::parse(&url).map_err(|_| "Invalid Modrinth download URL.".to_string())?;
    if !is_modrinth_cdn(&parsed) { return Err("Mochi only downloads from the official Modrinth CDN.".into()); }
    let root = validate_path(&path)?;
    let filename = parsed.path_segments().and_then(|mut s| s.next_back()).filter(|x| !x.is_empty()).ok_or("Download URL has no filename.")?.to_string();
    let filename = validate_download_filename(&filename)?;
    fs::create_dir_all(&root).map_err(|e| format!("Unable to create Tofu folder: {e}"))?;
    let destination = root.join(filename);
    let mut response = cdn_client()?.get(parsed).send().await.map_err(|e| format!("Modrinth download failed: {e}"))?;
    if !response.status().is_success() { return Err(format!("Modrinth download failed ({}).", response.status())); }
    if response.content_length().is_some_and(|length| length > MAX_DOWNLOAD_BYTES) { return Err("Modrinth file exceeds Mochi's 250 MiB safety limit.".into()); }
    let temp = destination.with_file_name(format!("{filename}.mochi-download-{}", now_ms()));
    let result: Result<(), String> = async {
        let mut file = fs::File::create(&temp).map_err(|e| format!("Unable to write downloaded file: {e}"))?;
        let mut downloaded = 0u64;
        while let Some(chunk) = response.chunk().await.map_err(|e| format!("Unable to read Modrinth download: {e}"))? {
            downloaded = downloaded.saturating_add(chunk.len() as u64);
            if downloaded > MAX_DOWNLOAD_BYTES { return Err("Modrinth file exceeds Mochi's 250 MiB safety limit.".into()); }
            file.write_all(&chunk).map_err(|e| format!("Unable to write downloaded file: {e}"))?;
        }
        file.flush().map_err(|e| format!("Unable to finalize downloaded file: {e}"))?;
        fs::rename(&temp, &destination).map_err(|e| format!("Unable to finalize downloaded file: {e}"))
    }.await;
    if result.is_err() { let _ = fs::remove_file(&temp); }
    result
}
