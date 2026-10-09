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

pub(crate) fn instances_root() -> Option<PathBuf> { RUNTIME.get().map(|runtime| runtime.data_dir.join("instances")) }

pub(crate) fn lock() -> std::sync::MutexGuard<'static, ()> {
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
    /// The download was a .zip unpacked into the folder: `file` names the archive, which is no longer on disk.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub extracted: bool,
    /// Install-time facts for the offline conflict check (never stored for CurseForge, see `RecordInput::into_record`).
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub game_versions: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub loaders: Vec<String>,
    /// Project ids (of the same source) the file needs.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub requires: Vec<String>,
    /// Project ids (of the same source) the author marked as incompatible.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub incompatible: Vec<String>,
}

impl Default for ModRecord {
    fn default() -> Self {
        Self { file: String::new(), subdir: String::new(), enabled: true, source: "manual".into(), project_id: String::new(), file_id: String::new(),
            version: String::new(), title: String::new(), icon_url: None, sha1: None, file_date: None, installed_at: 0, rollback: None, extracted: false,
            game_versions: Vec::new(), loaders: Vec::new(), requires: Vec::new(), incompatible: Vec::new() }
    }
}

/// What the frontend knows about a file when it starts a download or an update.
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct RecordInput { pub source: String, pub project_id: String, pub file_id: String, pub version: String, pub title: String, pub icon_url: Option<String>, pub file_date: Option<String>,
    pub game_versions: Vec<String>, pub loaders: Vec<String>, pub requires: Vec<String>, pub incompatible: Vec<String> }

/// Keeps at most `max` short, non-empty entries.
fn clean_list(list: Vec<String>, max: usize, len: usize) -> Vec<String> {
    list.into_iter().map(|item| item.trim().chars().take(len).collect::<String>()).filter(|item| !item.is_empty()).take(max).collect()
}

impl RecordInput {
    pub fn into_record(self, file: &str, subdir: &str, sha1: Option<String>) -> ModRecord {
        let source: String = if matches!(self.source.as_str(), "modrinth" | "curseforge" | "nexus") { self.source } else { "manual".into() };
        let is_curseforge = source == "curseforge";
        ModRecord {
            file: file.to_string(), subdir: subdir.to_string(), enabled: true, source, project_id: self.project_id.chars().take(80).collect(), file_id: self.file_id.chars().take(80).collect(),
            version: self.version.chars().take(120).collect(), title: self.title.chars().take(160).collect(), // CurseForge terms: no stored API content beyond what identifies the installed file, so no icon for those.
            icon_url: self.icon_url.filter(|url| !is_curseforge && url.starts_with("https://") && url.len() < 500),
            sha1, file_date: self.file_date.map(|value| value.chars().take(40).collect()), installed_at: now_ms(), rollback: None, extracted: false,
            // CurseForge terms: no persistent copy of its API data, so these stay empty for CurseForge files.
            game_versions: if is_curseforge { Vec::new() } else { clean_list(self.game_versions, 60, 24) },
            loaders: if is_curseforge { Vec::new() } else { clean_list(self.loaders, 8, 24) },
            requires: if is_curseforge { Vec::new() } else { clean_list(self.requires, 100, 80) },
            incompatible: if is_curseforge { Vec::new() } else { clean_list(self.incompatible, 100, 80) },
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

pub(crate) fn save_records(root: &Path, tofu_id: &str, mods: Vec<ModRecord>) -> Result<(), String> {
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

/// The same file name was downloaded again while the older copy is disabled (`x.jar.disabled`): the fresh copy replaces it
/// and stays disabled, so the folder never holds both (the game would load the fresh one against the user's choice).
fn replace_disabled_twin(root: &Path, tofu_id: &str, dir: &Path, next: &mut ModRecord) {
    let (fresh, twin) = (dir.join(&next.file), dir.join(format!("{}.disabled", next.file)));
    if !fresh.is_file() || !twin.is_file() { return; }
    let previous = load_records(root, tofu_id).into_iter().find(|r| r.subdir == next.subdir && r.file == next.file);
    let Ok(saved) = save_rollback_copy(&twin) else { return };
    if fs::remove_file(&twin).is_err() || fs::rename(&fresh, &twin).is_err() { return; }
    next.enabled = false;
    next.rollback = Some(Rollback { file: saved, version: previous.as_ref().map(|r| r.version.clone()).unwrap_or_default(), file_id: previous.as_ref().map(|r| r.file_id.clone()).unwrap_or_default(), sha1: previous.as_ref().and_then(|r| r.sha1.clone()), file_date: previous.and_then(|r| r.file_date) });
}

/// A newly downloaded file of a mod the Tofu already has (same source, project and folder): the older file is kept as a
/// rollback copy and removed so the game never loads two versions of one mod. A disabled older file keeps the new one
/// disabled. When the old file cannot be saved or removed it is left alone (two files beat a lost one).
pub(crate) fn retire_superseded_in(root: &Path, tofu_id: &str, dir: &Path, next: &mut ModRecord) {
    if !next.extracted { replace_disabled_twin(root, tofu_id, dir, next); }
    if next.project_id.is_empty() || next.source == "manual" || next.extracted { return; }
    let older: Vec<ModRecord> = load_records(root, tofu_id).into_iter()
        .filter(|r| r.source == next.source && r.project_id == next.project_id && r.subdir == next.subdir && r.file != next.file && !r.extracted)
        .collect();
    let mut retired = Vec::new();
    for old in older {
        let on_disk = [old.file.clone(), format!("{}.disabled", old.file)].into_iter().map(|name| dir.join(name)).find(|path| path.is_file());
        if let Some(path) = on_disk {
            let was_disabled = path.extension().is_some_and(|ext| ext == "disabled");
            let Ok(saved) = save_rollback_copy(&path) else { continue };
            if fs::remove_file(&path).is_err() { continue; }
            if was_disabled && next.enabled {
                let (current, disabled) = (dir.join(&next.file), dir.join(format!("{}.disabled", next.file)));
                if fs::rename(&current, &disabled).is_ok() { next.enabled = false; }
            }
            next.rollback = Some(Rollback { file: saved, version: old.version.clone(), file_id: old.file_id.clone(), sha1: old.sha1.clone(), file_date: old.file_date.clone() });
        }
        retired.push(old.file);
    }
    if retired.is_empty() { return; }
    let _guard = lock();
    let mut records = load_records(root, tofu_id);
    records.retain(|record| !(record.subdir == next.subdir && retired.contains(&record.file)));
    let _ = save_records(root, tofu_id, records);
}

/// Records a finished download after retiring older files of the same mod (see `retire_superseded_in`).
pub(crate) fn record_download(tofu_id: &str, dir: &Path, mut record: ModRecord) {
    let Some(root) = instances_root() else { return };
    retire_superseded_in(&root, tofu_id, dir, &mut record);
    let _ = upsert_record_in(&root, tofu_id, record);
}

pub(crate) fn drop_record(tofu_id: &str, subdir: &str, file: &str) {
    let Some(root) = instances_root() else { return };
    let _guard = lock();
    let mut records = load_records(&root, tofu_id);
    let before = records.len();
    records.retain(|record| !(record.subdir == subdir && record.file == file));
    if records.len() != before { let _ = save_records(&root, tofu_id, records); }
}

/// The content folder a file path sits in ("" for the main folder), judged by the folder's name.
pub(crate) fn subdir_of(path: &Path) -> String {
    path.parent().and_then(|dir| dir.file_name()).and_then(|n| n.to_str()).filter(|n| CONTENT_SUBDIRS.contains(n)).unwrap_or("").to_string()
}

/// `path` as it is on disk right now: the list may still hold the name from before the file was enabled or disabled.
pub(crate) fn existing_variant(path: &Path) -> Option<PathBuf> {
    if fs::symlink_metadata(path).is_ok() { return Some(path.to_path_buf()); }
    let name = path.file_name()?.to_str()?;
    let other = match name.strip_suffix(".disabled") { Some(base) => path.with_file_name(base), None => path.with_file_name(format!("{name}.disabled")) };
    fs::symlink_metadata(&other).is_ok().then_some(other)
}

/// Deletes a content file and, once no copy of it is left, the Tofu's record of it (so it no longer counts as installed).
pub(crate) fn delete_content_in(root: Option<&Path>, tofu_id: &str, path: &Path) -> Result<(), String> {
    // symlink_metadata so a dangling symlink can still be removed (`exists()` follows it and says "no").
    if fs::symlink_metadata(path).is_ok() { fs::remove_file(path).map_err(|e| format!("Unable to delete content: {e}"))?; }
    let (Some(root), Some(name)) = (root, path.file_name().and_then(|n| n.to_str())) else { return Ok(()) };
    if !valid_id(tofu_id, 120) { return Ok(()); }
    let base = base_name(name);
    if path.with_file_name(base).exists() || path.with_file_name(format!("{base}.disabled")).exists() { return Ok(()); }
    let _guard = lock();
    let subdir = subdir_of(path);
    let mut records = load_records(root, tofu_id);
    let before = records.len();
    records.retain(|record| !(record.subdir == subdir && record.file == base));
    if records.len() != before { save_records(root, tofu_id, records)?; }
    Ok(())
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
    /// Last modification (ms since the epoch); stands in for the file date of a mod linked by hand.
    pub modified_ms: u64,
    /// Another Tofu sharing this folder owns the file and this one does not: it is off while this Tofu is active.
    pub foreign: bool,
}

/// The files of one content folder joined with what Mochi remembers about them.
#[cfg(test)]
pub(crate) fn list_with_records(dir: &Path, records: &[ModRecord], subdir: &str) -> Result<Vec<InstanceMod>, String> {
    list_with_owners(dir, records, &HashSet::new(), subdir)
}

/// Like `list_with_records`, marking files that only other Tofus (`others`: base names) own.
pub(crate) fn list_with_owners(dir: &Path, records: &[ModRecord], others: &HashSet<String>, subdir: &str) -> Result<Vec<InstanceMod>, String> {
    let mut out = Vec::new();
    if !dir.is_dir() { return Ok(out); }
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())?.flatten() {
        let Ok(meta) = entry.metadata() else { continue };
        let name = entry.file_name().to_string_lossy().into_owned();
        if !meta.is_file() || name.starts_with('.') || !CONTENT_EXTENSIONS.contains(&content_extension(&name).as_str()) { continue; }
        let record = records.iter().find(|record| record.subdir == subdir && record.file == base_name(&name)).cloned();
        let foreign = record.is_none() && others.contains(base_name(&name));
        out.push(InstanceMod { enabled: !name.ends_with(".disabled"), path: entry.path().to_string_lossy().into_owned(), size: meta.len(), modified_ms: mtime_ms(&meta), filename: name, record, foreign });
    }
    out.sort_by_key(|item| item.filename.to_lowercase());
    Ok(out)
}

/// `siblings`: the other Tofus working on the same folder, so their files can be told apart from unmanaged ones.
#[tauri::command(async)]
pub fn list_instance_mods(tofu_id: String, path: String, subdir: Option<String>, siblings: Option<Vec<String>>) -> Result<Vec<InstanceMod>, String> {
    let subdir = subdir.unwrap_or_default();
    let dir = content_dir(&validate_path(&path)?, &subdir)?;
    let root = instances_root();
    let records = root.as_deref().map(|root| load_records(root, &tofu_id)).unwrap_or_default();
    let others: HashSet<String> = match (root.as_deref(), siblings) {
        (Some(root), Some(siblings)) => siblings.iter().filter(|id| **id != tofu_id).take(64)
            .flat_map(|id| load_records(root, id)).filter(|record| record.subdir == subdir).map(|record| record.file).collect(),
        _ => HashSet::new(),
    };
    list_with_owners(&dir, &records, &others, &subdir)
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
            let subdir = subdir_of(&p);
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
            } else {
                // Toggling a file in a Tofu makes it one of that Tofu's mods (it then follows Tofu switches).
                records.push(ModRecord { file: base.clone(), subdir: subdir.clone(), enabled, title: base.clone(), installed_at: now_ms(), ..ModRecord::default() });
                dirty = true;
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

/// A rollback copy that is not visible to `rollback_in` until `commit`: an update that fails must not disturb the copy an
/// earlier update saved under the same name. Dropping it without committing removes it again.
pub(crate) struct StagedRollback { staged: PathBuf, saved: PathBuf, name: String }

impl StagedRollback {
    /// Puts the copy in place (replacing an older one of the same name) and returns the saved name.
    pub(crate) fn commit(self) -> String {
        let _ = fs::rename(&self.staged, &self.saved);
        if let Some(store) = self.saved.parent() { prune_rollbacks(store); }
        self.name.clone()
    }
}

impl Drop for StagedRollback {
    fn drop(&mut self) { let _ = fs::remove_file(&self.staged); }
}

/// Keeps the file an update is about to replace so the update can be undone (see `StagedRollback`).
pub(crate) fn stage_rollback_copy(old: &Path) -> Result<StagedRollback, String> {
    let dir = old.parent().ok_or("Invalid content path.")?;
    let name = base_name(old.file_name().and_then(|n| n.to_str()).ok_or("Invalid content filename.")?).to_string();
    let store = rollback_dir(dir);
    fs::create_dir_all(&store).map_err(|e| format!("Unable to keep a rollback copy: {e}"))?;
    let staged = store.join(format!("{name}.mochi-pending"));
    let _ = fs::remove_file(&staged);
    // A hard link is enough: the old file is removed by name afterwards and its data lives on here.
    if fs::hard_link(old, &staged).is_err() { fs::copy(old, &staged).map_err(|e| format!("Unable to keep a rollback copy: {e}"))?; }
    Ok(StagedRollback { saved: store.join(&name), staged, name })
}

/// Keeps the file an update is about to replace so the update can be undone. Returns the saved name.
pub(crate) fn save_rollback_copy(old: &Path) -> Result<String, String> { Ok(stage_rollback_copy(old)?.commit()) }

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
    /// Every Tofu of the game (the active one included). When set, Tofus that work directly on `game_dir` share it: the
    /// active Tofu's mods are enabled and the other Tofus' mods disabled, and `<game_dir>/.mochi/tofus.json` is written.
    #[serde(default)]
    pub tofus: Vec<crate::modprofiles::TofuRef>,
}

#[derive(Debug, Clone, Serialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SyncReport {
    pub added: usize, pub removed: usize, pub unchanged: usize,
    /// Shared-folder Tofus: files switched on / off in place.
    pub enabled: usize, pub disabled: usize,
    pub conflicts: Vec<String>, pub errors: Vec<String>,
}

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
/// `src` None empties the lane: everything Mochi placed in `dest` is taken out again.
pub(crate) fn sync_lane(src: Option<&Path>, dest: &Path, tofu_id: &str, adopt: bool, progress: &mut dyn FnMut()) -> SyncReport {
    let mut report = SyncReport::default();
    let mut desired: Vec<(String, fs::Metadata)> = Vec::new();
    if let Some(Ok(read)) = src.map(fs::read_dir) {
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
            (Ok(existing), Some(_)) if existing.is_file() => match fs::remove_file(&target).map_err(|e| e.to_string()).and_then(|()| place(&dir_join(src.unwrap_or(dest), name), &target)) {
                Ok(()) => { report.added += 1; kept.push(entry); }
                Err(error) => report.errors.push(format!("{name}: {error}")),
            },
            (Ok(existing), None) => {
                #[cfg(unix)]
                let identical = fs::metadata(dir_join(src.unwrap_or(dest), name)).map(|s| same_file(&s, &existing)).unwrap_or(false);
                #[cfg(not(unix))]
                let identical = false;
                if identical { report.unchanged += 1; kept.push(entry); }
                else if adopt && existing.is_file() {
                    match fs::remove_file(&target).map_err(|e| e.to_string()).and_then(|()| place(&dir_join(src.unwrap_or(dest), name), &target)) {
                        Ok(()) => { report.added += 1; kept.push(entry); }
                        Err(error) => report.errors.push(format!("{name}: {error}")),
                    }
                } else { report.conflicts.push(format!("{name} already exists in the game folder and Mochi did not put it there")); }
            }
            (Ok(_), Some(_)) => report.conflicts.push(format!("{name} in the game folder is not a regular file")),
            (Err(_), _) => match place(&dir_join(src.unwrap_or(dest), name), &target) {
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

fn count_work(src: Option<&Path>, dest: &Path) -> usize {
    let Some(src) = src else { return load_managed(dest).len() };
    let files = fs::read_dir(src).map(|read| read.flatten().filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false)).count()).unwrap_or(0);
    files + load_managed(dest).len()
}

pub(crate) fn merge(into: &mut SyncReport, other: SyncReport) {
    into.added += other.added; into.removed += other.removed; into.unchanged += other.unchanged; into.enabled += other.enabled; into.disabled += other.disabled;
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

/// Runs the whole sync for a launch or a Tofu switch. `on_progress` is called as files are handled.
pub fn run_sync(request: &ModSyncRequest, on_progress: &dyn Fn(usize, usize)) -> Result<SyncReport, String> {
    run_sync_in(instances_root().as_deref(), request, on_progress)
}

/// `run_sync` with the records folder passed in (tests use a temporary one).
pub(crate) fn run_sync_in(records: Option<&Path>, request: &ModSyncRequest, on_progress: &dyn Fn(usize, usize)) -> Result<SyncReport, String> {
    let store = validate_path(&request.store_dir)?;
    let game = validate_sync_dir(&request.game_dir)?;
    let content_root = request.content_root.as_deref().filter(|root| !root.trim().is_empty()).map(validate_sync_dir).transpose()?;
    let direct = same_dir(&store, &game);
    let shared = !request.tofus.is_empty();
    let mut report = SyncReport::default();
    // Tofus sharing the game folder: enable the active one's mods in place and disable the other Tofus' mods.
    if shared {
        if let Some(root) = records { merge(&mut report, crate::modprofiles::apply_membership(root, &game, content_root.as_deref(), &request.tofu_id, &request.tofus)); }
    }
    if direct && !shared { return Ok(report); }
    // A Tofu working on the game folder itself copies nothing in; whatever a separate Tofu placed there before is taken out.
    let source = |path: PathBuf| if direct { None } else { Some(path) };
    let mut lanes: Vec<(Option<PathBuf>, PathBuf)> = vec![(source(store.clone()), game.clone())];
    if let Some(root) = &content_root {
        for sub in CONTENT_SUBDIRS { lanes.push((source(store.join(sub)), root.join(sub))); }
    }
    let total: usize = lanes.iter().map(|(src, dest)| count_work(src.as_deref(), dest)).sum();
    let done = std::cell::Cell::new(0usize);
    for (src, dest) in &lanes {
        let mut tick = || { done.set(done.get() + 1); on_progress(done.get().min(total), total); };
        merge(&mut report, sync_lane(src.as_deref(), dest, &request.tofu_id, request.adopt_unmanaged, &mut tick));
    }
    if shared {
        if let Some(root) = records {
            if let Err(error) = crate::modprofiles::write_manifest(root, &game, &request.tofu_id, &request.tofus) { report.errors.push(error); }
        }
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
        ModSyncRequest { tofu_id: tofu.into(), store_dir: store.to_string_lossy().into(), game_dir: game.to_string_lossy().into(), content_root: None, adopt_unmanaged: false, tofus: Vec::new() }
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
    fn a_new_download_retires_the_older_file_of_the_same_mod() {
        let base = temp("supersede");
        let (data, dir) = (base.join("data"), base.join("mods"));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("m-1.jar.disabled"), b"old").unwrap();
        fs::write(dir.join("other.jar"), b"keep").unwrap();
        let input = |file_id: &str, project: &str| RecordInput { source: "nexus".into(), project_id: project.into(), file_id: file_id.into(), version: file_id.into(), ..Default::default() };
        let mut old = input("1", "P").into_record("m-1.jar", "", None);
        old.enabled = false;
        upsert_record_in(&data, "t", old).unwrap();
        upsert_record_in(&data, "t", input("9", "Q").into_record("other.jar", "", None)).unwrap();

        fs::write(dir.join("m-2.jar"), b"new").unwrap();
        let mut next = input("2", "P").into_record("m-2.jar", "", None);
        retire_superseded_in(&data, "t", &dir, &mut next);
        upsert_record_in(&data, "t", next).unwrap();

        assert!(!dir.join("m-1.jar.disabled").exists(), "old file removed");
        assert!(rollback_dir(&dir).join("m-1.jar").is_file(), "old file kept for rollback");
        assert!(dir.join("m-2.jar.disabled").is_file(), "disabled state carried over");
        assert!(dir.join("other.jar").is_file(), "other mods untouched");
        let records = load_records(&data, "t");
        assert_eq!(records.len(), 2);
        let new = records.iter().find(|r| r.project_id == "P").unwrap();
        assert_eq!((new.file.as_str(), new.enabled), ("m-2.jar", false));
        assert_eq!(new.rollback.as_ref().map(|r| r.version.as_str()), Some("1"));

        // Re-downloading the same file name, or a manual file, retires nothing.
        let mut same = input("2", "P").into_record("m-2.jar", "", None);
        retire_superseded_in(&data, "t", &dir, &mut same);
        assert!(same.rollback.is_none());
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
    fn conflict_check_facts_are_stored_cleaned_and_optional() {
        let strings = |items: &[&str]| items.iter().map(|item| item.to_string()).collect::<Vec<_>>();
        let input = |source: &str| RecordInput { source: source.into(), game_versions: strings(&["1.20.1", " ", "1.20.4"]), loaders: strings(&["fabric"]), requires: strings(&["P1", &"x".repeat(200)]), incompatible: strings(&["P2"]), ..Default::default() };
        let record = input("modrinth").into_record("a.jar", "", None);
        assert_eq!(record.game_versions, strings(&["1.20.1", "1.20.4"]));
        assert_eq!(record.loaders, strings(&["fabric"]));
        assert_eq!(record.requires.len(), 2);
        assert_eq!(record.requires[1].len(), 80);
        assert_eq!(record.incompatible, strings(&["P2"]));
        // CurseForge terms: nothing from its API is kept beyond what identifies the file.
        let cf = input("curseforge").into_record("a.jar", "", None);
        assert!(cf.game_versions.is_empty() && cf.loaders.is_empty() && cf.requires.is_empty() && cf.incompatible.is_empty());
        // Old mods.json files (no new fields) still load, and empty lists are not written back.
        let old: ModRecord = serde_json::from_str(r#"{"file":"a.jar","source":"modrinth","projectId":"P"}"#).unwrap();
        assert!(old.requires.is_empty() && old.enabled);
        let json = serde_json::to_string(&old).unwrap();
        assert!(!json.contains("requires") && !json.contains("gameVersions"));
        assert!(serde_json::to_string(&record).unwrap().contains("\"requires\""));
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

    #[test]
    fn deleting_a_file_forgets_its_record() {
        let base = temp("delete");
        let (data, dir) = (base.join("data"), base.join("mods"));
        fs::create_dir_all(dir.join("resourcepacks")).unwrap();
        fs::write(dir.join("a.jar.disabled"), b"a").unwrap();
        fs::write(dir.join("keep.jar"), b"k").unwrap();
        fs::write(dir.join("resourcepacks/a.jar"), b"same name, other folder").unwrap();
        for (file, subdir) in [("a.jar", ""), ("keep.jar", ""), ("a.jar", "resourcepacks")] {
            upsert_record_in(&data, "t", RecordInput { source: "modrinth".into(), project_id: format!("p-{file}-{subdir}"), ..Default::default() }.into_record(file, subdir, None)).unwrap();
        }
        // Deleting the disabled copy removes the record of that folder only.
        delete_content_in(Some(&data), "t", &dir.join("a.jar.disabled")).unwrap();
        assert!(!dir.join("a.jar.disabled").exists());
        let left: Vec<(String, String)> = load_records(&data, "t").into_iter().map(|r| (r.file, r.subdir)).collect();
        assert_eq!(left.len(), 2);
        assert!(left.contains(&("keep.jar".into(), "".into())) && left.contains(&("a.jar".into(), "resourcepacks".into())));
        // Deleting something already gone is fine, and without a Tofu id the records stay.
        delete_content_in(Some(&data), "t", &dir.join("a.jar.disabled")).unwrap();
        fs::write(dir.join("other.jar"), b"o").unwrap();
        delete_content_in(None, "", &dir.join("other.jar")).unwrap();
        assert_eq!(load_records(&data, "t").len(), 2);
        // The record stays while the other on/off copy of the file is still there.
        fs::write(dir.join("keep.jar.disabled"), b"twin").unwrap();
        delete_content_in(Some(&data), "t", &dir.join("keep.jar")).unwrap();
        assert!(!dir.join("keep.jar").exists());
        assert_eq!(load_records(&data, "t").len(), 2);
        delete_content_in(Some(&data), "t", &dir.join("keep.jar.disabled")).unwrap();
        assert_eq!(load_records(&data, "t").len(), 1);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn a_failed_update_keeps_the_earlier_rollback_copy() {
        let base = temp("staged");
        let dir = base.join("mods");
        fs::create_dir_all(&dir).unwrap();
        // v1 was replaced by v2 under the same name; the rollback copy holds v1.
        fs::write(dir.join("m.jar"), b"v1").unwrap();
        save_rollback_copy(&dir.join("m.jar")).unwrap();
        // Downloads arrive as a new file renamed into place, never as an in-place rewrite of the hard-linked data.
        fs::remove_file(dir.join("m.jar")).unwrap();
        fs::write(dir.join("m.jar"), b"v2").unwrap();
        {
            // The next update (v3) starts and then fails: the staged copy is dropped without being committed.
            let _staged = stage_rollback_copy(&dir.join("m.jar")).unwrap();
        }
        assert_eq!(fs::read(rollback_dir(&dir).join("m.jar")).unwrap(), b"v1");
        assert_eq!(fs::read_dir(rollback_dir(&dir)).unwrap().count(), 1, "no staging file left behind");
        // When the update succeeds the copy of v2 takes over.
        stage_rollback_copy(&dir.join("m.jar")).unwrap().commit();
        assert_eq!(fs::read(rollback_dir(&dir).join("m.jar")).unwrap(), b"v2");
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn a_list_entry_from_before_a_toggle_still_finds_its_file() {
        let base = temp("variant");
        fs::write(base.join("a.jar.disabled"), b"a").unwrap();
        fs::write(base.join("b.jar"), b"b").unwrap();
        assert_eq!(existing_variant(&base.join("a.jar")), Some(base.join("a.jar.disabled")));
        assert_eq!(existing_variant(&base.join("b.jar.disabled")), Some(base.join("b.jar")));
        assert_eq!(existing_variant(&base.join("b.jar")), Some(base.join("b.jar")));
        assert_eq!(existing_variant(&base.join("gone.jar")), None);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn redownloading_a_disabled_mod_does_not_leave_two_copies() {
        let base = temp("twin");
        let (data, dir) = (base.join("data"), base.join("mods"));
        fs::create_dir_all(&dir).unwrap();
        let input = |file_id: &str| RecordInput { source: "modrinth".into(), project_id: "P".into(), file_id: file_id.into(), version: file_id.into(), ..Default::default() };
        let mut old = input("1").into_record("m.jar", "", None);
        old.enabled = false;
        upsert_record_in(&data, "t", old).unwrap();
        fs::write(dir.join("m.jar.disabled"), b"old build").unwrap();
        fs::write(dir.join("m.jar"), b"fresh build").unwrap();
        let mut next = input("2").into_record("m.jar", "", None);
        retire_superseded_in(&data, "t", &dir, &mut next);
        assert!(!next.enabled, "the user's choice to keep it off is kept");
        assert!(!dir.join("m.jar").exists());
        assert_eq!(fs::read(dir.join("m.jar.disabled")).unwrap(), b"fresh build");
        assert_eq!(fs::read(rollback_dir(&dir).join("m.jar")).unwrap(), b"old build");
        assert_eq!(next.rollback.as_ref().map(|r| r.version.as_str()), Some("1"));
        let _ = fs::remove_dir_all(&base);
    }
}
