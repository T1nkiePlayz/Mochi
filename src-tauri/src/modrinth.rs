use serde::Serialize;
use std::{
    collections::HashMap,
    fs,
    io::Write,
    path::PathBuf,
    sync::{Mutex, OnceLock},
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

fn cleanup_downloads() {
    let cutoff = now_ms().saturating_sub(10 * 60 * 1000);
    if let Ok(mut state) = downloads().lock() {
        state.retain(|_, entry| {
            entry.finished_at.map(|finished| finished > cutoff).unwrap_or(true)
        });
    }
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
    let p = validate_path(&path)?;
    let name = p.file_name().ok_or("Invalid content filename.")?.to_string_lossy().to_string();
    let target = if enabled && name.ends_with(".disabled") { p.with_file_name(name.trim_end_matches(".disabled")) }
        else if !enabled && !name.ends_with(".disabled") { p.with_file_name(format!("{name}.disabled")) } else { p.clone() };
    if target != p { fs::rename(&p, &target).map_err(|e| format!("Unable to change content state: {e}"))?; }
    Ok(())
}

#[tauri::command]
pub fn delete_mod_file(path: String) -> Result<(), String> {
    let p = validate_path(&path)?;
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
    if parsed.host_str() != Some("cdn.modrinth.com") { return Err("Mochi only downloads from the official Modrinth CDN.".into()); }
    let root = validate_path(&path)?;
    fs::create_dir_all(&root).map_err(|e| format!("Unable to create Tofu folder: {e}"))?;

    let safe_filename = filename.trim();
    if safe_filename.is_empty() || safe_filename.contains('/') || safe_filename.contains('\\') || safe_filename == "." || safe_filename == ".." {
        return Err("Invalid download filename.".into());
    }

    cleanup_downloads();
    let id = format!("download-{}", now_ms());
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
            let client = reqwest::Client::new();
            let mut response = client.get(parsed).send().await.map_err(|e| format!("Modrinth download failed: {e}"))?;
            if !response.status().is_success() {
                return Err(format!("Modrinth download failed ({}).", response.status()));
            }
            let total = response.content_length();
            update_download(&id_for_task, |entry| entry.total = total);

            let mut file = fs::File::create(&temp).map_err(|e| format!("Unable to create temporary download: {e}"))?;
            let mut downloaded = 0u64;
            while let Some(chunk) = response.chunk().await.map_err(|e| format!("Unable to read download: {e}"))? {
                downloaded = downloaded.saturating_add(chunk.len() as u64);
                if downloaded > 250 * 1024 * 1024 {
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

pub async fn download_modrinth_file(url: String, path: String) -> Result<(), String> {
    let parsed = reqwest::Url::parse(&url).map_err(|_| "Invalid Modrinth download URL.".to_string())?;
    if parsed.host_str() != Some("cdn.modrinth.com") { return Err("Mochi only downloads from the official Modrinth CDN.".into()); }
    let root = validate_path(&path)?;
    fs::create_dir_all(&root).map_err(|e| format!("Unable to create Tofu folder: {e}"))?;
    let filename = parsed.path_segments().and_then(|mut s| s.next_back()).filter(|x| !x.is_empty()).ok_or("Download URL has no filename.")?;
    if filename.contains('/') || filename.contains('\\') || filename == "." || filename == ".." { return Err("Invalid download filename.".into()); }
    let destination = root.join(filename);
    let response = reqwest::get(parsed).await.map_err(|e| format!("Modrinth download failed: {e}"))?;
    if !response.status().is_success() { return Err(format!("Modrinth download failed ({}).", response.status())); }
    let bytes = response.bytes().await.map_err(|e| format!("Unable to read Modrinth download: {e}"))?;
    if bytes.len() > 250 * 1024 * 1024 { return Err("Modrinth file exceeds Mochi's 250 MiB safety limit.".into()); }
    let temp = destination.with_extension("mochi-download");
    fs::write(&temp, &bytes).map_err(|e| format!("Unable to write downloaded file: {e}"))?;
    fs::rename(&temp, &destination).map_err(|e| format!("Unable to finalize downloaded file: {e}"))?;
    Ok(())
}
