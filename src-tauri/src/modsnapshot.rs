//! Whole-Tofu snapshots: a cheap copy of the mod files in a Tofu's content folders plus its `mods.json` records, taken before
//! updates and installs, so one click can put the Tofu back to a working state.
//!
//! Layout: `<app data>/snapshots/<tofu id>/<snapshot id>/{manifest.json, mods.json, files/<folder index>/<file name>}`.
//! Files are hard-linked (to the previous snapshot's copy when the SHA-1 matches, else to the live file) and copied when the
//! filesystem cannot link, so a snapshot costs almost no disk. Only regular files with a mod/content extension directly inside
//! the given folders are touched; symlinks are never followed and nothing outside the folders is ever written.
use crate::modrinth::{content_extension, CONTENT_EXTENSIONS};
use crate::util::{fsio, hex, now_ms, valid_id, MutexExt};
use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{Read, Write},
    os::unix::fs::MetadataExt,
    path::{Component, Path, PathBuf},
    sync::{atomic::{AtomicU64, Ordering}, Mutex},
};

/// Error prefix for "this Tofu is too big to snapshot"; the frontend carries on without a snapshot in that case.
pub const TOO_LARGE: &str = "snapshot-too-large:";
/// Error prefix for "there is nothing to snapshot yet" (no folder exists), which callers treat as fine.
pub const EMPTY: &str = "snapshot-empty:";
const DEFAULT_KEEP: usize = 5;
const DEFAULT_CAP_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_FOLDERS: usize = 8;
const MAX_FILES: usize = 20_000;

#[derive(Debug, Clone, Copy)]
pub struct Limits { pub keep: usize, pub cap_bytes: u64 }
pub const DEFAULT_LIMITS: Limits = Limits { keep: DEFAULT_KEEP, cap_bytes: DEFAULT_CAP_BYTES };

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct SnapFile {
    folder: usize, name: String, size: u64, sha1: String,
    /// Modification time (ns) when taken; with the inode it tells whether a hard-linked file was edited in place since.
    #[serde(default)]
    mtime: u64,
}

impl SnapFile { fn same_content(&self, other: &SnapFile) -> bool { (self.folder, &self.name, self.size, &self.sha1) == (other.folder, &other.name, other.size, &other.sha1) } }

fn mtime_ns(meta: &fs::Metadata) -> u64 { meta.mtime().max(0) as u64 * 1_000_000_000 + meta.mtime_nsec().max(0) as u64 }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Manifest {
    version: u32, id: String, tofu_id: String, created_at: u64, reason: String,
    /// Created by a restore (the "before restore" safety copy); never counts as the "last working state".
    is_restore: bool,
    /// Canonical folder paths; `SnapFile::folder` indexes this list.
    folders: Vec<String>,
    files: Vec<SnapFile>,
    has_records: bool,
    records_sha1: Option<String>,
}

impl Default for Manifest {
    fn default() -> Self { Self { version: 1, id: String::new(), tofu_id: String::new(), created_at: 0, reason: String::new(), is_restore: false, folders: Vec::new(), files: Vec::new(), has_records: false, records_sha1: None } }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotInfo {
    pub id: String, pub created_at: u64, pub reason: String, pub is_restore: bool,
    /// Mod and content files in the snapshot.
    pub files: usize,
    /// Logical size of those files in bytes (hard links make the real disk use much smaller).
    pub size: u64,
    pub folders: usize,
    /// Nothing changed since the latest snapshot, so that one was returned instead of storing a duplicate.
    pub reused: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RestoreReport { pub restored: usize, pub removed: usize, pub unchanged: usize, pub safety_snapshot_id: String }

fn info(manifest: &Manifest, reused: bool) -> SnapshotInfo {
    SnapshotInfo { id: manifest.id.clone(), created_at: manifest.created_at, reason: manifest.reason.clone(), is_restore: manifest.is_restore, files: manifest.files.len(), size: manifest.files.iter().map(|f| f.size).sum(), folders: manifest.folders.len(), reused }
}

fn op_lock() -> std::sync::MutexGuard<'static, ()> {
    static LOCK: Mutex<()> = Mutex::new(());
    LOCK.lock_recover()
}

// ---------------------------------------------------------------------------
// Paths and validation
// ---------------------------------------------------------------------------

fn tofu_snapshots(data: &Path, tofu_id: &str) -> Result<PathBuf, String> {
    if !valid_id(tofu_id, 120) { return Err("Invalid Tofu id.".into()); }
    Ok(data.join("snapshots").join(tofu_id))
}

fn records_file(data: &Path, tofu_id: &str) -> PathBuf { data.join("instances").join(tofu_id).join("mods.json") }

fn safe_name(name: &str) -> bool { !name.is_empty() && name.len() < 256 && !name.contains(['/', '\\', '\0']) && name != "." && name != ".." && !name.starts_with('.') }

/// A folder Mochi may snapshot or restore into: absolute, no `..`, a real directory (not a symlink itself), not a filesystem
/// root and not inside Mochi's own snapshot store. Returns the canonical path, or None when it does not exist.
fn validate_folder(data: &Path, path: &str, create: bool) -> Result<Option<PathBuf>, String> {
    let raw = PathBuf::from(path);
    if !raw.is_absolute() { return Err("Snapshot folders must be absolute paths.".into()); }
    if raw.components().any(|c| matches!(c, Component::ParentDir | Component::CurDir)) { return Err("Paths may not contain '..'.".into()); }
    match fs::symlink_metadata(&raw) {
        Ok(meta) if meta.file_type().is_symlink() => return Err(format!("{path} is a symlink; Mochi will not follow it.")),
        Ok(meta) if !meta.is_dir() => return Err(format!("{path} is not a folder.")),
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            if !create { return Ok(None); }
            fs::create_dir_all(&raw).map_err(|e| format!("Unable to create {path}: {e}"))?;
        }
        Err(error) => return Err(format!("Unable to read {path}: {error}")),
    }
    let canonical = raw.canonicalize().map_err(|e| format!("Unable to resolve {path}: {e}"))?;
    if canonical.components().filter(|c| matches!(c, Component::Normal(_))).count() < 2 { return Err("That folder is too close to the filesystem root.".into()); }
    let store = data.join("snapshots");
    if canonical.starts_with(store.canonicalize().unwrap_or(store)) { return Err("Snapshots cannot include their own storage.".into()); }
    Ok(Some(canonical))
}

/// Regular mod/content files directly in `dir` (symlinks and sub-folders are skipped), as (name, path, size).
fn scan_folder(dir: &Path) -> Result<Vec<(String, PathBuf, u64)>, String> {
    let mut out = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| format!("Unable to read {}: {e}", dir.display()))?.flatten() {
        let Ok(kind) = entry.file_type() else { continue };
        let name = entry.file_name().to_string_lossy().into_owned();
        if !kind.is_file() || !safe_name(&name) || !CONTENT_EXTENSIONS.contains(&content_extension(&name).as_str()) { continue; }
        let Ok(meta) = entry.metadata() else { continue };
        out.push((name, entry.path(), meta.len()));
    }
    out.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(out)
}

fn sha1_of(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|e| format!("Unable to read {}: {e}", path.display()))?;
    let (mut hasher, mut buf) = (Sha1::new(), vec![0u8; 64 * 1024]);
    loop {
        let n = file.read(&mut buf).map_err(|e| format!("Unable to read {}: {e}", path.display()))?;
        if n == 0 { break; }
        hasher.update(&buf[..n]);
    }
    Ok(hex(&hasher.finalize()))
}

fn same_inode(a: &Path, b: &Path) -> bool {
    match (fs::symlink_metadata(a), fs::symlink_metadata(b)) { (Ok(x), Ok(y)) => x.dev() == y.dev() && x.ino() == y.ino(), _ => false }
}

fn stored_path(dir: &Path, folder: usize, name: &str) -> PathBuf { dir.join("files").join(folder.to_string()).join(name) }

// ---------------------------------------------------------------------------
// Manifests
// ---------------------------------------------------------------------------

fn load_manifest(dir: &Path) -> Option<Manifest> {
    let manifest: Manifest = serde_json::from_slice(&fs::read(dir.join("manifest.json")).ok()?).ok()?;
    let id_ok = dir.file_name().and_then(|n| n.to_str()) == Some(manifest.id.as_str());
    let files_ok = manifest.files.len() <= MAX_FILES && manifest.files.iter().all(|f| f.folder < manifest.folders.len() && safe_name(&f.name));
    (id_ok && valid_id(&manifest.id, 80) && manifest.folders.len() <= MAX_FOLDERS && files_ok).then_some(manifest)
}

/// Snapshots of a Tofu, oldest first. Unfinished `.tmp-*` leftovers are removed.
fn load_all(dir: &Path) -> Vec<Manifest> {
    let mut out = Vec::new();
    let Ok(entries) = fs::read_dir(dir) else { return out };
    for entry in entries.flatten() {
        let path = entry.path();
        if entry.file_name().to_string_lossy().starts_with(".tmp-") { let _ = fs::remove_dir_all(&path); continue; }
        if let Some(manifest) = load_manifest(&path) { out.push(manifest); }
    }
    out.sort_by(|a, b| (a.created_at, &a.id).cmp(&(b.created_at, &b.id)));
    out
}

fn unique_bytes(all: &[Manifest]) -> u64 {
    let mut seen = HashSet::new();
    all.iter().flat_map(|m| m.files.iter()).filter(|f| seen.insert(f.sha1.clone())).map(|f| f.size).sum()
}

/// Drops the oldest snapshots beyond `keep`, then while the real (de-duplicated) size exceeds the cap; never `protect` or the newest.
fn prune(dir: &Path, limits: &Limits, protect: Option<&str>) {
    let mut all = load_all(dir);
    let drop_oldest = |all: &mut Vec<Manifest>| -> bool {
        let Some(pos) = all.iter().position(|m| Some(m.id.as_str()) != protect) else { return false };
        if pos + 1 >= all.len() { return false; }
        let gone = all.remove(pos);
        let _ = fs::remove_dir_all(dir.join(&gone.id));
        true
    };
    while all.len() > limits.keep.max(1) { if !drop_oldest(&mut all) { break; } }
    while all.len() > 1 && unique_bytes(&all) > limits.cap_bytes { if !drop_oldest(&mut all) { break; } }
}

fn new_id() -> String {
    static SEQ: AtomicU64 = AtomicU64::new(0);
    format!("{}-{:03}", now_ms(), SEQ.fetch_add(1, Ordering::Relaxed) % 1000)
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

struct CreateOptions<'a> { is_restore: bool, force: bool, protect: Option<&'a str> }

fn create_in(data: &Path, tofu_id: &str, folders: &[String], reason: &str, options: CreateOptions, limits: &Limits) -> Result<SnapshotInfo, String> {
    let dir = tofu_snapshots(data, tofu_id)?;
    if folders.len() > MAX_FOLDERS { return Err("Too many folders for one snapshot.".into()); }
    let mut canonical: Vec<PathBuf> = Vec::new();
    for folder in folders {
        if let Some(path) = validate_folder(data, folder, false)? { if !canonical.contains(&path) { canonical.push(path); } }
    }
    if canonical.is_empty() { return Err(format!("{EMPTY} there is no mod folder to snapshot yet.")); }
    fs::create_dir_all(&dir).map_err(|e| format!("Unable to create the snapshot folder: {e}"))?;
    let existing = load_all(&dir);
    let latest = existing.last();

    // What the newest snapshot already holds, by (folder path, name) and by hash.
    let mut by_slot: HashMap<(String, String), (&SnapFile, PathBuf)> = HashMap::new();
    let mut by_sha: HashMap<&str, PathBuf> = HashMap::new();
    for manifest in &existing {
        for file in &manifest.files {
            let path = stored_path(&dir.join(&manifest.id), file.folder, &file.name);
            if manifest.id == latest.map(|m| m.id.as_str()).unwrap_or_default() { by_slot.insert((manifest.folders[file.folder].clone(), file.name.clone()), (file, path.clone())); }
            by_sha.entry(file.sha1.as_str()).or_insert(path);
        }
    }

    let mut files: Vec<SnapFile> = Vec::new();
    let mut sources: Vec<PathBuf> = Vec::new();
    let mut total = 0u64;
    for (index, folder) in canonical.iter().enumerate() {
        for (name, path, size) in scan_folder(folder)? {
            let mtime = fs::symlink_metadata(&path).map(|m| mtime_ns(&m)).unwrap_or(0);
            total += size;
            if total > limits.cap_bytes { return Err(format!("{TOO_LARGE} the mod files are larger than the {} MB snapshot limit.", limits.cap_bytes / (1024 * 1024))); }
            if files.len() >= MAX_FILES { return Err(format!("{TOO_LARGE} too many files.")); }
            // Same file as in the newest snapshot (one inode, same size): its hash is already known, nothing to read.
            let known = by_slot.get(&(folder.to_string_lossy().into_owned(), name.clone())).filter(|(f, stored)| f.size == size && f.mtime == mtime && same_inode(&path, stored)).map(|(f, _)| f.sha1.clone());
            let sha1 = match known { Some(sha) => sha, None => sha1_of(&path)? };
            files.push(SnapFile { folder: index, name, size, sha1, mtime });
            sources.push(path);
        }
    }
    let records = records_file(data, tofu_id);
    let record_bytes = fs::read(&records).ok();
    let records_sha1 = record_bytes.as_ref().map(|bytes| hex(&Sha1::digest(bytes)));
    let folder_strings: Vec<String> = canonical.iter().map(|p| p.to_string_lossy().into_owned()).collect();

    if !options.force {
        if let Some(last) = latest.filter(|m| m.folders == folder_strings && m.files.len() == files.len() && m.files.iter().zip(&files).all(|(a, b)| a.same_content(b)) && m.records_sha1 == records_sha1 && !m.is_restore) {
            return Ok(info(last, true));
        }
    }

    let id = new_id();
    let manifest = Manifest { id: id.clone(), tofu_id: tofu_id.to_string(), created_at: now_ms(), reason: reason.chars().take(120).collect(), is_restore: options.is_restore, folders: folder_strings, files, has_records: record_bytes.is_some(), records_sha1, ..Manifest::default() };
    let temp = dir.join(format!(".tmp-{id}"));
    let built = (|| -> Result<(), String> {
        for index in 0..canonical.len() { fs::create_dir_all(temp.join("files").join(index.to_string())).map_err(|e| format!("Unable to create the snapshot: {e}"))?; }
        for (file, source) in manifest.files.iter().zip(&sources) {
            let dest = stored_path(&temp, file.folder, &file.name);
            let reuse = by_sha.get(file.sha1.as_str()).filter(|p| fs::metadata(p).map(|m| m.len() == file.size).unwrap_or(false));
            let linked = reuse.is_some_and(|prev| fs::hard_link(prev, &dest).is_ok()) || fs::hard_link(source, &dest).is_ok();
            if !linked {
                fs::copy(source, &dest).map_err(|e| format!("Unable to copy {}: {e}", file.name))?;
                if sha1_of(&dest)? != file.sha1 { return Err(format!("{} changed while it was being copied.", file.name)); }
            }
        }
        if let Some(bytes) = &record_bytes { fs::write(temp.join("mods.json"), bytes).map_err(|e| format!("Unable to save the records: {e}"))?; }
        let json = serde_json::to_vec_pretty(&manifest).map_err(|e| e.to_string())?;
        fsio::write_atomic_durable(&temp.join("manifest.json"), &json).map_err(|e| format!("Unable to save the snapshot: {e}"))?;
        fs::rename(&temp, dir.join(&id)).map_err(|e| format!("Unable to save the snapshot: {e}"))
    })();
    if let Err(error) = built { let _ = fs::remove_dir_all(&temp); return Err(error); }
    prune(&dir, limits, options.protect);
    Ok(info(&manifest, false))
}

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

/// Checks that every stored file of the snapshot is present and has the recorded size and SHA-1 (before anything is changed).
fn verify_snapshot(dir: &Path, manifest: &Manifest) -> Result<(), String> {
    for file in &manifest.files {
        let path = stored_path(dir, file.folder, &file.name);
        let meta = fs::symlink_metadata(&path).map_err(|_| format!("The snapshot is damaged: {} is missing.", file.name))?;
        if !meta.is_file() || meta.len() != file.size || sha1_of(&path)? != file.sha1 { return Err(format!("The snapshot is damaged: {} does not match.", file.name)); }
    }
    if manifest.has_records && !dir.join("mods.json").is_file() { return Err("The snapshot is damaged: its records are missing.".into()); }
    Ok(())
}

/// Copies `from` to `to` through a temp file in the destination folder, checking the SHA-1 before the rename replaces anything.
fn copy_verified(from: &Path, to: &Path, sha1: &str) -> Result<(), String> {
    let name = to.file_name().and_then(|n| n.to_str()).unwrap_or("file");
    let temp = to.with_file_name(format!(".{name}.mochi-restore.tmp"));
    let result = (|| -> Result<(), String> {
        let mut src = fs::File::open(from).map_err(|e| format!("Unable to read {}: {e}", from.display()))?;
        let mut dst = fs::File::create(&temp).map_err(|e| format!("Unable to write {name}: {e}"))?;
        let (mut hasher, mut buf) = (Sha1::new(), vec![0u8; 64 * 1024]);
        loop {
            let n = src.read(&mut buf).map_err(|e| format!("Unable to read {name}: {e}"))?;
            if n == 0 { break; }
            hasher.update(&buf[..n]);
            dst.write_all(&buf[..n]).map_err(|e| format!("Unable to write {name}: {e}"))?;
        }
        dst.sync_all().map_err(|e| format!("Unable to write {name}: {e}"))?;
        if hex(&hasher.finalize()) != sha1 { return Err(format!("{name} did not match its saved checksum.")); }
        fs::rename(&temp, to).map_err(|e| format!("Unable to replace {name}: {e}"))
    })();
    if result.is_err() { let _ = fs::remove_file(&temp); }
    result
}

#[derive(Default)]
struct Applied { restored: usize, removed: usize, unchanged: usize }

/// Makes the manifest's folders (and the Tofu's records) match the snapshot exactly.
fn apply_snapshot(data: &Path, dir: &Path, manifest: &Manifest) -> Result<Applied, String> {
    let mut stats = Applied::default();
    let mut folders = Vec::new();
    for folder in &manifest.folders {
        let path = validate_folder(data, folder, true)?.ok_or("A snapshot folder is missing.")?;
        if path.to_string_lossy() != folder.as_str() { return Err(format!("{folder} now points somewhere else; not restoring into it.")); }
        folders.push(path);
    }
    let mut copied: Vec<(PathBuf, &SnapFile)> = Vec::new();
    for (index, folder) in folders.iter().enumerate() {
        let wanted: HashMap<&str, &SnapFile> = manifest.files.iter().filter(|f| f.folder == index).map(|f| (f.name.as_str(), f)).collect();
        let current = scan_folder(folder)?;
        for (name, file) in &wanted {
            let (dest, stored) = (folder.join(name), stored_path(dir, index, name));
            let present = current.iter().find(|(n, _, _)| n == name);
            if let Some((_, path, size)) = present {
                if same_inode(path, &stored) || (*size == file.size && sha1_of(path)? == file.sha1) { stats.unchanged += 1; continue; }
            }
            copy_verified(&stored, &dest, &file.sha1)?;
            copied.push((dest, file));
            stats.restored += 1;
        }
        // Files that are not in the snapshot: the "before restore" snapshot already holds them, so they can go.
        for (name, path, _) in &current {
            if wanted.contains_key(name.as_str()) { continue; }
            fs::remove_file(path).map_err(|e| format!("Unable to remove {name}: {e}"))?;
            stats.removed += 1;
        }
    }
    for (path, file) in &copied {
        if sha1_of(path)? != file.sha1 { return Err(format!("{} did not verify after restoring.", file.name)); }
    }
    let target = records_file(data, &manifest.tofu_id);
    let _guard = crate::modinstance::lock();
    if manifest.has_records {
        let bytes = fs::read(dir.join("mods.json")).map_err(|e| format!("Unable to read the saved records: {e}"))?;
        if let Some(parent) = target.parent() { fs::create_dir_all(parent).map_err(|e| format!("Unable to restore the records: {e}"))?; }
        fsio::write_atomic_durable(&target, &bytes).map_err(|e| format!("Unable to restore the records: {e}"))?;
    } else if target.exists() {
        fs::remove_file(&target).map_err(|e| format!("Unable to restore the records: {e}"))?;
    }
    Ok(stats)
}

fn restore_in(data: &Path, tofu_id: &str, snapshot_id: &str, limits: &Limits) -> Result<RestoreReport, String> {
    let root = tofu_snapshots(data, tofu_id)?;
    if !valid_id(snapshot_id, 80) { return Err("Invalid snapshot id.".into()); }
    let dir = root.join(snapshot_id);
    let manifest = load_manifest(&dir).filter(|m| m.tofu_id == tofu_id).ok_or("That snapshot no longer exists.")?;
    verify_snapshot(&dir, &manifest)?;
    // Everything now in the folders goes into a safety snapshot first, so a restore can itself be undone.
    let safety = create_in(data, tofu_id, &manifest.folders, "Before restore", CreateOptions { is_restore: true, force: true, protect: Some(snapshot_id) }, limits)
        .map_err(|e| format!("Nothing was changed: the current state could not be saved first ({e})."))?;
    match apply_snapshot(data, &dir, &manifest) {
        Ok(stats) => Ok(RestoreReport { restored: stats.restored, removed: stats.removed, unchanged: stats.unchanged, safety_snapshot_id: safety.id }),
        Err(error) => {
            let back = load_manifest(&root.join(&safety.id)).ok_or_else(|| format!("{error} (the safety snapshot is missing too)"))?;
            match apply_snapshot(data, &root.join(&safety.id), &back) {
                Ok(_) => Err(format!("Restore failed and was rolled back: {error}")),
                Err(second) => Err(format!("Restore failed ({error}) and the rollback did not finish ({second}). Your previous files are in snapshot {}.", safety.id)),
            }
        }
    }
}

fn list_in(data: &Path, tofu_id: &str) -> Result<Vec<SnapshotInfo>, String> {
    let dir = tofu_snapshots(data, tofu_id)?;
    let mut all: Vec<SnapshotInfo> = load_all(&dir).iter().map(|m| info(m, false)).collect();
    all.reverse();
    Ok(all)
}

fn delete_in(data: &Path, tofu_id: &str, snapshot_id: &str) -> Result<(), String> {
    let dir = tofu_snapshots(data, tofu_id)?;
    if !valid_id(snapshot_id, 80) { return Err("Invalid snapshot id.".into()); }
    let target = dir.join(snapshot_id);
    if load_manifest(&target).is_none() { return Err("That snapshot no longer exists.".into()); }
    fs::remove_dir_all(&target).map_err(|e| format!("Unable to delete the snapshot: {e}"))
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

fn data() -> Result<PathBuf, String> { crate::modinstance::data_dir().ok_or_else(|| "Mochi is still starting.".to_string()) }

#[tauri::command]
pub async fn create_tofu_snapshot(tofu_id: String, folders: Vec<String>, reason: String) -> Result<SnapshotInfo, String> {
    let data = data()?;
    crate::util::blocking(move || { let _guard = op_lock(); create_in(&data, &tofu_id, &folders, &reason, CreateOptions { is_restore: false, force: false, protect: None }, &DEFAULT_LIMITS) }).await?
}

#[tauri::command]
pub async fn list_tofu_snapshots(tofu_id: String) -> Result<Vec<SnapshotInfo>, String> {
    let data = data()?;
    crate::util::blocking(move || { let _guard = op_lock(); list_in(&data, &tofu_id) }).await?
}

#[tauri::command]
pub async fn restore_tofu_snapshot(tofu_id: String, snapshot_id: String) -> Result<RestoreReport, String> {
    let data = data()?;
    crate::util::blocking(move || { let _guard = op_lock(); restore_in(&data, &tofu_id, &snapshot_id, &DEFAULT_LIMITS) }).await?
}

#[tauri::command]
pub async fn delete_tofu_snapshot(tofu_id: String, snapshot_id: String) -> Result<(), String> {
    let data = data()?;
    crate::util::blocking(move || { let _guard = op_lock(); delete_in(&data, &tofu_id, &snapshot_id) }).await?
}

#[cfg(test)]
mod tests {
    use super::*;

    const BIG: Limits = Limits { keep: 5, cap_bytes: 1 << 30 };

    struct Env { data: PathBuf, mods: PathBuf, packs: PathBuf }

    fn env(name: &str) -> Env {
        let base = std::env::temp_dir().join(format!("mochi-snap-{name}-{}-{}", std::process::id(), now_ms()));
        let _ = fs::remove_dir_all(&base);
        let (data, mods, packs) = (base.join("data"), base.join("game").join("mods"), base.join("game").join("resourcepacks"));
        for dir in [&data, &mods, &packs] { fs::create_dir_all(dir).unwrap(); }
        Env { data: data.canonicalize().unwrap(), mods: mods.canonicalize().unwrap(), packs: packs.canonicalize().unwrap() }
    }

    fn folders(e: &Env) -> Vec<String> { vec![e.mods.to_string_lossy().into(), e.packs.to_string_lossy().into()] }
    fn write(dir: &Path, name: &str, body: &str) { fs::write(dir.join(name), body).unwrap(); }
    fn read(dir: &Path, name: &str) -> String { fs::read_to_string(dir.join(name)).unwrap() }
    fn snap(e: &Env, reason: &str, limits: &Limits) -> Result<SnapshotInfo, String> {
        create_in(&e.data, "tofu-1", &folders(e), reason, CreateOptions { is_restore: false, force: false, protect: None }, limits)
    }
    fn replace(dir: &Path, name: &str, body: &str) { let _ = fs::remove_file(dir.join(name)); write(dir, name, body); }
    fn names(dir: &Path) -> Vec<String> { scan_folder(dir).unwrap().into_iter().map(|f| f.0).collect() }

    #[test]
    fn create_hardlinks_and_dedupes_against_the_previous_snapshot() {
        let e = env("create");
        write(&e.mods, "a.jar", "alpha"); write(&e.mods, "b.jar.disabled", "beta"); write(&e.packs, "p.zip", "pack"); write(&e.mods, "notes.txt", "ignored");
        let first = snap(&e, "one", &BIG).unwrap();
        assert_eq!((first.files, first.size, first.folders), (3, 13, 2));
        let root = tofu_snapshots(&e.data, "tofu-1").unwrap();
        // Hard-linked to the live file: same inode, so no extra disk.
        assert!(same_inode(&e.mods.join("a.jar"), &stored_path(&root.join(&first.id), 0, "a.jar")));
        // A new copy of the same bytes under another inode: the next snapshot links to the previous snapshot's file.
        fs::remove_file(e.mods.join("a.jar")).unwrap(); write(&e.mods, "a.jar", "alpha"); write(&e.mods, "c.jar", "gamma");
        let second = snap(&e, "two", &BIG).unwrap();
        assert!(!second.reused);
        assert!(same_inode(&stored_path(&root.join(&first.id), 0, "a.jar"), &stored_path(&root.join(&second.id), 0, "a.jar")));
        assert!(same_inode(&e.mods.join("c.jar"), &stored_path(&root.join(&second.id), 0, "c.jar")));
        assert!(!stored_path(&root.join(&second.id), 0, "notes.txt").exists());
        // The records file is stored beside the manifest when it exists.
        assert_eq!(list_in(&e.data, "tofu-1").unwrap().len(), 2);
    }

    #[test]
    fn an_unchanged_tofu_reuses_the_latest_snapshot() {
        let e = env("reuse");
        write(&e.mods, "a.jar", "alpha");
        let first = snap(&e, "one", &BIG).unwrap();
        let again = snap(&e, "two", &BIG).unwrap();
        assert!(again.reused && again.id == first.id);
        replace(&e.mods, "a.jar", "alpha2");
        assert!(!snap(&e, "three", &BIG).unwrap().reused);
        assert_eq!(list_in(&e.data, "tofu-1").unwrap().len(), 2);
    }

    #[test]
    fn only_the_newest_snapshots_are_kept() {
        let e = env("keep");
        let limits = Limits { keep: 3, cap_bytes: 1 << 30 };
        let mut ids = Vec::new();
        for n in 0..5 { replace(&e.mods, "a.jar", &format!("v{n}")); ids.push(snap(&e, "x", &limits).unwrap().id); }
        let left: Vec<String> = list_in(&e.data, "tofu-1").unwrap().into_iter().map(|s| s.id).collect();
        assert_eq!(left, vec![ids[4].clone(), ids[3].clone(), ids[2].clone()]);
    }

    #[test]
    fn the_size_cap_refuses_a_big_snapshot_and_prunes_old_ones() {
        let e = env("cap");
        let limits = Limits { keep: 10, cap_bytes: 30 };
        write(&e.mods, "a.jar", &"a".repeat(20));
        let first = snap(&e, "one", &limits).unwrap();
        replace(&e.mods, "a.jar", &"b".repeat(20));
        snap(&e, "two", &limits).unwrap();
        // 20 + 20 unique bytes is over the cap of 30, so the oldest goes.
        let left = list_in(&e.data, "tofu-1").unwrap();
        assert_eq!(left.len(), 1);
        assert!(left.iter().all(|s| s.id != first.id));
        write(&e.mods, "big.jar", &"c".repeat(40));
        let error = snap(&e, "three", &limits).unwrap_err();
        assert!(error.starts_with(TOO_LARGE), "{error}");
        assert_eq!(list_in(&e.data, "tofu-1").unwrap().len(), 1);
        assert!(!tofu_snapshots(&e.data, "tofu-1").unwrap().read_dir().unwrap().flatten().any(|d| d.file_name().to_string_lossy().starts_with(".tmp-")));
    }

    #[test]
    fn restore_makes_the_folders_and_records_match_exactly() {
        let e = env("restore");
        write(&e.mods, "a.jar", "alpha"); write(&e.mods, "b.jar.disabled", "beta"); write(&e.packs, "p.zip", "pack"); write(&e.mods, "keep.txt", "not a mod");
        let records = records_file(&e.data, "tofu-1");
        fs::create_dir_all(records.parent().unwrap()).unwrap(); fs::write(&records, "{\"version\":1,\"mods\":[]}").unwrap();
        let good = snap(&e, "good", &BIG).unwrap();
        // Break the Tofu: a changed file (in place, which also edits the hard-linked snapshot copy? no: replace it), a removed one, an extra one.
        fs::remove_file(e.mods.join("a.jar")).unwrap(); write(&e.mods, "a.jar", "ALPHA-NEW");
        fs::remove_file(e.mods.join("b.jar.disabled")).unwrap();
        write(&e.mods, "extra.jar", "extra"); fs::remove_file(e.packs.join("p.zip")).unwrap();
        fs::write(&records, "{\"version\":1,\"mods\":[{\"file\":\"extra.jar\"}]}").unwrap();
        let report = restore_in(&e.data, "tofu-1", &good.id, &BIG).unwrap();
        assert_eq!((report.restored, report.removed), (3, 1));
        assert_eq!(read(&e.mods, "a.jar"), "alpha");
        assert_eq!(read(&e.mods, "b.jar.disabled"), "beta");
        assert_eq!(read(&e.packs, "p.zip"), "pack");
        assert_eq!(names(&e.mods), vec!["a.jar".to_string(), "b.jar.disabled".to_string()]);
        assert_eq!(read(&e.mods, "keep.txt"), "not a mod");
        assert_eq!(fs::read_to_string(&records).unwrap(), "{\"version\":1,\"mods\":[]}");
        // The state before the restore is kept as a safety snapshot that is not "a working state".
        let all = list_in(&e.data, "tofu-1").unwrap();
        let safety = all.iter().find(|s| s.id == report.safety_snapshot_id).unwrap();
        assert!(safety.is_restore && safety.reason == "Before restore");
        // And restoring that safety snapshot brings the broken state back.
        restore_in(&e.data, "tofu-1", &safety.id, &BIG).unwrap();
        assert_eq!(read(&e.mods, "a.jar"), "ALPHA-NEW");
        assert!(e.mods.join("extra.jar").is_file() && !e.packs.join("p.zip").exists());
    }

    #[test]
    fn a_damaged_snapshot_is_refused_before_anything_changes() {
        let e = env("damaged");
        write(&e.mods, "a.jar", "alpha");
        let good = snap(&e, "good", &BIG).unwrap();
        let stored = stored_path(&tofu_snapshots(&e.data, "tofu-1").unwrap().join(&good.id), 0, "a.jar");
        // Corrupt the stored copy (it is the same inode as the live file, so break the link first).
        fs::remove_file(e.mods.join("a.jar")).unwrap(); fs::copy(&stored, e.mods.join("a.jar")).unwrap();
        fs::write(&stored, "alphX").unwrap();
        write(&e.mods, "new.jar", "new");
        let error = restore_in(&e.data, "tofu-1", &good.id, &BIG).unwrap_err();
        assert!(error.contains("damaged"), "{error}");
        assert!(e.mods.join("new.jar").is_file());
        assert_eq!(list_in(&e.data, "tofu-1").unwrap().len(), 1);
    }

    #[test]
    fn a_failure_midway_rolls_back_to_the_safety_snapshot() {
        let e = env("rollback");
        write(&e.mods, "a.jar", "alpha"); write(&e.mods, "z.jar", "zeta");
        let good = snap(&e, "good", &BIG).unwrap();
        fs::remove_file(e.mods.join("a.jar")).unwrap(); write(&e.mods, "a.jar", "changed");
        // z.jar's slot is now a directory: the copy cannot replace it, which fails after a.jar was already restored.
        fs::remove_file(e.mods.join("z.jar")).unwrap(); fs::create_dir(e.mods.join("z.jar")).unwrap();
        write(&e.mods, "extra.jar", "extra");
        let error = restore_in(&e.data, "tofu-1", &good.id, &BIG).unwrap_err();
        assert!(error.contains("rolled back"), "{error}");
        assert_eq!(read(&e.mods, "a.jar"), "changed");
        assert_eq!(read(&e.mods, "extra.jar"), "extra");
        assert!(e.mods.join("z.jar").is_dir());
        assert!(!e.mods.join(".a.jar.mochi-restore.tmp").exists());
    }

    #[test]
    fn folders_are_validated() {
        let e = env("paths");
        write(&e.mods, "a.jar", "alpha");
        let create = |folders: Vec<String>| create_in(&e.data, "tofu-1", &folders, "x", CreateOptions { is_restore: false, force: false, protect: None }, &BIG);
        assert!(create(vec!["relative/mods".into()]).is_err());
        assert!(create(vec![format!("{}/../mods", e.mods.display())]).is_err());
        assert!(create(vec!["/".into()]).is_err());
        assert!(create(vec![e.mods.join("a.jar").to_string_lossy().into()]).unwrap_err().contains("not a folder"));
        assert!(create(vec![e.data.join("snapshots").to_string_lossy().into()]).is_err());
        assert!(create(vec![e.mods.join("missing").to_string_lossy().into()]).unwrap_err().contains("no mod folder"));
        assert!(tofu_snapshots(&e.data, "../evil").is_err());
        assert!(restore_in(&e.data, "tofu-1", "../x", &BIG).is_err() && delete_in(&e.data, "tofu-1", "..").is_err());
    }

    #[test]
    fn symlinks_are_never_followed() {
        let e = env("links");
        let outside = e.data.parent().unwrap().join("outside");
        fs::create_dir_all(&outside).unwrap(); write(&outside, "secret.jar", "secret");
        write(&e.mods, "a.jar", "alpha");
        std::os::unix::fs::symlink(outside.join("secret.jar"), e.mods.join("link.jar")).unwrap();
        std::os::unix::fs::symlink(&outside, e.mods.join("linked-dir")).unwrap();
        let link_folder = e.data.parent().unwrap().join("game").join("linked");
        std::os::unix::fs::symlink(&outside, &link_folder).unwrap();
        // A folder that is itself a symlink is refused.
        let error = create_in(&e.data, "tofu-1", &[link_folder.to_string_lossy().into()], "x", CreateOptions { is_restore: false, force: false, protect: None }, &BIG).unwrap_err();
        assert!(error.contains("symlink"), "{error}");
        // Symlinked files inside a real folder are skipped, not stored.
        let made = snap(&e, "x", &BIG).unwrap();
        assert_eq!(made.files, 1);
        // Restore never deletes through a link either.
        restore_in(&e.data, "tofu-1", &made.id, &BIG).unwrap();
        assert!(outside.join("secret.jar").is_file() && e.mods.join("link.jar").exists());
    }

    #[test]
    fn delete_removes_only_that_snapshot() {
        let e = env("delete");
        write(&e.mods, "a.jar", "alpha");
        let first = snap(&e, "one", &BIG).unwrap();
        write(&e.mods, "b.jar", "beta");
        let second = snap(&e, "two", &BIG).unwrap();
        delete_in(&e.data, "tofu-1", &first.id).unwrap();
        let left = list_in(&e.data, "tofu-1").unwrap();
        assert_eq!(left.len(), 1);
        assert_eq!(left[0].id, second.id);
        assert!(delete_in(&e.data, "tofu-1", &first.id).is_err());
        // The surviving snapshot still restores (its files are separate links).
        fs::remove_file(e.mods.join("a.jar")).unwrap();
        restore_in(&e.data, "tofu-1", &second.id, &BIG).unwrap();
        assert_eq!(read(&e.mods, "a.jar"), "alpha");
    }
}
