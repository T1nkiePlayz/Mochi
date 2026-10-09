//! Identifying mods that are already installed (a game imported with a full mods folder): hashes for every site,
//! the Modrinth lookup by SHA-1, and writing the results into the Tofu's records in one go. The CurseForge
//! (fingerprint) and Nexus Mods (MD5) lookups run in the frontend through Mochi's edge functions, which hold the keys.
use crate::modinstance::{base_name, instances_root, load_records, lock, save_records, ModRecord, RecordInput, CONTENT_SUBDIRS};
use crate::modrinth::validate_content_path;
use crate::util::valid_id;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{collections::HashMap, path::Path};

const MAX_FILES: usize = 2000;
const MAX_HASH_BYTES: u64 = 512 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HashedFile {
    pub path: String,
    pub filename: String,
    pub size: u64,
    pub sha1: String,
    pub md5: String,
    /// CurseForge fingerprint (MurmurHash2 of the file without whitespace bytes).
    pub fingerprint: u32,
}

/// SHA-1, MD5 and CurseForge fingerprint of each mod file. Files that cannot be read (or are huge) are skipped.
#[tauri::command]
pub async fn hash_mod_files(paths: Vec<String>) -> Result<Vec<HashedFile>, String> {
    if paths.len() > MAX_FILES { return Err("Too many files at once.".into()); }
    crate::util::blocking(move || hash_paths(&paths)).await
}

/// Hashes the files on a few threads (each file is independent), keeping the input order.
fn hash_paths(paths: &[String]) -> Vec<HashedFile> {
    let hash_one = |path: &String| -> Option<HashedFile> {
        let file = validate_content_path(path).ok()?;
        let hashes = crate::modhash::hash_file(&file, MAX_HASH_BYTES).ok()?;
        Some(HashedFile { path: path.clone(), filename: file.file_name()?.to_string_lossy().into_owned(), size: hashes.size, sha1: hashes.sha1, md5: hashes.md5, fingerprint: hashes.fingerprint })
    };
    let threads = std::thread::available_parallelism().map_or(2, |n| n.get()).clamp(1, 4).min(paths.len());
    if threads <= 1 { return paths.iter().filter_map(hash_one).collect(); }
    let next = std::sync::atomic::AtomicUsize::new(0);
    let mut slots: Vec<Option<HashedFile>> = (0..paths.len()).map(|_| None).collect();
    let results = std::sync::Mutex::new(&mut slots);
    std::thread::scope(|scope| {
        for _ in 0..threads {
            scope.spawn(|| loop {
                let i = next.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                let Some(path) = paths.get(i) else { break };
                let hashed = hash_one(path);
                if let Ok(mut slots) = results.lock() { slots[i] = hashed; }
            });
        }
    });
    slots.into_iter().flatten().collect()
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModrinthMatch { pub project_id: String, pub version_id: String, pub version_number: String, pub title: String, pub icon_url: Option<String>, pub date_published: String }

/// Modrinth versions of the files with these SHA-1 hashes, keyed by hash. Unknown hashes are simply missing.
#[tauri::command]
pub async fn modrinth_identify(hashes: Vec<String>) -> Result<HashMap<String, ModrinthMatch>, String> {
    let hashes: Vec<String> = hashes.into_iter().filter(|h| h.len() == 40 && h.chars().all(|c| c.is_ascii_hexdigit())).map(|h| h.to_ascii_lowercase()).take(MAX_FILES).collect();
    if hashes.is_empty() { return Ok(HashMap::new()); }
    let versions = crate::modrinth::post_versions("version_files", json!({ "hashes": hashes, "algorithm": "sha1" })).await?;
    let projects = crate::modrinth::fetch_projects(versions.values().map(|v| v.project_id.as_str()).collect()).await;
    Ok(versions.into_iter().map(|(hash, version)| {
        let project = projects.get(&version.project_id);
        (hash, ModrinthMatch {
            title: project.map(|p| p.title.clone()).unwrap_or_else(|| version.project_id.clone()), icon_url: project.and_then(|p| p.icon_url.clone()),
            project_id: version.project_id, version_id: version.id, version_number: version.version_number, date_published: version.date_published,
        })
    }).collect())
}

/// One installed file to record: what was found about it (or `source: "manual"` when nothing was).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordEntry {
    pub file: String,
    #[serde(default)]
    pub subdir: String,
    #[serde(default)]
    pub sha1: Option<String>,
    pub enabled: bool,
    pub record: RecordInput,
}

/// Merges many records at once. An identified record replaces a manual one; a manual one never replaces what is known.
pub(crate) fn record_many_in(root: &Path, tofu_id: &str, entries: Vec<RecordEntry>) -> Result<usize, String> {
    if !valid_id(tofu_id, 120) { return Err("Invalid Tofu id.".into()); }
    let _guard = lock();
    let mut records = load_records(root, tofu_id);
    let mut changed = 0;
    for entry in entries.into_iter().take(MAX_FILES) {
        let file = base_name(entry.file.trim()).to_string();
        if file.is_empty() || file.contains(['/', '\\', '\0']) || file.starts_with('.') { continue; }
        if !entry.subdir.is_empty() && !CONTENT_SUBDIRS.contains(&entry.subdir.as_str()) { continue; }
        let mut next = entry.record.into_record(&file, &entry.subdir, entry.sha1.filter(|h| h.len() == 40 && h.chars().all(|c| c.is_ascii_hexdigit())));
        next.enabled = entry.enabled;
        if next.title.is_empty() { next.title = file.clone(); }
        match records.iter_mut().find(|r| r.subdir == next.subdir && r.file == next.file) {
            Some(existing) if next.source == "manual" && existing.source != "manual" => continue,
            Some(existing) => { next.rollback = existing.rollback.take(); next.installed_at = existing.installed_at.max(1); *existing = next; changed += 1; }
            None => { records.push(next); changed += 1; }
        }
    }
    if changed > 0 { save_records(root, tofu_id, records)?; }
    Ok(changed)
}

#[tauri::command(async)]
pub fn record_instance_mods(tofu_id: String, entries: Vec<RecordEntry>) -> Result<usize, String> {
    let root = instances_root().ok_or("Mochi is still starting.")?;
    record_many_in(&root, &tofu_id, entries)
}

/// Everything Mochi remembers about a Tofu's mods (also archives that were unpacked), for "Downloaded" states.
#[tauri::command(async)]
pub fn list_instance_records(tofu_id: String) -> Result<Vec<ModRecord>, String> {
    if !valid_id(&tofu_id, 120) { return Err("Invalid Tofu id.".into()); }
    Ok(instances_root().map(|root| load_records(&root, &tofu_id)).unwrap_or_default())
}

pub(crate) fn copy_records_in(root: &Path, from: &str, to: &str) -> Result<usize, String> {
    if !valid_id(from, 120) || !valid_id(to, 120) { return Err("Invalid Tofu id.".into()); }
    let _guard = lock();
    let mut records = load_records(root, from);
    for record in &mut records { record.rollback = None; }
    let count = records.len();
    if count > 0 { save_records(root, to, records)?; }
    Ok(count)
}

/// A duplicated Tofu starts with the same mod list as the original.
#[tauri::command(async)]
pub fn copy_instance_records(from: String, to: String) -> Result<usize, String> {
    let root = instances_root().ok_or("Mochi is still starting.")?;
    copy_records_in(&root, &from, &to)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(file: &str, source: &str, project: &str) -> RecordEntry {
        RecordEntry { file: file.into(), subdir: String::new(), sha1: Some("a9993e364706816aba3e25717850c26c9cd0d89d".into()), enabled: true,
            record: RecordInput { source: source.into(), project_id: project.into(), title: String::new(), ..Default::default() } }
    }

    #[test]
    fn batch_records_merge_without_losing_identification() {
        let root = std::env::temp_dir().join(format!("mochi-scan-{}-{}", std::process::id(), crate::util::now_ms()));
        assert_eq!(record_many_in(&root, "t", vec![entry("a.jar", "curseforge", "1"), entry("b.jar", "manual", ""), entry("../x.jar", "manual", "")]).unwrap(), 2);
        // A later scan that could not identify a.jar must not wipe what is known about it.
        assert_eq!(record_many_in(&root, "t", vec![entry("a.jar", "manual", "")]).unwrap(), 0);
        // A link chosen by the user replaces the manual record.
        assert_eq!(record_many_in(&root, "t", vec![entry("b.jar.disabled", "nexus", "77")]).unwrap(), 1);
        let records = load_records(&root, "t");
        assert_eq!(records.iter().map(|r| (r.file.as_str(), r.source.as_str(), r.title.as_str())).collect::<Vec<_>>(), [("a.jar", "curseforge", "a.jar"), ("b.jar", "nexus", "b.jar")]);
        assert_eq!(records[0].sha1.as_deref(), Some("a9993e364706816aba3e25717850c26c9cd0d89d"));
        assert_eq!(copy_records_in(&root, "t", "u").unwrap(), 2);
        assert_eq!(load_records(&root, "u").len(), 2);
        assert!(copy_records_in(&root, "t", "../u").is_err());
        let _ = std::fs::remove_dir_all(&root);
    }
}
