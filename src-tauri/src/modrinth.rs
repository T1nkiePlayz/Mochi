use serde::Serialize;
use std::{fs, path::PathBuf};

#[derive(Debug, Serialize)]
pub struct InstalledModFile { pub filename: String, pub path: String, pub enabled: bool, pub size: u64 }

fn validate_path(path: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(path);
    if !p.is_absolute() { return Err("Mochi requires an absolute Tofu folder path.".into()); }
    Ok(p)
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
        else if !enabled && !name.ends_with(".disabled") { p.with_file_name(format!("{name}.disabled")) } else { p };
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
