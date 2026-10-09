//! Per-Tofu mod storage: what is installed (with where it came from), enable/disable in bulk, rollback copies
//! for updates, and the launch-time sync that copies a Tofu's mods into the folder the game really reads.
//!
//! Layout on disk:
//! - `<app data>/instances/<tofu id>/mods.json`  records (source, project, version, sha1, ...) of the Tofu's files
//! - `<app data>/instances/<tofu id>/files`      default store for a Tofu that has no folder of its own
//! - `<game mods dir>/.mochi-managed.json`        files Mochi placed there, so it never touches anything else
use crate::modrinth::{content_extension, validate_content_path, validate_path, CONTENT_EXTENSIONS};
use crate::util::{fsio, now_ms, valid_id, MutexExt};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};
use tauri::Emitter;

pub const MANAGED_FILE: &str = ".mochi-managed.json";
const ROLLBACK_DIR: &str = ".mochi-rollback";
const MAX_ROLLBACKS: usize = 40;
/// Folders beside `mods` that a Minecraft Tofu also keeps (and syncs).
pub const CONTENT_SUBDIRS: [&str; 2] = ["resourcepacks", "shaderpacks"];

struct Runtime { data_dir: PathBuf, app: tauri::AppHandle }
static RUNTIME: OnceLock<Runtime> = OnceLock::new();

/// Called once from `setup`; downloads use it to record installed files and announce their end.
pub fn initialize(app: tauri::AppHandle, data_dir: PathBuf) { let _ = RUNTIME.set(Runtime { data_dir, app }); }

pub(crate) fn emit(event: &str, payload: impl Serialize + Clone) {
    if let Some(runtime) = RUNTIME.get() { let _ = runtime.app.emit(event, payload); }
}

/// Mochi's per-user data folder (set at startup).
pub(crate) fn data_dir() -> Option<PathBuf> { RUNTIME.get().map(|runtime| runtime.data_dir.clone()) }

fn instances_root() -> Option<PathBuf> { RUNTIME.get().map(|runtime| runtime.data_dir.join("instances")) }

fn lock() -> std::sync::MutexGuard<'static, ()> {
    static LOCK: Mutex<()> = Mutex::new(());
    LOCK.lock_recover()
}

fn tofu_dir(root: &Path, tofu_id: &str) -> Result<PathBuf, String> {
    // Tofu ids are generated as `name-timestamp-random`; anything else would be a path trick.
    if !valid_id(tofu_id, 120) { return Err("Invalid Tofu id.".into()); }
    Ok(root.join(tofu_id))
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

fn yes() -> bool { true }

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Rollback { pub file: String, pub version: String, pub file_id: String, pub sha1: Option<String>, pub file_date: Option<String> }

/// One installed file of a Tofu. `file` is the name without the `.disabled` marker.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct ModRecord {
    pub file: String,
    /// "" for the main mods folder, or one of `CONTENT_SUBDIRS`.
    pub subdir: String,
    #[serde(default = "yes")]
    pub enabled: bool,
    /// "modrinth", "curseforge", "nexus" or "manual".
    pub source: String,
    pub project_id: String,
    pub file_id: String,
    pub version: String,
    pub title: String,
    pub icon_url: Option<String>,
    pub sha1: Option<String>,
    pub file_date: Option<String>,
    pub installed_at: u64,
    pub rollback: Option<Rollback>,
}

impl Default for ModRecord {
    fn default() -> Self {
        Self { file: String::new(), subdir: String::new(), enabled: true, source: "manual".into(), project_id: String::new(), file_id: String::new(),
            version: String::new(), title: String::new(), icon_url: None, sha1: None, file_date: None, installed_at: 0, rollback: None }
    }
}

/// What the frontend knows about a file when it starts a download or an update.
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct RecordInput { pub source: String, pub project_id: String, pub file_id: String, pub version: String, pub title: String, pub icon_url: Option<String>, pub file_date: Option<String> }

impl RecordInput {
    pub fn into_record(self, file: &str, subdir: &str, sha1: Option<String>) -> ModRecord {
        let source: String = if matches!(self.source.as_str(), "modrinth" | "curseforge" | "nexus") { self.source } else { "manual".into() };
        let is_curseforge = source == "curseforge";
        ModRecord {
            file: file.to_string(), subdir: subdir.to_string(), enabled: true, source, project_id: self.project_id.chars().take(80).collect(), file_id: self.file_id.chars().take(80).collect(),
            version: self.version.chars().take(120).collect(), title: self.title.chars().take(160).collect(), // CurseForge terms: no stored API content beyond what identifies the installed file, so no icon for those.
            icon_url: self.icon_url.filter(|url| !is_curseforge && url.starts_with("https://") && url.len() < 500),
            sha1, file_date: self.file_date.map(|value| value.chars().take(40).collect()), installed_at: now_ms(), rollback: None,
        }
    }
}

#[derive(Serialize, Deserialize, Default)]
struct RecordFile { version: u32, mods: Vec<ModRecord> }

fn records_path(root: &Path, tofu_id: &str) -> Result<PathBuf, String> { Ok(tofu_dir(root, tofu_id)?.join("mods.json")) }

pub(crate) fn load_records(root: &Path, tofu_id: &str) -> Vec<ModRecord> {
    let Ok(path) = records_path(root, tofu_id) else { return Vec::new() };
    fs::read(path).ok().and_then(|bytes| serde_json::from_slice::<RecordFile>(&bytes).ok()).map(|file| file.mods).unwrap_or_default()
}

fn save_records(root: &Path, tofu_id: &str, mods: Vec<ModRecord>) -> Result<(), String> {
    let path = records_path(root, tofu_id)?;
    if let Some(parent) = path.parent() { fs::create_dir_all(parent).map_err(|e| format!("Unable to save mod records: {e}")) ?; }
    let bytes = serde_json::to_vec_pretty(&RecordFile { version: 1, mods }).map_err(|e| e.to_string())?;
    fsio::write_atomic_durable(&path, &bytes).map_err(|e| format!("Unable to save mod records: {e}"))
}

fn same_slot(a: &ModRecord, b: &ModRecord) -> bool { a.subdir == b.subdir && a.file == b.file }

pub(crate) fn upsert_record_in(root: &Path, tofu_id: &str, record: ModRecord) -> Result<(), String> {
    let _guard = lock();
    let mut mods = load_records(root, tofu_id);
    mods.retain(|existing| !same_slot(existing, &record));
    mods.push(record);
    save_records(root, tofu_id, mods)
}

/// Records a finished download. Failures are ignored: the file is already installed and works without a record.
pub(crate) fn record_install(tofu_id: &str, record: ModRecord) {
    if let Some(root) = instances_root() { let _ = upsert_record_in(&root, tofu_id, record); }
}

/// The record of a file as it is right now (used to remember what an update replaced).
pub(crate) fn previous_record(tofu_id: &str, subdir: &str, file: &str) -> Option<ModRecord> {
    let root = instances_root()?;
    load_records(&root, tofu_id).into_iter().find(|record| record.subdir == subdir && record.file == file)
}

pub(crate) fn drop_record(tofu_id: &str, subdir: &str, file: &str) {
    let Some(root) = instances_root() else { return };
    let _guard = lock();
    let mut records = load_records(&root, tofu_id);
    let before = records.len();
    records.retain(|record| !(record.subdir == subdir && record.file == file));
    if records.len() != before { let _ = save_records(&root, tofu_id, records); }
}

pub fn content_dir(root: &Path, subdir: &str) -> Result<PathBuf, String> {
    match subdir {
        "" => Ok(root.to_path_buf()),
        name if CONTENT_SUBDIRS.contains(&name) => Ok(root.join(name)),
        _ => Err("Unknown content folder.".into()),
    }
}

pub fn base_name(name: &str) -> &str { name.strip_suffix(".disabled").unwrap_or(name) }

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceMod {
    pub filename: String,
    pub path: String,
    pub enabled: bool,
    pub size: u64,
    pub record: Option<ModRecord>,
}

/// The files of one content folder joined with what Mochi remembers about them.
pub(crate) fn list_with_records(dir: &Path, records: &[ModRecord], subdir: &str) -> Result<Vec<InstanceMod>, String> {
    let mut out = Vec::new();
    if !dir.is_dir() { return Ok(out); }
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())?.flatten() {
        let Ok(meta) = entry.metadata() else { continue };
        let name = entry.file_name().to_string_lossy().into_owned();
        if !meta.is_file() || name.starts_with('.') || !CONTENT_EXTENSIONS.contains(&content_extension(&name).as_str()) { continue; }
        let record = records.iter().find(|record| record.subdir == subdir && record.file == base_name(&name)).cloned();
        out.push(InstanceMod { enabled: !name.ends_with(".disabled"), path: entry.path().to_string_lossy().into_owned(), size: meta.len(), filename: name, record });
    }
    out.sort_by_key(|item| item.filename.to_lowercase());
    Ok(out)
}

#[tauri::command(async)]
pub fn list_instance_mods(tofu_id: String, path: String, subdir: Option<String>) -> Result<Vec<InstanceMod>, String> {
    let subdir = subdir.unwrap_or_default();
    let dir = content_dir(&validate_path(&path)?, &subdir)?;
    let records = instances_root().map(|root| load_records(&root, &tofu_id)).unwrap_or_default();
    list_with_records(&dir, &records, &subdir)
}

/// Default folder for a Tofu whose mods are kept apart from the game folder.
#[tauri::command(async)]
pub fn get_instance_store_dir(tofu_id: String) -> Result<String, String> {
    let root = instances_root().ok_or("Mochi is still starting.")?;
    let dir = tofu_dir(&root, &tofu_id)?.join("files");
    fs::create_dir_all(&dir).map_err(|e| format!("Unable to create the mod folder: {e}"))?;
    Ok(dir.to_string_lossy().into_owned())
}

/// Attaches provenance to a file that is already installed (for example after an update check identified it).
#[tauri::command(async)]
pub fn record_instance_mod(tofu_id: String, file: String, subdir: Option<String>, sha1: Option<String>, record: RecordInput) -> Result<(), String> {
    let root = instances_root().ok_or("Mochi is still starting.")?;
    if file.contains(['/', '\\']) || file.is_empty() { return Err("Invalid file name.".into()); }
    upsert_record_in(&root, &tofu_id, record.into_record(base_name(&file), &subdir.unwrap_or_default(), sha1))
}

// ---------------------------------------------------------------------------
// Enable / disable
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BulkResult { pub changed: usize, pub failed: Vec<String> }

/// Renames `x.jar` <-> `x.jar.disabled`. The file stays where it is, so enabling is always exact and reversible.
pub(crate) fn set_enabled_many(root: &Path, tofu_id: &str, paths: &[String], enabled: bool) -> BulkResult {
    let mut result = BulkResult::default();
    let mut changed_files: Vec<(String, String)> = Vec::new();
    for path in paths {
        let outcome = validate_content_path(path).and_then(|p| {
            let name = p.file_name().and_then(|n| n.to_str()).unwrap_or_default().to_string();
            let already = name.ends_with(".disabled") != enabled;
            crate::modrinth::rename_enabled(&p, enabled)?;
            let subdir = p.parent().and_then(|dir| dir.file_name()).and_then(|n| n.to_str()).filter(|n| CONTENT_SUBDIRS.contains(n)).unwrap_or("").to_string();
            Ok((already, subdir, base_name(&name).to_string()))
        });
        match outcome {
            Ok((already, subdir, base)) => { if !already { result.changed += 1; } changed_files.push((subdir, base)); }
            Err(error) => result.failed.push(format!("{}: {error}", Path::new(path).file_name().and_then(|n| n.to_str()).unwrap_or(path))),
        }
    }
    if !tofu_id.is_empty() && valid_id(tofu_id, 120) && !changed_files.is_empty() {
        let _guard = lock();
        let mut records = load_records(root, tofu_id);
        let mut dirty = false;
        for (subdir, base) in &changed_files {
            if let Some(record) = records.iter_mut().find(|record| record.subdir == *subdir && record.file == *base) {
                if record.enabled != enabled { record.enabled = enabled; dirty = true; }
            }
        }
        if dirty { let _ = save_records(root, tofu_id, records); }
    }
    result
}

#[tauri::command(async)]
pub fn set_instance_mods_enabled(tofu_id: String, paths: Vec<String>, enabled: bool) -> Result<BulkResult, String> {
    if paths.len() > 5000 { return Err("Too many files at once.".into()); }
    let root = instances_root().ok_or("Mochi is still starting.")?;
    Ok(set_enabled_many(&root, &tofu_id, &paths, enabled))
}

// ---------------------------------------------------------------------------
// Update rollback
// ---------------------------------------------------------------------------

pub(crate) fn rollback_dir(dir: &Path) -> PathBuf { dir.join(ROLLBACK_DIR) }

/// Keeps the file an update is about to replace so the update can be undone. Returns the saved name.
pub(crate) fn save_rollback_copy(old: &Path) -> Result<String, String> {
    let dir = old.parent().ok_or("Invalid content path.")?;
    let name = base_name(old.file_name().and_then(|n| n.to_str()).ok_or("Invalid content filename.")?).to_string();
    let store = rollback_dir(dir);
    fs::create_dir_all(&store).map_err(|e| format!("Unable to keep a rollback copy: {e}"))?;
    let saved = store.join(&name);
    let _ = fs::remove_file(&saved);
    // A hard link is enough: the old file is removed by name afterwards and its data lives on here.
    if fs::hard_link(old, &saved).is_err() { fs::copy(old, &saved).map_err(|e| format!("Unable to keep a rollback copy: {e}"))?; }
    prune_rollbacks(&store);
    Ok(name)
}

fn prune_rollbacks(store: &Path) {
    let Ok(read) = fs::read_dir(store) else { return };
    let mut files: Vec<(std::time::SystemTime, PathBuf)> = read.flatten().filter_map(|e| Some((e.metadata().ok()?.modified().ok()?, e.path()))).collect();
    if files.len() <= MAX_ROLLBACKS { return; }
    files.sort_by_key(|(time, _)| *time);
    let excess = files.len() - MAX_ROLLBACKS;
    for (_, path) in files.into_iter().take(excess) { let _ = fs::remove_file(path); }
}

/// Puts the previous version of `current` back (the one saved by the last update) and forgets the newer one.
pub(crate) fn rollback_in(root: &Path, tofu_id: &str, dir: &Path, subdir: &str, current_file: &str) -> Result<String, String> {
    let _guard = lock();
    let mut records = load_records(root, tofu_id);
    let position = records.iter().position(|r| r.subdir == subdir && r.file == current_file).ok_or("Mochi has no record of this file.")?;
    let rollback = records[position].rollback.clone().ok_or("There is no earlier version to go back to.")?;
    let saved = rollback_dir(dir).join(&rollback.file);
    if !saved.is_file() { return Err("The earlier version was removed from the rollback folder.".into()); }
    let was_disabled = !dir.join(current_file).exists() && dir.join(format!("{current_file}.disabled")).exists();
    let target_name = if was_disabled { format!("{}.disabled", rollback.file) } else { rollback.file.clone() };
    let target = dir.join(&target_name);
    if rollback.file != current_file && fs::symlink_metadata(&target).is_ok() { return Err(format!("'{target_name}' already exists.")); }
    // Replace the current file with the saved one, then drop the newer file if its name differs.
    let staging = dir.join(format!("{target_name}.mochi-restore"));
    fs::copy(&saved, &staging).map_err(|e| format!("Unable to restore the earlier version: {e}"))?;
    for candidate in [current_file.to_string(), format!("{current_file}.disabled")] { let _ = fs::remove_file(dir.join(candidate)); }
    fs::rename(&staging, &target).map_err(|e| format!("Unable to restore the earlier version: {e}"))?;
    let mut record = records.remove(position);
    record.file = rollback.file.clone();
    record.version = rollback.version;
    record.file_id = rollback.file_id;
    record.sha1 = rollback.sha1;
    record.file_date = rollback.file_date;
    record.rollback = None;
    records.retain(|r| !same_slot(r, &record));
    records.push(record);
    save_records(root, tofu_id, records)?;
    Ok(rollback.file)
}

#[tauri::command(async)]
pub fn rollback_mod_update(tofu_id: String, dir: String, subdir: Option<String>, file: String) -> Result<String, String> {
    let root = instances_root().ok_or("Mochi is still starting.")?;
    let subdir = subdir.unwrap_or_default();
    let dir = content_dir(&validate_path(&dir)?, &subdir)?;
    if file.contains(['/', '\\']) { return Err("Invalid file name.".into()); }
    rollback_in(&root, &tofu_id, &dir, &subdir, base_name(&file))
}

// ---------------------------------------------------------------------------
// Launch-time sync
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModSyncRequest {
    pub tofu_id: String,
    /// The Tofu's own folder (its saved mods).
    pub store_dir: String,
    /// The folder the game loads mods from.
    pub game_dir: String,
    /// Minecraft only: the game folder holding `resourcepacks` / `shaderpacks`.
    #[serde(default)]
    pub content_root: Option<String>,
    /// Replace same-named files Mochi did not put there (off by default: such files are left alone and reported).
    #[serde(default)]
    pub adopt_unmanaged: bool,
}

#[derive(Debug, Clone, Serialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SyncReport { pub added: usize, pub removed: usize, pub unchanged: usize, pub conflicts: Vec<String>, pub errors: Vec<String> }

#[derive(Serialize, Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
struct ManagedEntry { name: String, size: u64, mtime_ms: u64, tofu_id: String }

#[derive(Serialize, Deserialize, Default)]
struct ManagedFile { version: u32, entries: Vec<ManagedEntry> }

fn load_managed(dest: &Path) -> Vec<ManagedEntry> {
    fs::read(dest.join(MANAGED_FILE)).ok().and_then(|bytes| serde_json::from_slice::<ManagedFile>(&bytes).ok()).map(|file| file.entries).unwrap_or_default()
}

fn save_managed(dest: &Path, entries: Vec<ManagedEntry>) -> Result<(), String> {
    let path = dest.join(MANAGED_FILE);
    if entries.is_empty() { let _ = fs::remove_file(&path); return Ok(()); }
    let bytes = serde_json::to_vec_pretty(&ManagedFile { version: 1, entries }).map_err(|e| e.to_string())?;
    fsio::write_atomic(&path, &bytes).map_err(|e| format!("Unable to save the sync list in {}: {e}", dest.display()))
}

fn mtime_ms(meta: &fs::Metadata) -> u64 { meta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0) }

fn safe_entry_name(name: &str) -> bool { !name.is_empty() && !name.contains(['/', '\\', '\0']) && name != "." && name != ".." }

#[cfg(unix)]
fn same_file(a: &fs::Metadata, b: &fs::Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;
    a.dev() == b.dev() && a.ino() == b.ino()
}

/// Hard link when both folders share a volume (instant, no extra disk), otherwise copy through a temp name.
fn place(src: &Path, dest: &Path) -> Result<(), String> {
    if fs::hard_link(src, dest).is_ok() { return Ok(()); }
    let temp = dest.with_extension(format!("{}.mochi-tmp", dest.extension().and_then(|e| e.to_str()).unwrap_or("part")));
    fs::copy(src, &temp).map_err(|e| format!("Unable to copy {}: {e}", src.display()))?;
    fs::rename(&temp, dest).map_err(|e| { let _ = fs::remove_file(&temp); format!("Unable to place {}: {e}", dest.display()) })
}

/// Makes `dest` contain exactly the enabled files of `src` among the files Mochi manages there.
pub(crate) fn sync_lane(src: &Path, dest: &Path, tofu_id: &str, adopt: bool, progress: &mut dyn FnMut()) -> SyncReport {
    let mut report = SyncReport::default();
    let mut desired: Vec<(String, fs::Metadata)> = Vec::new();
    if let Ok(read) = fs::read_dir(src) {
        for entry in read.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            // Disabled files stay in the store; hidden files are Mochi's own (rollback copies, markers).
            if name.starts_with('.') || name.ends_with(".disabled") || !CONTENT_EXTENSIONS.contains(&content_extension(&name).as_str()) || !safe_entry_name(&name) { continue; }
            if let Ok(meta) = fs::metadata(entry.path()) { if meta.is_file() { desired.push((name, meta)); } }
        }
    }
    desired.sort_by(|a, b| a.0.cmp(&b.0));
    let managed = load_managed(dest);
    if desired.is_empty() && managed.is_empty() { return report; }
    if let Err(error) = fs::create_dir_all(dest) { report.errors.push(format!("Unable to create {}: {error}", dest.display())); return report; }

    let wanted: HashSet<&str> = desired.iter().map(|(name, _)| name.as_str()).collect();
    let mut kept: Vec<ManagedEntry> = Vec::new();
    for entry in &managed {
        if wanted.contains(entry.name.as_str()) || !safe_entry_name(&entry.name) { if safe_entry_name(&entry.name) { kept.push(entry.clone()); } continue; }
        let path = dest.join(&entry.name);
        match fs::symlink_metadata(&path) {
            // Only remove what is still the file Mochi placed; a file the user replaced stays.
            Ok(meta) if meta.is_file() && meta.len() == entry.size => match fs::remove_file(&path) { Ok(()) => report.removed += 1, Err(error) => { report.errors.push(format!("{}: {error}", entry.name)); kept.push(entry.clone()); } },
            Ok(_) => report.conflicts.push(format!("{} was changed outside Mochi and was left in place", entry.name)),
            Err(_) => {}
        }
        progress();
    }
    let known: HashMap<&str, &ManagedEntry> = managed.iter().map(|entry| (entry.name.as_str(), entry)).collect();
    for (name, meta) in &desired {
        let target = dest.join(name);
        let entry = ManagedEntry { name: name.clone(), size: meta.len(), mtime_ms: mtime_ms(meta), tofu_id: tofu_id.to_string() };
        match (fs::symlink_metadata(&target), known.get(name.as_str())) {
            (Ok(existing), Some(previous)) if existing.is_file() && previous.size == entry.size && previous.mtime_ms == entry.mtime_ms && existing.len() == entry.size => {
                report.unchanged += 1;
                kept.push(entry);
            }
            (Ok(existing), Some(_)) if existing.is_file() => match fs::remove_file(&target).map_err(|e| e.to_string()).and_then(|()| place(&dir_join(src, name), &target)) {
                Ok(()) => { report.added += 1; kept.push(entry); }
                Err(error) => report.errors.push(format!("{name}: {error}")),
            },
            (Ok(existing), None) => {
                #[cfg(unix)]
                let identical = fs::metadata(dir_join(src, name)).map(|s| same_file(&s, &existing)).unwrap_or(false);
                #[cfg(not(unix))]
                let identical = false;
                if identical { report.unchanged += 1; kept.push(entry); }
                else if adopt && existing.is_file() {
                    match fs::remove_file(&target).map_err(|e| e.to_string()).and_then(|()| place(&dir_join(src, name), &target)) {
                        Ok(()) => { report.added += 1; kept.push(entry); }
                        Err(error) => report.errors.push(format!("{name}: {error}")),
                    }
                } else { report.conflicts.push(format!("{name} already exists in the game folder and Mochi did not put it there")); }
            }
            (Ok(_), Some(_)) => report.conflicts.push(format!("{name} in the game folder is not a regular file")),
            (Err(_), _) => match place(&dir_join(src, name), &target) {
                Ok(()) => { report.added += 1; kept.push(entry); }
                Err(error) => report.errors.push(format!("{name}: {error}")),
            },
        }
        progress();
    }
    kept.sort_by(|a, b| a.name.cmp(&b.name));
    if let Err(error) = save_managed(dest, kept) { report.errors.push(error); }
    report
}

fn dir_join(dir: &Path, name: &str) -> PathBuf { dir.join(name) }

fn count_work(src: &Path, dest: &Path) -> usize {
    let files = fs::read_dir(src).map(|read| read.flatten().filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false)).count()).unwrap_or(0);
    files + load_managed(dest).len()
}

fn merge(into: &mut SyncReport, other: SyncReport) {
    into.added += other.added; into.removed += other.removed; into.unchanged += other.unchanged;
    into.conflicts.extend(other.conflicts); into.errors.extend(other.errors);
}

/// Checks a user-supplied folder before Mochi writes into it. The game folder is the user's own choice, so the
/// rules only keep a sync from running somewhere that can never be a mods folder.
pub(crate) fn validate_sync_dir(path: &str) -> Result<PathBuf, String> {
    let dir = validate_path(path)?;
    if dir.parent().is_none() { return Err("The filesystem root cannot be a mods folder.".into()); }
    if crate::platform::home_dir().is_some_and(|home| home == dir) { return Err("Your home folder cannot be a mods folder.".into()); }
    Ok(dir)
}

pub(crate) fn same_dir(a: &Path, b: &Path) -> bool {
    match (fs::canonicalize(a), fs::canonicalize(b)) { (Ok(a), Ok(b)) => a == b, _ => a == b }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncProgress { pub tofu_id: String, pub done: usize, pub total: usize }

/// Runs the whole sync for a launch. `on_progress` is called as files are handled.
pub fn run_sync(request: &ModSyncRequest, on_progress: &dyn Fn(usize, usize)) -> Result<SyncReport, String> {
    let store = validate_path(&request.store_dir)?;
    let game = validate_sync_dir(&request.game_dir)?;
    if same_dir(&store, &game) { return Ok(SyncReport::default()); }
    let mut lanes: Vec<(PathBuf, PathBuf)> = vec![(store.clone(), game)];
    if let Some(root) = request.content_root.as_deref().filter(|root| !root.trim().is_empty()) {
        let root = validate_sync_dir(root)?;
        for sub in CONTENT_SUBDIRS { lanes.push((store.join(sub), root.join(sub))); }
    }
    let total: usize = lanes.iter().map(|(src, dest)| count_work(src, dest)).sum();
    let done = std::cell::Cell::new(0usize);
    let mut report = SyncReport::default();
    for (src, dest) in &lanes {
        let mut tick = || { done.set(done.get() + 1); on_progress(done.get().min(total), total); };
        merge(&mut report, sync_lane(src, dest, &request.tofu_id, request.adopt_unmanaged, &mut tick));
    }
    Ok(report)
}

#[tauri::command]
pub async fn sync_instance_mods(request: ModSyncRequest) -> Result<SyncReport, String> {
    let id = request.tofu_id.clone();
    crate::util::blocking(move || run_sync(&request, &|done, total| emit("mod-sync-progress", SyncProgress { tofu_id: id.clone(), done, total }))).await?
}

/// Copies the mod files of `from` (a game folder) into `to` (a Tofu's own folder) without touching the originals.
#[tauri::command(async)]
pub fn import_mods_from_folder(from: String, to: String) -> Result<usize, String> {
    let (from, to) = (validate_path(&from)?, validate_path(&to)?);
    if same_dir(&from, &to) { return Ok(0); }
    fs::create_dir_all(&to).map_err(|e| format!("Unable to create the folder: {e}"))?;
    let mut copied = 0;
    for entry in fs::read_dir(&from).map_err(|e| e.to_string())?.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') || !safe_entry_name(&name) || !CONTENT_EXTENSIONS.contains(&content_extension(&name).as_str()) { continue; }
        if !entry.metadata().map(|m| m.is_file()).unwrap_or(false) { continue; }
        let target = to.join(&name);
        if fs::symlink_metadata(&target).is_ok() { continue; }
        fs::copy(entry.path(), &target).map_err(|e| format!("Unable to copy {name}: {e}"))?;
        copied += 1;
    }
    Ok(copied)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mochi-inst-{name}-{}-{}", std::process::id(), now_ms()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn request(store: &Path, game: &Path, tofu: &str) -> ModSyncRequest {
        ModSyncRequest { tofu_id: tofu.into(), store_dir: store.to_string_lossy().into(), game_dir: game.to_string_lossy().into(), content_root: None, adopt_unmanaged: false }
    }

    #[test]
    fn switching_tofus_swaps_only_managed_files() {
        let base = temp("swap");
        let (a, b, game) = (base.join("a"), base.join("b"), base.join("game/mods"));
        for dir in [&a, &b, &game] { fs::create_dir_all(dir).unwrap(); }
        fs::write(a.join("sodium.jar"), b"sodium").unwrap();
        fs::write(a.join("off.jar.disabled"), b"off").unwrap();
        fs::write(b.join("lithium.jar"), b"lithium").unwrap();
        fs::write(game.join("mine.jar"), b"users own mod").unwrap();

        let report = run_sync(&request(&a, &game, "a"), &|_, _| {}).unwrap();
        assert_eq!((report.added, report.removed), (1, 0));
        assert!(game.join("sodium.jar").exists() && !game.join("off.jar").exists() && !game.join("off.jar.disabled").exists());

        // Second sync of the same Tofu changes nothing.
        let again = run_sync(&request(&a, &game, "a"), &|_, _| {}).unwrap();
        assert_eq!((again.added, again.removed, again.unchanged), (0, 0, 1));

        let report = run_sync(&request(&b, &game, "b"), &|_, _| {}).unwrap();
        assert_eq!((report.added, report.removed), (1, 1));
        assert!(!game.join("sodium.jar").exists() && game.join("lithium.jar").exists());
        assert_eq!(fs::read(game.join("mine.jar")).unwrap(), b"users own mod");
        // The store still has everything, so switching back restores it.
        assert!(a.join("sodium.jar").exists() && a.join("off.jar.disabled").exists());
        run_sync(&request(&a, &game, "a"), &|_, _| {}).unwrap();
        assert!(game.join("sodium.jar").exists() && !game.join("lithium.jar").exists());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn unmanaged_files_are_never_replaced_unless_adopted() {
        let base = temp("adopt");
        let (store, game) = (base.join("store"), base.join("game"));
        fs::create_dir_all(&store).unwrap();
        fs::create_dir_all(&game).unwrap();
        fs::write(store.join("x.jar"), b"store").unwrap();
        fs::write(game.join("x.jar"), b"theirs").unwrap();
        let report = run_sync(&request(&store, &game, "t"), &|_, _| {}).unwrap();
        assert_eq!(report.conflicts.len(), 1);
        assert_eq!(fs::read(game.join("x.jar")).unwrap(), b"theirs");
        let mut adopting = request(&store, &game, "t");
        adopting.adopt_unmanaged = true;
        assert_eq!(run_sync(&adopting, &|_, _| {}).unwrap().added, 1);
        assert_eq!(fs::read(game.join("x.jar")).unwrap(), b"store");
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn a_file_changed_by_the_user_is_not_deleted_on_switch() {
        let base = temp("changed");
        let (a, b, game) = (base.join("a"), base.join("b"), base.join("game"));
        for dir in [&a, &b, &game] { fs::create_dir_all(dir).unwrap(); }
        fs::write(a.join("m.jar"), b"one").unwrap();
        run_sync(&request(&a, &game, "a"), &|_, _| {}).unwrap();
        fs::remove_file(game.join("m.jar")).unwrap();
        fs::write(game.join("m.jar"), b"user replaced it with something longer").unwrap();
        let report = run_sync(&request(&b, &game, "b"), &|_, _| {}).unwrap();
        assert_eq!(report.removed, 0);
        assert_eq!(report.conflicts.len(), 1);
        assert!(game.join("m.jar").exists());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn same_folder_is_a_no_op_and_roots_are_refused() {
        let base = temp("same");
        fs::write(base.join("a.jar"), b"a").unwrap();
        let same = run_sync(&request(&base, &base, "t"), &|_, _| {}).unwrap();
        assert_eq!(same, SyncReport::default());
        assert!(!base.join(MANAGED_FILE).exists());
        assert!(validate_sync_dir("/").is_err());
        assert!(validate_sync_dir("relative/mods").is_err());
        assert!(validate_sync_dir("/tmp/../etc").is_err());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn minecraft_content_folders_sync_too() {
        let base = temp("mc");
        let (store, root) = (base.join("store"), base.join("mc"));
        fs::create_dir_all(store.join("resourcepacks")).unwrap();
        fs::write(store.join("resourcepacks/pack.zip"), b"zip").unwrap();
        fs::write(store.join("mod.jar"), b"jar").unwrap();
        let mut req = request(&store, &root.join("mods"), "t");
        req.content_root = Some(root.to_string_lossy().into());
        let report = run_sync(&req, &|_, _| {}).unwrap();
        assert_eq!(report.added, 2);
        assert!(root.join("resourcepacks/pack.zip").exists() && root.join("mods/mod.jar").exists());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn bulk_toggle_is_reversible_and_updates_records() {
        let base = temp("bulk");
        let (data, dir) = (base.join("data"), base.join("mods"));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("a.jar"), b"a").unwrap();
        fs::write(dir.join("b.jar"), b"b").unwrap();
        let record = RecordInput { source: "modrinth".into(), project_id: "P".into(), ..Default::default() }.into_record("a.jar", "", Some("x".into()));
        upsert_record_in(&data, "tofu-1", record).unwrap();
        let paths: Vec<String> = ["a.jar", "b.jar", "missing.jar"].iter().map(|n| dir.join(n).to_string_lossy().into_owned()).collect();
        let off = set_enabled_many(&data, "tofu-1", &paths, false);
        assert_eq!(off.changed, 2);
        assert!(dir.join("a.jar.disabled").exists() && dir.join("b.jar.disabled").exists());
        assert!(!load_records(&data, "tofu-1")[0].enabled);
        let on_paths: Vec<String> = ["a.jar.disabled", "b.jar.disabled"].iter().map(|n| dir.join(n).to_string_lossy().into_owned()).collect();
        assert_eq!(set_enabled_many(&data, "tofu-1", &on_paths, true).changed, 2);
        assert!(dir.join("a.jar").exists() && load_records(&data, "tofu-1")[0].enabled);
        let listed = list_with_records(&dir, &load_records(&data, "tofu-1"), "").unwrap();
        assert_eq!(listed.len(), 2);
        assert_eq!(listed[0].record.as_ref().map(|r| r.source.as_str()), Some("modrinth"));
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn rollback_restores_the_previous_file_and_record() {
        let base = temp("rollback");
        let (data, dir) = (base.join("data"), base.join("mods"));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("m-1.jar"), b"old").unwrap();
        let mut record = RecordInput { source: "modrinth".into(), version: "1".into(), ..Default::default() }.into_record("m-1.jar", "", None);
        upsert_record_in(&data, "t", record.clone()).unwrap();
        let saved = save_rollback_copy(&dir.join("m-1.jar")).unwrap();
        // Simulate the update: new file in, old file out, record points at the new one with a rollback entry.
        fs::write(dir.join("m-2.jar"), b"new").unwrap();
        fs::remove_file(dir.join("m-1.jar")).unwrap();
        record.rollback = Some(Rollback { file: saved, version: "1".into(), ..Default::default() });
        record.file = "m-2.jar".into();
        record.version = "2".into();
        fs::remove_file(records_path(&data, "t").unwrap()).unwrap();
        upsert_record_in(&data, "t", record).unwrap();
        assert_eq!(rollback_in(&data, "t", &dir, "", "m-2.jar").unwrap(), "m-1.jar");
        assert_eq!(fs::read(dir.join("m-1.jar")).unwrap(), b"old");
        assert!(!dir.join("m-2.jar").exists());
        let records = load_records(&data, "t");
        assert_eq!((records[0].file.as_str(), records[0].version.as_str()), ("m-1.jar", "1"));
        assert!(rollback_in(&data, "t", &dir, "", "m-1.jar").is_err());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn records_reject_bad_ids_and_sanitise_input() {
        assert!(tofu_dir(Path::new("/x"), "../evil").is_err());
        assert!(tofu_dir(Path::new("/x"), "tofu-12_ab").is_ok());
        let record = RecordInput { source: "evil".into(), icon_url: Some("javascript:alert(1)".into()), ..Default::default() }.into_record("a.jar", "", None);
        assert_eq!(record.source, "manual");
        assert!(record.icon_url.is_none());
        let cf = RecordInput { source: "curseforge".into(), icon_url: Some("https://media.forgecdn.net/a.png".into()), ..Default::default() }.into_record("a.jar", "", None);
        assert!(cf.icon_url.is_none());
        let modrinth = RecordInput { source: "modrinth".into(), icon_url: Some("https://cdn.modrinth.com/a.png".into()), ..Default::default() }.into_record("a.jar", "", None);
        assert!(modrinth.icon_url.is_some());
        assert!(content_dir(Path::new("/x"), "../etc").is_err());
        assert_eq!(content_dir(Path::new("/x"), "shaderpacks").unwrap(), PathBuf::from("/x/shaderpacks"));
    }

    #[test]
    fn import_copies_without_overwriting() {
        let base = temp("import");
        let (from, to) = (base.join("from"), base.join("to"));
        fs::create_dir_all(&from).unwrap();
        fs::create_dir_all(&to).unwrap();
        fs::write(from.join("a.jar"), b"a").unwrap();
        fs::write(from.join("notes.txt"), b"x").unwrap();
        fs::write(to.join("b.jar"), b"keep").unwrap();
        fs::write(from.join("b.jar"), b"other").unwrap();
        assert_eq!(import_mods_from_folder(from.to_string_lossy().into(), to.to_string_lossy().into()).unwrap(), 1);
        assert_eq!(fs::read(to.join("b.jar")).unwrap(), b"keep");
        assert!(!to.join("notes.txt").exists());
        let _ = fs::remove_dir_all(&base);
    }
}
