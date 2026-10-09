//! Storage manager (Settings > Storage): measures where disk space goes and clears Mochi's own caches.
//!
//! Measuring runs on background threads (two at a time) and reports each location through the `storage-scan-progress`
//! event as it goes, so the page fills in incrementally; `cancel_storage_scan` stops it. Game and mod folders come from
//! the frontend and are only ever measured. Everything Mochi can delete is found here from Mochi's own folders (the
//! `ClearKind` enum is the whole list, there is no path argument), and nothing below a symlink is followed or removed.

use crate::dirsize::{self, DirSize};
use crate::util::{blocking, MutexExt};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, VecDeque},
    fs,
    path::{Component, Path, PathBuf},
    sync::{atomic::{AtomicBool, AtomicU64, Ordering}, Arc, Mutex},
    time::{Duration, SystemTime},
};
use tauri::{AppHandle, Emitter};

const PROGRESS_EVENT: &str = "storage-scan-progress";
const FINISHED_EVENT: &str = "storage-scan-finished";
const CONCURRENCY: usize = 2;
/// Download leftovers younger than this are never removed: the download may still be running.
const MIN_TEMP_AGE_SECS: u64 = 3600;
const MAX_REMOVE_DEPTH: usize = 4;

/// The only things this module deletes. Anything else fails to parse.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ClearKind { ArtworkCache, DownloadTemp, RollbackCopies, Snapshots, Logs }

#[derive(Debug, Deserialize)]
pub struct GameLoc { pub id: String, pub name: String, pub path: String }

#[derive(Debug, Deserialize)]
pub struct TofuLoc { pub id: String, pub name: String, #[serde(default)] pub folders: Vec<String> }

#[derive(Debug, Default, Deserialize)]
#[serde(default)]
pub struct ScanRequest { pub games: Vec<GameLoc>, pub tofus: Vec<TofuLoc> }

/// One row of the breakdown. `inside` names the category whose size already contains this one.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Location {
    pub key: String,
    pub name: String,
    pub category: &'static str,
    pub path: Option<String>,
    pub clear: Option<ClearKind>,
    pub inside: Option<&'static str>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanStarted { pub job: u64, pub locations: Vec<Location> }

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Progress { pub job: u64, pub key: String, pub bytes: u64, pub files: u64, pub truncated: bool, pub done: bool, pub error: Option<String> }

#[derive(Debug, Clone, Copy, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClearOutcome { pub files: u64, pub bytes: u64 }

pub struct Roots { pub config: PathBuf, pub data: PathBuf }

enum Measure {
    /// `optional` folders that do not exist count as empty instead of failing.
    Dirs { paths: Vec<PathBuf>, optional: bool },
    Rollback(Vec<PathBuf>),
    Temp(Vec<PathBuf>),
}

struct Task { key: String, measure: Measure }

struct Plan { locations: Vec<Location>, tasks: Vec<Task>, folders: Vec<PathBuf> }

// ---------------------------------------------------------------------------
// What exists
// ---------------------------------------------------------------------------

fn absolute(path: &str) -> Option<PathBuf> {
    let path = PathBuf::from(path.trim());
    (path.is_absolute() && !path.components().any(|part| matches!(part, Component::ParentDir))).then_some(path)
}

/// The folders a Tofu keeps Mochi's files in: its own folder and, for Minecraft, the resource and shader pack folders beside `mods`.
fn content_folders(folder: &Path) -> Vec<PathBuf> {
    let mut all = vec![folder.to_path_buf()];
    all.extend(crate::modinstance::CONTENT_SUBDIRS.iter().map(|name| folder.join(name)));
    all.into_iter().filter(|path| fs::metadata(path).is_ok_and(|meta| meta.is_dir())).collect()
}

fn is_real_dir(path: &Path) -> bool { fs::symlink_metadata(path).is_ok_and(|meta| meta.is_dir()) }

fn rollback_dirs(folders: &[PathBuf]) -> Vec<PathBuf> {
    let mut found: Vec<PathBuf> = folders.iter().flat_map(|folder| content_folders(folder)).map(|dir| crate::modinstance::rollback_dir(&dir)).filter(|dir| is_real_dir(dir)).collect();
    found.sort();
    found.dedup();
    found
}

/// Leftovers of downloads that never finished: `(path, is_folder)`.
fn temp_entries(folders: &[PathBuf]) -> Vec<(PathBuf, bool)> {
    let mut dirs: Vec<PathBuf> = folders.iter().flat_map(|folder| content_folders(folder)).collect();
    dirs.sort();
    dirs.dedup();
    let mut found = Vec::new();
    for dir in dirs {
        let Ok(entries) = fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let Ok(meta) = entry.metadata() else { continue };
            let symlink = fs::symlink_metadata(entry.path()).is_ok_and(|meta| meta.is_symlink());
            if symlink { continue; }
            let temp_file = meta.is_file() && name.contains(crate::downloads::TEMP_MARKER);
            let backup_dir = meta.is_dir() && name.starts_with('.') && name.contains(crate::downloads::BACKUP_MARKER);
            if temp_file || backup_dir { found.push((entry.path(), meta.is_dir())); }
        }
    }
    found
}

fn build_plan(roots: &Roots, request: &ScanRequest) -> Plan {
    let mut locations = Vec::new();
    let mut tasks = Vec::new();
    let mut folders = Vec::new();
    let mut mochi = |key: &str, name: &str, category: &'static str, path: PathBuf, clear: Option<ClearKind>| {
        locations.push(Location { key: format!("mochi:{key}"), name: name.into(), category, path: Some(path.to_string_lossy().into_owned()), clear, inside: None });
        tasks.push(Task { key: format!("mochi:{key}"), measure: Measure::Dirs { paths: vec![path], optional: true } });
    };
    mochi("artwork", "Artwork cache", "artwork", roots.config.join("game-artwork"), Some(ClearKind::ArtworkCache));
    mochi("themes", "Themes", "themes", roots.config.join("themes"), None);
    mochi("fonts", "Theme fonts", "themes", roots.config.join("fonts"), None);
    mochi("sound-packs", "Sound packs", "sound", roots.config.join("sound-packs"), None);
    mochi("logs", "Game logs", "logs", roots.data.join("logs"), Some(ClearKind::Logs));
    mochi("snapshots", "Snapshots", "snapshots", roots.data.join("snapshots"), Some(ClearKind::Snapshots));
    mochi("save-backups", "Save backups", "backups", roots.data.join("save-backups"), None);
    mochi("instances", "Mod records", "data", roots.data.join("instances"), None);
    mochi("prefixes", "Wine prefixes", "data", roots.data.join("prefixes"), None);

    for game in &request.games {
        let key = format!("game:{}", game.id);
        locations.push(Location { key: key.clone(), name: game.name.clone(), category: "games", path: Some(game.path.clone()), clear: None, inside: None });
        let paths = absolute(&game.path).into_iter().collect();
        tasks.push(Task { key, measure: Measure::Dirs { paths, optional: false } });
    }
    for tofu in &request.tofus {
        let key = format!("tofu:{}", tofu.id);
        let paths: Vec<PathBuf> = tofu.folders.iter().filter_map(|folder| absolute(folder)).collect();
        folders.extend(paths.iter().cloned());
        locations.push(Location { key: key.clone(), name: tofu.name.clone(), category: "mods", path: paths.first().map(|path| path.to_string_lossy().into_owned()), clear: None, inside: None });
        tasks.push(Task { key, measure: Measure::Dirs { paths, optional: false } });
    }
    folders.sort();
    folders.dedup();
    if !folders.is_empty() {
        locations.push(Location { key: "mochi:rollback".into(), name: "Mod rollback copies".into(), category: "rollback", path: None, clear: Some(ClearKind::RollbackCopies), inside: Some("mods") });
        tasks.push(Task { key: "mochi:rollback".into(), measure: Measure::Rollback(folders.clone()) });
        locations.push(Location { key: "mochi:download-temp".into(), name: "Unfinished downloads".into(), category: "downloads", path: None, clear: Some(ClearKind::DownloadTemp), inside: Some("mods") });
        tasks.push(Task { key: "mochi:download-temp".into(), measure: Measure::Temp(folders.clone()) });
    }
    Plan { locations, tasks, folders }
}

// ---------------------------------------------------------------------------
// Measuring
// ---------------------------------------------------------------------------

/// Adds up folders; `report` gets the running total (including what earlier folders of the same task added).
fn sum_dirs(paths: &[PathBuf], optional: bool, cancel: &AtomicBool, report: &mut dyn FnMut(&DirSize)) -> Result<DirSize, String> {
    let mut total = DirSize { bytes: 0, files: 0, truncated: false };
    if paths.is_empty() { return Err("No folder is set.".into()); }
    for path in paths {
        if cancel.load(Ordering::Relaxed) { total.truncated = true; break; }
        if optional && !path.exists() { continue; }
        let base = total.clone();
        let size = dirsize::dir_size_cached_ctl(&path.to_string_lossy(), Some(cancel), &mut |part| report(&DirSize { bytes: base.bytes + part.bytes, files: base.files + part.files, truncated: false }))?;
        total = DirSize { bytes: total.bytes.saturating_add(size.bytes), files: total.files + size.files, truncated: total.truncated || size.truncated };
    }
    Ok(total)
}

fn measure(measure: &Measure, cancel: &AtomicBool, report: &mut dyn FnMut(&DirSize)) -> Result<DirSize, String> {
    match measure {
        Measure::Dirs { paths, optional } => sum_dirs(paths, *optional, cancel, report),
        Measure::Rollback(folders) => { let dirs = rollback_dirs(folders); if dirs.is_empty() { Ok(DirSize { bytes: 0, files: 0, truncated: false }) } else { sum_dirs(&dirs, true, cancel, report) } }
        Measure::Temp(folders) => {
            let mut total = DirSize { bytes: 0, files: 0, truncated: false };
            for (path, is_dir) in temp_entries(folders) {
                if cancel.load(Ordering::Relaxed) { total.truncated = true; break; }
                if is_dir {
                    let size = dirsize::dir_size(&path.to_string_lossy())?;
                    total = DirSize { bytes: total.bytes.saturating_add(size.bytes), files: total.files + size.files, truncated: total.truncated || size.truncated };
                } else if let Ok(meta) = fs::metadata(&path) { total.bytes = total.bytes.saturating_add(meta.len()); total.files += 1; }
            }
            Ok(total)
        }
    }
}

/// Runs the tasks on `CONCURRENCY` threads and calls `emit` for every progress step and result. A cancelled scan stops
/// taking tasks and reports nothing more for the one it was in.
fn run(job: u64, tasks: Vec<Task>, cancel: &AtomicBool, emit: &(dyn Fn(Progress) + Sync)) {
    let queue = Mutex::new(VecDeque::from(tasks));
    std::thread::scope(|scope| {
        for _ in 0..CONCURRENCY {
            scope.spawn(|| loop {
                if cancel.load(Ordering::Relaxed) { break; }
                let Some(task) = queue.lock_recover().pop_front() else { break };
                let step = |size: &DirSize, done: bool, error: Option<String>| Progress { job, key: task.key.clone(), bytes: size.bytes, files: size.files, truncated: size.truncated, done, error };
                let result = measure(&task.measure, cancel, &mut |size| emit(step(size, false, None)));
                if cancel.load(Ordering::Relaxed) { break; }
                match result {
                    Ok(size) => emit(step(&size, true, None)),
                    Err(error) => emit(step(&DirSize { bytes: 0, files: 0, truncated: false }, true, Some(error))),
                }
            });
        }
    });
}

fn jobs() -> &'static Mutex<HashMap<u64, Arc<AtomicBool>>> {
    static MAP: std::sync::OnceLock<Mutex<HashMap<u64, Arc<AtomicBool>>>> = std::sync::OnceLock::new();
    MAP.get_or_init(Default::default)
}

/// Tofu folders of the latest scan: the only places rollback copies and unfinished downloads are looked for.
fn known_folders() -> &'static Mutex<Vec<PathBuf>> {
    static FOLDERS: std::sync::OnceLock<Mutex<Vec<PathBuf>>> = std::sync::OnceLock::new();
    FOLDERS.get_or_init(Default::default)
}

fn roots(app: &AppHandle) -> Result<Roots, String> {
    Ok(Roots { config: crate::themes::config_dir(app)?, data: crate::modinstance::data_dir().ok_or("Mochi is still starting.")? })
}

/// Starts measuring in the background and returns the job id plus the rows to expect. Results arrive as
/// `storage-scan-progress` events; `storage-scan-finished` ends the job. A new scan cancels any earlier one.
#[tauri::command]
pub async fn scan_storage(app: AppHandle, request: ScanRequest) -> Result<ScanStarted, String> {
    static NEXT_JOB: AtomicU64 = AtomicU64::new(1);
    let roots = roots(&app)?;
    let plan = blocking(move || build_plan(&roots, &request)).await?;
    let Plan { locations, tasks, folders } = plan;
    *known_folders().lock_recover() = folders;
    let job = NEXT_JOB.fetch_add(1, Ordering::Relaxed);
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut running = jobs().lock_recover();
        for flag in running.values() { flag.store(true, Ordering::Relaxed); }
        running.insert(job, cancel.clone());
    }
    std::thread::spawn(move || {
        run(job, tasks, &cancel, &|progress| { let _ = app.emit(PROGRESS_EVENT, progress); });
        jobs().lock_recover().remove(&job);
        let _ = app.emit(FINISHED_EVENT, serde_json::json!({ "job": job, "cancelled": cancel.load(Ordering::Relaxed) }));
    });
    Ok(ScanStarted { job, locations })
}

#[tauri::command]
pub fn cancel_storage_scan(job: u64) {
    if let Some(flag) = jobs().lock_recover().get(&job) { flag.store(true, Ordering::Relaxed); }
}

// ---------------------------------------------------------------------------
// Clearing
// ---------------------------------------------------------------------------

fn cutoff(days: Option<u32>, floor_secs: u64) -> Option<SystemTime> {
    let secs = days.map_or(0, |days| u64::from(days) * 86_400).max(floor_secs);
    if days.is_none() && floor_secs == 0 { return None; }
    SystemTime::now().checked_sub(Duration::from_secs(secs))
}

/// Entries whose time cannot be read are kept.
fn is_old(meta: &fs::Metadata, cutoff: Option<SystemTime>) -> bool {
    cutoff.is_none_or(|limit| meta.modified().is_ok_and(|time| time <= limit))
}

fn remove_path(path: &Path, meta: &fs::Metadata, out: &mut ClearOutcome) -> bool {
    let (bytes, files) = if meta.is_dir() && !meta.file_type().is_symlink() { dirsize::dir_size(&path.to_string_lossy()).map_or((0, 0), |size| (size.bytes, size.files)) } else { (meta.len(), 1) };
    let removed = if meta.is_dir() && !meta.file_type().is_symlink() { fs::remove_dir_all(path) } else { fs::remove_file(path) };
    if removed.is_ok() { out.bytes = out.bytes.saturating_add(bytes); out.files += files; }
    removed.is_ok()
}

/// Removes the direct children of `dir` (files or whole folders) that are older than `cutoff`.
fn remove_children(dir: &Path, cutoff: Option<SystemTime>, out: &mut ClearOutcome) -> Result<(), String> {
    match fs::symlink_metadata(dir) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(format!("Unable to read {}: {error}", dir.display())),
        Ok(meta) if !meta.is_dir() => return Err(format!("{} is a link or not a folder; Mochi will not clear it.", dir.display())),
        Ok(_) => {}
    }
    for entry in fs::read_dir(dir).map_err(|error| format!("Unable to read {}: {error}", dir.display()))?.flatten() {
        let Ok(meta) = fs::symlink_metadata(entry.path()) else { continue };
        if is_old(&meta, cutoff) { remove_path(&entry.path(), &meta, out); }
    }
    Ok(())
}

/// Removes the files below `dir` that are older than `cutoff` and the folders that end up empty (never `dir` itself).
fn remove_files_deep(dir: &Path, cutoff: Option<SystemTime>, out: &mut ClearOutcome, depth: usize) -> Result<(), String> {
    match fs::symlink_metadata(dir) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(format!("Unable to read {}: {error}", dir.display())),
        Ok(meta) if !meta.is_dir() => return Err(format!("{} is a link or not a folder; Mochi will not clear it.", dir.display())),
        Ok(_) => {}
    }
    for entry in fs::read_dir(dir).map_err(|error| format!("Unable to read {}: {error}", dir.display()))?.flatten() {
        let path = entry.path();
        let Ok(meta) = fs::symlink_metadata(&path) else { continue };
        if meta.file_type().is_symlink() { continue; }
        if meta.is_dir() {
            if depth < MAX_REMOVE_DEPTH { let _ = remove_files_deep(&path, cutoff, out, depth + 1); let _ = fs::remove_dir(&path); }
        } else if is_old(&meta, cutoff) { remove_path(&path, &meta, out); }
    }
    Ok(())
}

/// Deletes one kind of Mochi-owned data. `older_than_days` keeps newer entries (`None` removes everything of that kind,
/// except unfinished downloads younger than an hour and snapshots, which always need an age).
pub fn clear_in(roots: &Roots, folders: &[PathBuf], kind: ClearKind, older_than_days: Option<u32>) -> Result<ClearOutcome, String> {
    let mut out = ClearOutcome::default();
    match kind {
        ClearKind::ArtworkCache => remove_children(&roots.config.join("game-artwork"), cutoff(older_than_days, 0), &mut out)?,
        ClearKind::Logs => remove_files_deep(&roots.data.join("logs"), cutoff(older_than_days, 0), &mut out, 0)?,
        ClearKind::Snapshots => {
            if older_than_days.is_none() { return Err("Choose how old a snapshot must be to be removed.".into()); }
            remove_children(&roots.data.join("snapshots"), cutoff(older_than_days, 0), &mut out)?;
        }
        ClearKind::RollbackCopies => {
            let limit = cutoff(older_than_days, 0);
            for dir in rollback_dirs(folders) { remove_files_deep(&dir, limit, &mut out, MAX_REMOVE_DEPTH)?; let _ = fs::remove_dir(&dir); }
        }
        ClearKind::DownloadTemp => {
            let limit = cutoff(older_than_days, MIN_TEMP_AGE_SECS);
            for (path, _) in temp_entries(folders) {
                let Ok(meta) = fs::symlink_metadata(&path) else { continue };
                if is_old(&meta, limit) { remove_path(&path, &meta, &mut out); }
            }
        }
    }
    dirsize::clear_cache();
    Ok(out)
}

#[tauri::command]
pub async fn clear_storage_location(app: AppHandle, kind: ClearKind, older_than_days: Option<u32>) -> Result<ClearOutcome, String> {
    let roots = roots(&app)?;
    let folders = known_folders().lock_recover().clone();
    blocking(move || clear_in(&roots, &folders, kind, older_than_days)).await?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;

    fn temp(name: &str) -> PathBuf {
        static N: AtomicUsize = AtomicUsize::new(0);
        let dir = std::env::temp_dir().join(format!("mochi-storage-{name}-{}-{}", std::process::id(), N.fetch_add(1, Ordering::Relaxed)));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn roots(base: &Path) -> Roots {
        let roots = Roots { config: base.join("config"), data: base.join("data") };
        fs::create_dir_all(&roots.config).unwrap();
        fs::create_dir_all(&roots.data).unwrap();
        roots
    }

    fn file(path: &Path, bytes: usize, age_days: u64) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, vec![0u8; bytes]).unwrap();
        fs::File::options().write(true).open(path).unwrap().set_modified(SystemTime::now() - Duration::from_secs(age_days * 86_400)).unwrap();
    }

    #[test]
    fn unknown_kinds_do_not_parse() {
        assert_eq!(serde_json::from_str::<ClearKind>("\"artworkCache\"").unwrap(), ClearKind::ArtworkCache);
        for bad in ["\"games\"", "\"/etc\"", "\"installs\"", "\"\"", "\"../data\"", "3"] { assert!(serde_json::from_str::<ClearKind>(bad).is_err(), "{bad}"); }
    }

    #[test]
    fn artwork_cache_is_emptied_but_nothing_else_is_touched() {
        let base = temp("artwork");
        let roots = roots(&base);
        file(&roots.config.join("game-artwork/a.jpg"), 10, 0);
        file(&roots.config.join("game-artwork/nested/b.jpg"), 20, 0);
        file(&roots.config.join("themes/keep.json"), 5, 0);
        file(&roots.data.join("logs/g/1.log"), 5, 0);
        let out = clear_in(&roots, &[], ClearKind::ArtworkCache, None).unwrap();
        assert_eq!((out.files, out.bytes), (2, 30));
        assert!(roots.config.join("game-artwork").is_dir() && fs::read_dir(roots.config.join("game-artwork")).unwrap().next().is_none());
        assert!(roots.config.join("themes/keep.json").exists() && roots.data.join("logs/g/1.log").exists());
        // Nothing to clear (or no folder at all) is fine.
        assert_eq!(clear_in(&roots, &[], ClearKind::ArtworkCache, None).unwrap(), ClearOutcome::default());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn logs_and_snapshots_honour_the_age_filter() {
        let base = temp("age");
        let roots = roots(&base);
        file(&roots.data.join("logs/g/old.log"), 10, 40);
        file(&roots.data.join("logs/g/new.log"), 10, 1);
        file(&roots.data.join("logs/dead/old.log"), 10, 40);
        let out = clear_in(&roots, &[], ClearKind::Logs, Some(30)).unwrap();
        assert_eq!(out.files, 2);
        assert!(roots.data.join("logs/g/new.log").exists() && !roots.data.join("logs/g/old.log").exists());
        assert!(!roots.data.join("logs/dead").exists(), "emptied folders go too");
        assert!(roots.data.join("logs").is_dir());

        file(&roots.data.join("snapshots/s-old/state.json"), 100, 60);
        file(&roots.data.join("snapshots/s-new/state.json"), 100, 1);
        for entry in ["s-old", "s-new"] {
            let age = if entry == "s-old" { 60 } else { 1 };
            fs::File::open(roots.data.join("snapshots").join(entry)).unwrap().set_modified(SystemTime::now() - Duration::from_secs(age * 86_400)).unwrap();
        }
        assert!(clear_in(&roots, &[], ClearKind::Snapshots, None).is_err(), "snapshots always need an age");
        assert!(roots.data.join("snapshots/s-old").exists());
        let out = clear_in(&roots, &[], ClearKind::Snapshots, Some(30)).unwrap();
        assert_eq!((out.files, out.bytes), (1, 100));
        assert!(!roots.data.join("snapshots/s-old").exists() && roots.data.join("snapshots/s-new").exists());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn rollback_copies_and_download_leftovers_only_leave_their_own_files() {
        let base = temp("tofu");
        let roots = roots(&base);
        let tofu = base.join("Minecraft/mods");
        file(&tofu.join("sodium.jar"), 50, 100);
        file(&tofu.join(".mochi-rollback/sodium-old.jar"), 40, 100);
        file(&tofu.join(".mochi-rollback/fresh.jar"), 10, 0);
        file(&tofu.join("resourcepacks/.mochi-rollback/pack.zip"), 30, 100);
        file(&tofu.join("stale.jar.mochi-download-3"), 7, 3);
        file(&tofu.join("running.jar.mochi-download-4"), 9, 0);
        file(&tofu.join(".x.zip.mochi-backup-1/orig.jar"), 11, 3);
        fs::File::open(tofu.join(".x.zip.mochi-backup-1")).unwrap().set_modified(SystemTime::now() - Duration::from_secs(3 * 86_400)).unwrap();
        file(&tofu.join("not-ours.mochi-download"), 1, 3);
        let folders = vec![tofu.clone()];

        assert_eq!(rollback_dirs(&folders).len(), 2);
        let size = measure(&Measure::Rollback(folders.clone()), &AtomicBool::new(false), &mut |_| {}).unwrap();
        assert_eq!((size.bytes, size.files), (80, 3));
        let size = measure(&Measure::Temp(folders.clone()), &AtomicBool::new(false), &mut |_| {}).unwrap();
        assert_eq!(size.bytes, 7 + 9 + 11);

        let out = clear_in(&roots, &folders, ClearKind::DownloadTemp, None).unwrap();
        assert_eq!(out.files, 2, "the download that is still running is kept");
        assert!(tofu.join("running.jar.mochi-download-4").exists() && tofu.join("not-ours.mochi-download").exists() && !tofu.join("stale.jar.mochi-download-3").exists());

        let out = clear_in(&roots, &folders, ClearKind::RollbackCopies, Some(30)).unwrap();
        assert_eq!(out.files, 2);
        assert!(tofu.join(".mochi-rollback/fresh.jar").exists() && !tofu.join("resourcepacks/.mochi-rollback").exists());
        clear_in(&roots, &folders, ClearKind::RollbackCopies, None).unwrap();
        assert!(!tofu.join(".mochi-rollback").exists());
        assert_eq!(fs::read(tofu.join("sodium.jar")).unwrap().len(), 50, "mods are never touched");
        // Without a scanned Tofu there is nothing Mochi may look at.
        assert_eq!(clear_in(&roots, &[], ClearKind::RollbackCopies, None).unwrap(), ClearOutcome::default());
        let _ = fs::remove_dir_all(&base);
    }

    #[cfg(unix)]
    #[test]
    fn links_are_never_followed() {
        let base = temp("links");
        let roots = roots(&base);
        let outside = base.join("outside");
        file(&outside.join("precious.txt"), 10, 100);
        // A symlinked cache folder is refused outright.
        std::os::unix::fs::symlink(&outside, roots.config.join("game-artwork")).unwrap();
        assert!(clear_in(&roots, &[], ClearKind::ArtworkCache, None).is_err());
        // A link inside a real folder is removed as a link; its target survives.
        fs::create_dir_all(roots.data.join("logs/g")).unwrap();
        std::os::unix::fs::symlink(&outside, roots.data.join("logs/g/link")).unwrap();
        std::os::unix::fs::symlink(outside.join("precious.txt"), roots.data.join("logs/g/file-link")).unwrap();
        clear_in(&roots, &[], ClearKind::Logs, None).unwrap();
        assert!(outside.join("precious.txt").exists());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn the_plan_lists_mochi_locations_and_trusts_only_absolute_paths() {
        let base = temp("plan");
        let roots = roots(&base);
        let request = ScanRequest {
            games: vec![GameLoc { id: "g1".into(), name: "Game".into(), path: base.join("game").to_string_lossy().into_owned() }, GameLoc { id: "g2".into(), name: "Bad".into(), path: "../relative".into() }],
            tofus: vec![TofuLoc { id: "t1".into(), name: "Pack".into(), folders: vec![base.join("tofu").to_string_lossy().into_owned(), "rel/path".into()] }],
        };
        let plan = build_plan(&roots, &request);
        let keys: Vec<&str> = plan.locations.iter().map(|location| location.key.as_str()).collect();
        assert!(keys.contains(&"mochi:artwork") && keys.contains(&"mochi:logs") && keys.contains(&"game:g1") && keys.contains(&"tofu:t1") && keys.contains(&"mochi:rollback"));
        assert_eq!(plan.folders, vec![base.join("tofu")]);
        assert_eq!(plan.locations.len(), plan.tasks.len());
        let empty = build_plan(&roots, &ScanRequest::default());
        assert!(!empty.locations.iter().any(|location| location.key == "mochi:rollback"));
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn a_scan_reports_progress_per_location_and_errors_for_missing_folders() {
        let base = temp("scan");
        let roots = roots(&base);
        file(&roots.config.join("game-artwork/a.jpg"), 64, 0);
        file(&base.join("game/data.bin"), 1000, 0);
        let request = ScanRequest { games: vec![
            GameLoc { id: "g1".into(), name: "Game".into(), path: base.join("game").to_string_lossy().into_owned() },
            GameLoc { id: "gone".into(), name: "Gone".into(), path: base.join("nope").to_string_lossy().into_owned() },
        ], tofus: vec![] };
        let plan = build_plan(&roots, &request);
        let total = plan.tasks.len();
        let events = Mutex::new(Vec::new());
        run(7, plan.tasks, &AtomicBool::new(false), &|progress| events.lock_recover().push(progress));
        let events = events.into_inner().unwrap();
        let done: Vec<&Progress> = events.iter().filter(|event| event.done).collect();
        assert_eq!(done.len(), total, "every location finishes exactly once");
        assert!(events.iter().all(|event| event.job == 7));
        let find = |key: &str| done.iter().find(|event| event.key == key).unwrap();
        assert_eq!(find("mochi:artwork").bytes, 64);
        assert_eq!(find("mochi:logs").error, None, "an absent Mochi folder is just empty");
        assert_eq!((find("game:g1").bytes, find("game:g1").files), (1000, 1));
        assert!(find("game:gone").error.is_some());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn a_cancelled_scan_reports_nothing_and_stops_taking_work() {
        let base = temp("cancel");
        let roots = roots(&base);
        let plan = build_plan(&roots, &ScanRequest::default());
        let events = Mutex::new(Vec::new());
        run(1, plan.tasks, &AtomicBool::new(true), &|progress| events.lock_recover().push(progress));
        assert!(events.into_inner().unwrap().is_empty());

        // A walk that is cancelled gives up early and says its number is partial.
        let big = base.join("big");
        for index in 0..600 { file(&big.join(format!("f{index}")), 1, 0); }
        let cancelled = AtomicBool::new(true);
        let partial = sum_dirs(std::slice::from_ref(&big), false, &cancelled, &mut |_| {}).unwrap();
        assert!(partial.truncated && partial.files < 600);
        let full = sum_dirs(&[big], false, &AtomicBool::new(false), &mut |_| {}).unwrap();
        assert!(!full.truncated && full.files == 600);
        let _ = fs::remove_dir_all(&base);
    }
}
