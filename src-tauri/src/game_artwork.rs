use base64::{engine::general_purpose::STANDARD, Engine as _};
use std::{fs, path::PathBuf};
use tauri::AppHandle;

const MAX_IMAGE_BYTES: usize = 15 * 1024 * 1024;

fn cache_path(app: &AppHandle, key: &str) -> Result<PathBuf, String> {
    let key = key.trim();
    if key.is_empty() || key.len() > 120 || !key.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err("Invalid game artwork cache key.".into());
    }
    Ok(crate::themes::game_artwork_cache_dir(app)?.join(key))
}

fn mime_for_path(path: &std::path::Path) -> &'static str {
    match path.extension().and_then(|value| value.to_str()).unwrap_or("") {
        "png" => "image/png",
        "webp" => "image/webp",
        _ => "image/jpeg",
    }
}

fn data_url(path: &std::path::Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|error| format!("Unable to read cached artwork: {error}"))?;
    Ok(format!("data:{};base64,{}", mime_for_path(path), STANDARD.encode(bytes)))
}

#[tauri::command]
pub async fn cache_game_artwork(app: AppHandle, url: String, cache_key: String) -> Result<String, String> {
    let path = cache_path(&app, &cache_key)?;
    if let Some(existing) = fs::read_dir(path.parent().unwrap_or_else(|| std::path::Path::new("."))).ok().and_then(|entries| entries.flatten().find(|entry| entry.path().file_stem().and_then(|v| v.to_str()) == Some(cache_key.as_str())).map(|entry| entry.path())) {
        return data_url(&existing);
    }

    let parsed = reqwest::Url::parse(&url).map_err(|_| "Invalid artwork URL.".to_string())?;
    if parsed.scheme() != "https" || parsed.host_str() != Some("images.igdb.com") || !parsed.path().starts_with("/igdb/image/upload/") {
        return Err("Only IGDB artwork URLs can be cached.".into());
    }
    let response = reqwest::Client::builder().timeout(std::time::Duration::from_secs(20)).build()
        .map_err(|error| format!("Unable to prepare artwork request: {error}"))?
        .get(parsed).send().await.map_err(|error| format!("Unable to download game artwork: {error}"))?;
    if !response.status().is_success() { return Err(format!("IGDB artwork returned HTTP {}.", response.status())); }
    if response.content_length().is_some_and(|length| length as usize > MAX_IMAGE_BYTES) { return Err("IGDB artwork is larger than the 15 MiB cache limit.".into()); }
    let mime = response.headers().get(reqwest::header::CONTENT_TYPE).and_then(|value| value.to_str().ok()).unwrap_or("").split(';').next().unwrap_or("");
    let extension = match mime {
        "image/jpeg" => "jpg",
        "image/png" => "png",
        "image/webp" => "webp",
        _ => return Err("IGDB returned an unsupported artwork format.".into()),
    };
    let bytes = response.bytes().await.map_err(|error| format!("Unable to read downloaded artwork: {error}"))?;
    if bytes.is_empty() || bytes.len() > MAX_IMAGE_BYTES { return Err("IGDB artwork has an invalid size.".into()); }
    let path = path.with_extension(extension);
    fs::write(&path, &bytes).map_err(|error| format!("Unable to save artwork in Mochi's config folder: {error}"))?;
    data_url(&path)
}

#[tauri::command]
pub fn get_cached_game_artwork(app: AppHandle, cache_key: String) -> Result<Option<String>, String> {
    let base = cache_path(&app, &cache_key)?;
    let Some(path) = fs::read_dir(base.parent().unwrap_or_else(|| std::path::Path::new("."))).ok()
        .and_then(|entries| entries.flatten().find(|entry| entry.path().file_stem().and_then(|v| v.to_str()) == Some(cache_key.as_str())).map(|entry| entry.path())) else { return Ok(None) };
    data_url(&path).map(Some)
}

#[tauri::command]
pub fn clear_game_artwork_cache(app: AppHandle) -> Result<(), String> {
    let path = crate::themes::game_artwork_cache_dir(&app)?;
    if path.exists() { fs::remove_dir_all(&path).map_err(|error| format!("Unable to clear cached game artwork: {error}"))?; }
    Ok(())
}
