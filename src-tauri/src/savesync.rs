//! Save sync: copies save backups through a folder the user chooses (kept in sync by Syncthing, Nextcloud, a mounted
//! WebDAV share, ...). Mochi never uploads anything itself.
//!
//! Layout: `<folder>/Mochi Saves/<sync key>/<snapshot id>.zip` plus `manifest.json` per key (id, created_at, device, size,
//! sha256, ...). The sync key comes from the game identity (see `savebackup::sync_key`), never from local paths, so the
//! same world on two computers lands in the same folder. Everything is written to a temporary file and renamed. Importing
//! verifies size and sha256 first: a file that is still arriving is "pending" (retried on the next sync, no error), a full-size
//! file with the wrong hash is reported as damaged. Imports are added to the local backup list and never restored
//! automatically. Files in the sync folder are only ever deleted when this device wrote them: by the local retention
//! setting, or by the explicit "remove from sync folder" action. `*.sync-conflict-*` files are ignored.
use crate::savebackup::{list_locations, load_index, location_dir, prune, save_index, BackupInfo, Ctx, Hints, WORK};
use crate::util::{blocking, fsio, hex, now_ms, valid_id, MutexExt};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{BufReader, Read, Write},
    path::{Path, PathBuf},
};

const FOLDER: &str = "Mochi Saves";
const MANIFEST: &str = "manifest.json";
const CONFIG: &str = "sync.json";
const MIN_INTERVAL_MS: u64 = 60_000;
const MAX_ERRORS: usize = 5;
const MAX_KNOWN: usize = 4000;
const MAX_MANIFEST_BYTES: u64 = 8 << 20;
const BUF: usize = 64 * 1024;
/// A manifest entry dated further ahead than this (a wrong clock, or a hostile manifest) is reported as damaged and skipped.
pub(crate) const MAX_FUTURE_MS: u64 = 3_600_000;

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct SyncConfig {
    pub enabled: bool,
    pub folder: String,
    pub device_id: String,
    /// Hash of this computer's identity when `device_id` was made; a copied app-data folder carries a different one.
    pub machine: String,
    pub last_sync_at: u64,
    pub imported: usize,
    pub exported: usize,
    pub pending: usize,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    pub enabled: bool,
    pub folder: String,
    pub device_name: String,
    pub last_sync_at: Option<u64>,
    /// Counts of the last sync.
    pub imported: usize,
    pub exported: usize,
    pub pending: usize,
    pub errors: Vec<String>,
    /// The folder exists right now (a share that is not mounted is not available).
    pub available: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncGame { pub piko_id: String, #[serde(default)] pub hints: Hints }

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
struct Entry {
    id: String,
    created_at: u64,
    device: String,
    device_id: String,
    size: u64,
    sha256: String,
    kind: String,
    entries: usize,
    files: usize,
    fingerprint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
struct Manifest { version: u32, key: String, label: String, snapshots: Vec<Entry> }

#[derive(Debug, Default, PartialEq)]
struct Tally { imported: usize, exported: usize, pending: usize, errors: Vec<String> }

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

fn load_config(ctx: &Ctx) -> SyncConfig { fs::read(ctx.root.join(CONFIG)).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok()).unwrap_or_default() }

fn save_config(ctx: &Ctx, config: &SyncConfig) -> Result<(), String> {
    fs::create_dir_all(&ctx.root).map_err(|e| format!("Unable to save the sync settings: {e}"))?;
    let bytes = serde_json::to_vec(config).map_err(|e| e.to_string())?;
    fsio::write_atomic_durable(&ctx.root.join(CONFIG), &bytes).map_err(|e| format!("Unable to save the sync settings: {e}"))
}

fn ensure_device_id(config: &mut SyncConfig) { ensure_device_id_for(config, &machine_fingerprint()); }

/// Keeps `device_id` tied to the computer: an id copied along with the app data (a clone, a restored disk image) would make two
/// computers believe they own the same snapshots, so it is replaced. Files in the folder that name the old id are then foreign
/// and are never pruned.
fn ensure_device_id_for(config: &mut SyncConfig, machine: &str) {
    if valid_id(&config.device_id, 40) && (config.machine.is_empty() || config.machine == machine) { config.machine = machine.to_string(); return; }
    config.machine = machine.to_string();
    let seed = format!("{}|{}|{}|{:?}", now_ms(), std::process::id(), device_name(), std::thread::current().id());
    config.device_id = hex(&Sha256::digest(seed.as_bytes()))[..12].to_string();
}

/// A hash (never the raw id) of what identifies this computer: the machine id on Linux, the platform UUID on macOS, else the host name.
fn machine_fingerprint() -> String {
    let raw = ["/etc/machine-id", "/var/lib/dbus/machine-id"].iter().find_map(|path| fs::read_to_string(path).ok().filter(|text| !text.trim().is_empty()))
        .or_else(|| std::process::Command::new("ioreg").args(["-rd1", "-c", "IOPlatformExpertDevice"]).output().ok().and_then(|out| String::from_utf8(out.stdout).ok())
            .and_then(|text| text.lines().find(|line| line.contains("IOPlatformUUID")).map(str::to_string)))
        .unwrap_or_else(device_name);
    hex(&Sha256::digest(format!("mochi-save-sync|{}", raw.trim()).as_bytes()))[..16].to_string()
}

fn device_name() -> String {
    let name = std::env::var("HOSTNAME").ok().filter(|name| !name.trim().is_empty())
        .or_else(|| fs::read_to_string("/etc/hostname").ok().filter(|name| !name.trim().is_empty()))
        .or_else(|| std::process::Command::new("hostname").output().ok().and_then(|out| String::from_utf8(out.stdout).ok()).filter(|name| !name.trim().is_empty()))
        .unwrap_or_else(|| "Unknown device".to_string());
    name.trim().chars().filter(|c| !c.is_control()).take(64).collect()
}

fn status_of(config: &SyncConfig) -> SyncStatus {
    SyncStatus {
        enabled: config.enabled, folder: config.folder.clone(), device_name: device_name(), last_sync_at: (config.last_sync_at > 0).then_some(config.last_sync_at),
        imported: config.imported, exported: config.exported, pending: config.pending, errors: config.errors.clone(),
        available: !config.folder.is_empty() && Path::new(&config.folder).is_dir(),
    }
}

/// The sync folder when sync is on and the folder exists (never created: an unmounted share must not be filled locally).
fn usable_folder(config: &SyncConfig) -> Result<PathBuf, String> {
    if !config.enabled || config.folder.is_empty() { return Err("Save sync is off.".into()); }
    let folder = PathBuf::from(&config.folder);
    if !folder.is_dir() { return Err("The sync folder is not available. Is the drive or share connected?".into()); }
    Ok(folder.join(FOLDER))
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

fn hash_file(path: &Path) -> std::io::Result<String> {
    let mut reader = BufReader::new(fs::File::open(path)?);
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; BUF];
    loop {
        let read = reader.read(&mut buf)?;
        if read == 0 { break; }
        hasher.update(&buf[..read]);
    }
    Ok(hex(&hasher.finalize()))
}

/// Copies `src` to `dest` through a temporary sibling that is flushed and renamed. With `expect`, the copy is thrown away
/// (InvalidData) unless its sha256 matches. Returns the sha256 and size written.
fn copy_atomic(src: &Path, dest: &Path, expect: Option<&str>) -> std::io::Result<(String, u64)> {
    let name = dest.file_name().and_then(|name| name.to_str()).unwrap_or("file");
    let temp = dest.with_file_name(format!(".{name}.mochi-part"));
    let result = (|| {
        let mut reader = BufReader::new(fs::File::open(src)?);
        let mut writer = fs::File::create(&temp)?;
        let mut hasher = Sha256::new();
        let mut buf = vec![0u8; BUF];
        let mut total = 0u64;
        loop {
            let read = reader.read(&mut buf)?;
            if read == 0 { break; }
            hasher.update(&buf[..read]);
            writer.write_all(&buf[..read])?;
            total += read as u64;
        }
        writer.sync_all()?;
        drop(writer);
        let sha = hex(&hasher.finalize());
        if expect.is_some_and(|expect| expect != sha) { return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "checksum mismatch")); }
        fs::rename(&temp, dest)?;
        Ok((sha, total))
    })();
    if result.is_err() { let _ = fs::remove_file(&temp); }
    result
}

fn read_manifest(dir: &Path) -> Manifest {
    let path = dir.join(MANIFEST);
    if !fs::metadata(&path).is_ok_and(|meta| meta.is_file() && meta.len() <= MAX_MANIFEST_BYTES) { return Manifest::default(); }
    fs::read(&path).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok()).unwrap_or_default()
}

fn write_manifest(dir: &Path, manifest: &Manifest) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(manifest).map_err(|e| e.to_string())?;
    fsio::write_atomic_durable(&dir.join(MANIFEST), &bytes).map_err(|e| format!("Unable to update the sync manifest: {e}"))
}

/// Entries other devices wrote that are safe to look at: well-formed ids, nothing from a conflict copy.
fn entry_ok(entry: &Entry) -> bool {
    valid_id(&entry.id, 90) && valid_id(&entry.device_id, 40) && !entry.id.contains("sync-conflict") && !entry.sha256.is_empty()
}

fn snapshot_file(dir: &Path, id: &str) -> PathBuf { dir.join(format!("{id}.zip")) }

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/// Copies the local backups of one location that are not in the sync folder yet and updates the manifest. Safety backups
/// (taken before a restore) and imported ones are never exported. Afterwards this device's oldest snapshots beyond the
/// local retention setting are removed from the folder (only files named in the manifest as this device's own).
fn export_key(ctx: &Ctx, config: &SyncConfig, base: &Path, key: &str) -> Result<usize, String> {
    let dir = location_dir(&ctx.root, key)?;
    let mut index = load_index(&dir);
    if !valid_id(&index.sync_key, 120) { return Ok(0); }
    let sdir = base.join(&index.sync_key);
    let mut manifest = read_manifest(&sdir);
    let before = manifest.clone();
    let mut exported = 0;
    let mut index_changed = false;
    let device = device_name();
    for backup in index.backups.iter_mut().filter(|backup| backup.origin.is_empty() && backup.kind != "safety") {
        if backup.sync_id.is_empty() { backup.sync_id = format!("{}-{}", backup.created_at, config.device_id); index_changed = true; }
        let id = backup.sync_id.clone();
        let dest = snapshot_file(&sdir, &id);
        let src = dir.join(format!("{}.zip", backup.created_at));
        let listed = manifest.snapshots.iter().any(|entry| entry.id == id && entry.size == backup.size);
        let present = fs::metadata(&dest).is_ok_and(|meta| meta.is_file() && meta.len() == backup.size);
        if listed && present { continue; }
        fs::create_dir_all(&sdir).map_err(|e| format!("Unable to create the sync folder: {e}"))?;
        let local_sha = hash_file(&src).map_err(|e| format!("Unable to read a local backup: {e}"))?;
        if !(present && hash_file(&dest).is_ok_and(|sha| sha == local_sha)) {
            copy_atomic(&src, &dest, Some(&local_sha)).map_err(|e| format!("Unable to copy a backup to the sync folder: {e}"))?;
            exported += 1;
        }
        let entry = Entry {
            id: id.clone(), created_at: backup.created_at, device: device.clone(), device_id: config.device_id.clone(), size: backup.size, sha256: local_sha,
            kind: backup.kind.clone(), entries: backup.entries, files: backup.files, fingerprint: backup.fingerprint.clone(),
        };
        manifest.snapshots.retain(|existing| existing.id != id);
        manifest.snapshots.push(entry);
        if !index.known.contains(&id) { index.known.push(id); }
    }
    // Retention for what this device wrote.
    let mut own: Vec<(u64, String)> = manifest.snapshots.iter().filter(|entry| entry.device_id == config.device_id && valid_id(&entry.id, 90)).map(|entry| (entry.created_at, entry.id.clone())).collect();
    own.sort();
    let surplus = own.len().saturating_sub(ctx.settings.keep.max(1));
    for (_, id) in own.into_iter().take(surplus) {
        if fs::remove_file(snapshot_file(&sdir, &id)).is_ok() || !snapshot_file(&sdir, &id).exists() { manifest.snapshots.retain(|entry| entry.id != id); }
    }
    manifest.snapshots.sort_by_key(|entry| entry.created_at);
    if manifest != before || !sdir.join(MANIFEST).is_file() && !manifest.snapshots.is_empty() {
        manifest.version = 1;
        manifest.key = index.sync_key.clone();
        manifest.label = index.label.clone();
        write_manifest(&sdir, &manifest)?;
    }
    if index.known.len() > MAX_KNOWN { let extra = index.known.len() - MAX_KNOWN; index.known.drain(..extra); index_changed = true; }
    if index_changed || exported > 0 { save_index(&dir, &index)?; }
    Ok(exported)
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

/// Adds snapshots other devices wrote that this device does not have (and has not had before) to the local list.
fn import_key(ctx: &Ctx, config: &SyncConfig, base: &Path, key: &str, tally: &mut Tally) -> Result<(), String> {
    let dir = location_dir(&ctx.root, key)?;
    let mut index = load_index(&dir);
    if !valid_id(&index.sync_key, 120) { return Ok(()); }
    let sdir = base.join(&index.sync_key);
    let manifest = read_manifest(&sdir);
    let horizon = now_ms().saturating_add(MAX_FUTURE_MS);
    let mut entries: Vec<Entry> = manifest.snapshots.into_iter().filter(entry_ok).filter(|entry| entry.device_id != config.device_id).collect();
    entries.retain(|entry| {
        let sane = entry.created_at > 0 && entry.created_at <= horizon;
        if !sane && !index.known.contains(&entry.id) { tally.errors.push(format!("A saved copy from {} has an impossible date and was skipped ({}).", entry.device, entry.id)); }
        sane
    });
    entries.sort_by_key(|entry| entry.created_at);
    let mut imported = 0;
    for entry in entries {
        if index.known.contains(&entry.id) || index.backups.iter().any(|backup| backup.sync_id == entry.id) { continue; }
        let source = snapshot_file(&sdir, &entry.id);
        let len = match fs::metadata(&source) { Ok(meta) if meta.is_file() => meta.len(), _ => { tally.pending += 1; continue; } };
        if len < entry.size { tally.pending += 1; continue; }
        if len > entry.size { tally.errors.push(format!("A saved copy from {} is damaged and was skipped ({}).", entry.device, entry.id)); continue; }
        fs::create_dir_all(&dir).map_err(|e| format!("Unable to create the backup folder: {e}"))?;
        // No stepping loop: on a clash take the slot after the newest backup.
        let mut stamp = entry.created_at;
        if index.backups.iter().any(|backup| backup.created_at == stamp) || dir.join(format!("{stamp}.zip")).exists() {
            stamp = index.backups.last().map_or(0, |last| last.created_at).max(stamp).saturating_add(1);
            if dir.join(format!("{stamp}.zip")).exists() { tally.pending += 1; continue; }
        }
        match copy_atomic(&source, &dir.join(format!("{stamp}.zip")), Some(&entry.sha256)) {
            Ok((_, size)) => {
                index.backups.push(BackupInfo {
                    id: format!("{key}~{stamp}"), location_key: key.to_string(), created_at: stamp, size, entries: entry.entries, files: entry.files, kind: entry.kind.clone(),
                    fingerprint: entry.fingerprint.clone(), sync_id: entry.id.clone(), origin: entry.device_id.clone(), device: entry.device.clone(),
                });
                index.known.push(entry.id.clone());
                index.backups.sort_by_key(|backup| backup.created_at);
                if let Err(error) = save_index(&dir, &index) { let _ = fs::remove_file(dir.join(format!("{stamp}.zip"))); return Err(error); }
                imported += 1;
            }
            Err(error) if error.kind() == std::io::ErrorKind::InvalidData => tally.errors.push(format!("A saved copy from {} is damaged and was skipped ({}).", entry.device, entry.id)),
            Err(_) => tally.pending += 1,
        }
    }
    if imported > 0 { tally.imported += imported; prune(ctx, key, None); }
    Ok(())
}

// ---------------------------------------------------------------------------
// Passes
// ---------------------------------------------------------------------------

/// Makes sure every save folder of the given games has a local entry carrying its sync key, so snapshots from other devices
/// have somewhere to land even before this device took its first backup.
fn ensure_indexes(ctx: &Ctx, games: &[SyncGame]) {
    for game in games {
        for location in list_locations(ctx, &game.piko_id, &game.hints).into_iter().filter(|location| location.problem.is_none()) {
            let Ok(dir) = location_dir(&ctx.root, &location.key) else { continue };
            let mut index = load_index(&dir);
            if index.sync_key == location.sync_key || !(index.path.is_empty() || index.path == location.path) { continue; }
            index.sync_key = location.sync_key;
            index.path = location.path;
            if index.label.is_empty() { index.label = location.label; }
            let _ = save_index(&dir, &index);
        }
    }
}

fn local_keys(ctx: &Ctx) -> Vec<String> {
    let mut keys: Vec<String> = fs::read_dir(&ctx.root).into_iter().flatten().flatten().filter(|entry| entry.path().is_dir()).filter_map(|entry| entry.file_name().to_str().map(str::to_string)).filter(|key| valid_id(key, 120)).collect();
    keys.sort();
    keys
}

fn run_pass(ctx: &Ctx, config: &SyncConfig, base: &Path, games: &[SyncGame]) -> Tally {
    let mut tally = Tally::default();
    ensure_indexes(ctx, games);
    for key in local_keys(ctx) {
        match export_key(ctx, config, base, &key) { Ok(count) => tally.exported += count, Err(error) => tally.errors.push(error) }
        if let Err(error) = import_key(ctx, config, base, &key, &mut tally) { tally.errors.push(error); }
    }
    tally.errors.dedup();
    tally.errors.truncate(MAX_ERRORS);
    tally
}

/// Called after every backup. Best effort: the result lands in the status line, the backup itself is never failed.
pub(crate) fn after_snapshot(ctx: &Ctx, key: &str) {
    let mut config = load_config(ctx);
    if !config.enabled { return; }
    ensure_device_id(&mut config);
    match usable_folder(&config).and_then(|base| export_key(ctx, &config, &base, key)) {
        Ok(count) => { config.exported = count; config.pending = 0; config.errors.clear(); }
        Err(error) => config.errors = vec![error],
    }
    config.last_sync_at = now_ms();
    let _ = save_config(ctx, &config);
}

fn sync_now(ctx: &Ctx, games: &[SyncGame], force: bool) -> Result<SyncStatus, String> {
    let mut config = load_config(ctx);
    if !config.enabled { return Ok(status_of(&config)); }
    if !force && config.last_sync_at > 0 && now_ms().saturating_sub(config.last_sync_at) < MIN_INTERVAL_MS { return Ok(status_of(&config)); }
    ensure_device_id(&mut config);
    match usable_folder(&config) {
        Ok(base) => {
            let tally = run_pass(ctx, &config, &base, games);
            config.imported = tally.imported;
            config.exported = tally.exported;
            config.pending = tally.pending;
            config.errors = tally.errors;
        }
        Err(error) => { config.imported = 0; config.exported = 0; config.pending = 0; config.errors = vec![error]; }
    }
    config.last_sync_at = now_ms();
    save_config(ctx, &config)?;
    Ok(status_of(&config))
}

fn set_folder(ctx: &Ctx, folder: &str, enabled: bool) -> Result<SyncStatus, String> {
    let mut config = load_config(ctx);
    ensure_device_id(&mut config);
    let folder = folder.trim();
    if folder.is_empty() {
        if enabled { return Err("Choose a sync folder first.".into()); }
        config.enabled = false;
        config.folder.clear();
    } else {
        let canon = crate::savebackup::check_location(Path::new(folder), ctx).map_err(|error| format!("That folder cannot be used for sync: {error}"))?;
        config.folder = canon.to_string_lossy().into_owned();
        config.enabled = enabled;
    }
    config.errors.clear();
    config.last_sync_at = 0;
    save_config(ctx, &config)?;
    Ok(status_of(&config))
}

/// The explicit "remove from sync folder" action: deletes the snapshots this device wrote (and their manifest entries) and
/// turns sync off. Other devices' files are never touched. Returns how many snapshot files were removed.
fn remove_own(ctx: &Ctx) -> Result<usize, String> {
    let mut config = load_config(ctx);
    ensure_device_id(&mut config);
    let base = PathBuf::from(&config.folder).join(FOLDER);
    let mut removed = 0;
    if !config.folder.is_empty() && base.is_dir() {
        for entry in fs::read_dir(&base).map_err(|e| format!("Unable to read the sync folder: {e}"))?.flatten() {
            let sdir = entry.path();
            if !sdir.is_dir() || !sdir.join(MANIFEST).is_file() { continue; }
            let mut manifest = read_manifest(&sdir);
            let before = manifest.snapshots.len();
            let (own, rest): (Vec<Entry>, Vec<Entry>) = manifest.snapshots.into_iter().partition(|entry| entry.device_id == config.device_id && valid_id(&entry.id, 90));
            for entry in &own { if fs::remove_file(snapshot_file(&sdir, &entry.id)).is_ok() { removed += 1; } }
            manifest.snapshots = rest;
            if manifest.snapshots.len() != before { write_manifest(&sdir, &manifest)?; }
        }
    }
    config.enabled = false;
    config.errors.clear();
    save_config(ctx, &config)?;
    Ok(removed)
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn get_save_sync_status() -> Result<SyncStatus, String> { Ok(status_of(&load_config(&Ctx::current()?))) }

#[tauri::command]
pub async fn set_save_sync_folder(folder: String, enabled: bool) -> Result<SyncStatus, String> {
    let ctx = Ctx::current()?;
    blocking(move || { let _guard = WORK.lock_recover(); set_folder(&ctx, &folder, enabled) }).await?
}

/// Exports what is missing from the sync folder and imports what is new there. `force` skips the one-minute debounce.
#[tauri::command]
pub async fn sync_saves_now(games: Vec<SyncGame>, force: bool) -> Result<SyncStatus, String> {
    let ctx = Ctx::current()?;
    blocking(move || { let _guard = WORK.lock_recover(); sync_now(&ctx, &games, force) }).await?
}

#[tauri::command]
pub async fn remove_save_sync_data() -> Result<usize, String> {
    let ctx = Ctx::current()?;
    blocking(move || { let _guard = WORK.lock_recover(); remove_own(&ctx) }).await?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::savebackup::{create_backup, remote_newer, Created, LocationInput, Settings};
    use crate::sources::testutil::temp_dir;

    struct Device { ctx: Ctx, config: SyncConfig, world: PathBuf }

    fn write(path: &Path, text: &str) { fs::create_dir_all(path.parent().unwrap()).unwrap(); fs::write(path, text).unwrap(); }

    fn device(base: &Path, name: &str, folder: &Path) -> Device {
        let home = base.join(name).join("home");
        fs::create_dir_all(&home).unwrap();
        let ctx = Ctx { root: base.join(name).join("data").join("save-backups"), home: Some(home.clone()), steam_roots: Vec::new(), settings: Settings::default() };
        let world = home.join("saves").join("World");
        write(&world.join("level.dat"), name);
        let mut config = SyncConfig { enabled: true, folder: folder.to_string_lossy().into_owned(), device_id: name.to_string(), ..Default::default() };
        ensure_device_id(&mut config);
        save_config(&ctx, &config).unwrap();
        Device { ctx, config, world }
    }
    fn snapshot(device: &Device, content: &str) -> BackupInfo {
        write(&device.world.join("level.dat"), content);
        let input = LocationInput { piko_id: "minecraft".into(), path: device.world.to_string_lossy().into_owned(), label: "World".into(), sync_key: crate::savebackup::sync_key("minecraft", "minecraft", Some("Inst"), "World") };
        match create_backup(&device.ctx, &input, "manual", true, None).unwrap() { Created::Backup(info) => info, _ => panic!("expected a backup") }
    }
    fn setup(tag: &str) -> (PathBuf, PathBuf) {
        let base = fs::canonicalize(temp_dir(tag)).unwrap();
        let folder = base.join("shared");
        fs::create_dir_all(&folder).unwrap();
        (base, folder)
    }
    fn sync(device: &Device) -> Tally { run_pass(&device.ctx, &device.config, &usable_folder(&device.config).unwrap(), &[]) }
    fn sync_dir(folder: &Path, backup: &BackupInfo, device: &Device) -> PathBuf { folder.join(FOLDER).join(load_index(&location_dir(&device.ctx.root, &backup.location_key).unwrap()).sync_key) }
    fn names(dir: &Path) -> Vec<String> { let mut out: Vec<String> = fs::read_dir(dir).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect(); out.sort(); out }

    #[test]
    fn key_ignores_local_paths() {
        let a = crate::savebackup::sync_key("minecraft", "minecraft", Some("Inst"), "World");
        assert_eq!(a, crate::savebackup::sync_key("minecraft", "minecraft", Some("Inst"), "World"));
        assert_ne!(a, crate::savebackup::sync_key("minecraft", "minecraft", Some("Other"), "World"));
        assert!(valid_id(&a, 120));
    }

    #[test]
    fn snapshots_are_exported_with_a_manifest_and_no_temp_files() {
        let (base, folder) = setup("ss-export");
        let a = device(&base, "alpha", &folder);
        let first = snapshot(&a, "one");
        let sdir = sync_dir(&folder, &first, &a);
        let manifest = read_manifest(&sdir);
        assert_eq!(manifest.snapshots.len(), 1);
        let entry = &manifest.snapshots[0];
        assert_eq!((entry.device_id.as_str(), entry.size), ("alpha", first.size));
        assert_eq!(entry.sha256, hash_file(&snapshot_file(&sdir, &entry.id)).unwrap());
        assert_eq!(names(&sdir), vec![format!("{}.zip", entry.id), MANIFEST.to_string()]);
        // A second pass changes nothing.
        assert_eq!(sync(&a).exported, 0);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn two_devices_merge_manifests_and_import_each_other() {
        let (base, folder) = setup("ss-two");
        let a = device(&base, "alpha", &folder);
        let b = device(&base, "bravo", &folder);
        let from_a = snapshot(&a, "from alpha");
        std::thread::sleep(std::time::Duration::from_millis(5));
        let from_b = snapshot(&b, "from bravo, longer");
        let sdir = sync_dir(&folder, &from_a, &a);
        assert_eq!(read_manifest(&sdir).snapshots.len(), 2);
        let tally = sync(&b);
        assert_eq!((tally.imported, tally.pending, tally.errors.len()), (1, 0, 0));
        let tally = sync(&a);
        assert_eq!(tally.imported, 1);
        let a_backups = load_index(&location_dir(&a.ctx.root, &from_a.location_key).unwrap()).backups;
        assert_eq!(a_backups.len(), 2);
        let imported = a_backups.iter().find(|backup| backup.origin == "bravo").expect("imported");
        assert_eq!((imported.size, imported.sync_id.as_str()), (from_b.size, format!("{}-bravo", from_b.created_at).as_str()));
        assert!(location_dir(&a.ctx.root, &imported.location_key).unwrap().join(format!("{}.zip", imported.created_at)).is_file());
        // Syncing again imports nothing, and a deleted import does not come back.
        assert_eq!(sync(&a).imported, 0);
        let dir = location_dir(&a.ctx.root, &imported.location_key).unwrap();
        let mut index = load_index(&dir);
        index.backups.retain(|backup| backup.origin.is_empty());
        save_index(&dir, &index).unwrap();
        assert_eq!(sync(&a).imported, 0);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn remote_newer_only_when_the_other_device_is_ahead() {
        let (base, folder) = setup("ss-newer");
        let a = device(&base, "alpha", &folder);
        let b = device(&base, "bravo", &folder);
        snapshot(&a, "old");
        std::thread::sleep(std::time::Duration::from_millis(5));
        let newest = snapshot(&b, "newest on bravo");
        let key = load_index(&location_dir(&b.ctx.root, &newest.location_key).unwrap()).sync_key;
        sync(&a);
        // Alpha has only its own older snapshot plus bravo's: the newest is bravo's.
        let backups = load_index(&location_dir(&a.ctx.root, &local_keys(&a.ctx)[0]).unwrap()).backups;
        assert_eq!(backups.len(), 2);
        assert!(!key.is_empty());
        let newer = remote_newer(&backups).expect("notice");
        assert_eq!(newer.origin, "bravo");
        let mut with_local = backups.clone();
        with_local.push(BackupInfo { created_at: newer.created_at + 1, ..Default::default() });
        assert!(remote_newer(&with_local).is_none());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn partial_files_are_pending_and_damaged_ones_are_reported_once_per_sync() {
        let (base, folder) = setup("ss-sha");
        let a = device(&base, "alpha", &folder);
        let b = device(&base, "bravo", &folder);
        let made = snapshot(&a, "alpha data");
        // Bravo needs a local entry to receive into.
        snapshot(&b, "bravo data");
        let sdir = sync_dir(&folder, &made, &a);
        let id = read_manifest(&sdir).snapshots.into_iter().find(|e| e.device_id == "alpha").unwrap().id;
        let file = snapshot_file(&sdir, &id);
        let good = fs::read(&file).unwrap();
        // Truncated: still arriving.
        fs::write(&file, &good[..good.len() / 2]).unwrap();
        let tally = sync(&b);
        assert_eq!((tally.imported, tally.pending, tally.errors.len()), (0, 1, 0));
        // Full size, wrong content: damaged.
        let mut bad = good.clone();
        bad[10] ^= 0xff;
        fs::write(&file, &bad).unwrap();
        let tally = sync(&b);
        assert_eq!((tally.imported, tally.pending, tally.errors.len()), (0, 0, 1));
        assert!(names(&sdir).iter().all(|name| !name.contains("mochi-part")));
        // Fully arrived.
        fs::write(&file, &good).unwrap();
        assert_eq!(sync(&b).imported, 1);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn conflict_files_are_ignored() {
        let (base, folder) = setup("ss-conflict");
        let a = device(&base, "alpha", &folder);
        let b = device(&base, "bravo", &folder);
        let made = snapshot(&a, "alpha data");
        snapshot(&b, "bravo data");
        let sdir = sync_dir(&folder, &made, &a);
        let manifest = read_manifest(&sdir);
        let entry = manifest.snapshots.iter().find(|e| e.device_id == "alpha").unwrap().clone();
        // Syncthing conflict copy of the manifest naming an extra snapshot, and a conflict copy of the zip.
        let ghost = Entry { id: "5-ghost.sync-conflict-20260101-ABC".into(), device_id: "ghost".into(), ..entry.clone() };
        let conflict = Manifest { snapshots: vec![ghost], ..manifest.clone() };
        fs::write(sdir.join("manifest.sync-conflict-20260101-ABC.json"), serde_json::to_vec(&conflict).unwrap()).unwrap();
        fs::copy(snapshot_file(&sdir, &entry.id), sdir.join(format!("{}.sync-conflict-20260101-ABC.zip", entry.id))).unwrap();
        let before = names(&sdir);
        let tally = sync(&b);
        assert_eq!((tally.imported, tally.errors.len()), (1, 0));
        let backups = load_index(&location_dir(&b.ctx.root, &local_keys(&b.ctx)[0]).unwrap()).backups;
        assert_eq!(backups.len(), 2);
        assert!(backups.iter().all(|backup| !backup.sync_id.contains("conflict") && backup.origin != "ghost"));
        assert_eq!(names(&sdir), before);
        // A manifest entry that itself names a conflict file is skipped too.
        let mut tampered = read_manifest(&sdir);
        tampered.snapshots.push(Entry { id: "7-ghost.sync-conflict-x".into(), ..entry });
        write_manifest(&sdir, &tampered).unwrap();
        assert_eq!(sync(&b).imported, 0);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn retention_and_removal_only_touch_this_devices_files() {
        let (base, folder) = setup("ss-retention");
        let mut a = device(&base, "alpha", &folder);
        a.ctx.settings.keep = 1;
        let first = snapshot(&a, "one");
        let sdir = sync_dir(&folder, &first, &a);
        // A file from another device (listed in the manifest) and a stray file nobody told us about.
        let foreign = Entry { id: "1-bravo".into(), created_at: 1, device_id: "bravo".into(), device: "Bravo".into(), size: 3, sha256: "x".into(), ..Default::default() };
        fs::write(snapshot_file(&sdir, "1-bravo"), "abc").unwrap();
        fs::write(sdir.join("notes.txt"), "mine").unwrap();
        let mut manifest = read_manifest(&sdir);
        manifest.snapshots.push(foreign);
        write_manifest(&sdir, &manifest).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(5));
        let second = snapshot(&a, "two two");
        let own: Vec<String> = read_manifest(&sdir).snapshots.iter().filter(|e| e.device_id == "alpha").map(|e| e.id.clone()).collect();
        assert_eq!(own, vec![format!("{}-alpha", second.created_at)]);
        assert!(!snapshot_file(&sdir, &format!("{}-alpha", first.created_at)).exists());
        assert!(snapshot_file(&sdir, "1-bravo").is_file() && sdir.join("notes.txt").is_file());
        // Explicit removal.
        assert_eq!(remove_own(&a.ctx).unwrap(), 1);
        assert!(!load_config(&a.ctx).enabled);
        assert_eq!(fs::read(snapshot_file(&sdir, "1-bravo")).unwrap(), b"abc");
        assert_eq!(fs::read_to_string(sdir.join("notes.txt")).unwrap(), "mine");
        assert_eq!(read_manifest(&sdir).snapshots.iter().map(|e| e.id.as_str()).collect::<Vec<_>>(), ["1-bravo"]);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn missing_sync_folder_is_an_error_not_a_new_folder() {
        let (base, folder) = setup("ss-missing");
        let a = device(&base, "alpha", &folder);
        fs::remove_dir_all(&folder).unwrap();
        let status = sync_now(&a.ctx, &[], true).unwrap();
        assert_eq!(status.errors.len(), 1);
        assert!(!status.available && !folder.exists());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn folder_setting_rejects_system_folders() {
        let (base, folder) = setup("ss-setfolder");
        let a = device(&base, "alpha", &folder);
        assert!(set_folder(&a.ctx, "/etc", true).is_err());
        assert!(set_folder(&a.ctx, "", true).is_err());
        let status = set_folder(&a.ctx, folder.to_str().unwrap(), true).unwrap();
        assert!(status.enabled && status.available);
        assert!(!set_folder(&a.ctx, "", false).unwrap().enabled);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn same_named_worlds_in_two_instances_keep_distinct_stable_keys() {
        use crate::savebackup::{locate, Hints, InstanceHint};
        let (base, folder) = setup("ss-keys");
        let a = device(&base, "alpha", &folder);
        let home = a.ctx.home.clone().unwrap();
        let mut hints = Hints::default();
        let mut worlds = Vec::new();
        for name in ["X", "Y"] {
            let root = home.join("inst").join(name);
            write(&root.join("saves").join("New World").join("level.dat"), name);
            hints.instances.push(InstanceHint { id: name.into(), name: name.into(), content_root: root.to_string_lossy().into_owned() });
            worlds.push(root.join("saves").join("New World"));
        }
        let mut keys = Vec::new();
        for world in &worlds {
            // The caller names only a path (and may lie about the label); kind and group come from the game's own locations.
            let input = locate(&a.ctx, LocationInput { piko_id: "minecraft".into(), path: world.to_string_lossy().into_owned(), label: "whatever".into(), sync_key: "forged".into() }, &hints);
            assert_eq!(input.label, "New World");
            let Created::Backup(info) = create_backup(&a.ctx, &input, "manual", true, None).unwrap() else { panic!("backup") };
            keys.push(load_index(&location_dir(&a.ctx.root, &info.location_key).unwrap()).sync_key);
        }
        assert!(!keys[0].is_empty() && keys[0] != keys[1]);
        let games = [SyncGame { piko_id: "minecraft".into(), hints: hints.clone() }];
        ensure_indexes(&a.ctx, &games);
        let again: Vec<String> = local_keys(&a.ctx).iter().map(|key| load_index(&location_dir(&a.ctx.root, key).unwrap()).sync_key).collect();
        assert!(keys.iter().all(|key| again.contains(key)) && again.len() == 2);
        // A later backup that does not know the instances never replaces a key.
        let bare = locate(&a.ctx, LocationInput { piko_id: "minecraft".into(), path: worlds[0].to_string_lossy().into_owned(), label: "x".into(), sync_key: String::new() }, &Hints::default());
        assert!(bare.sync_key.is_empty());
        write(&worlds[0].join("level.dat"), "changed again");
        let Created::Backup(info) = create_backup(&a.ctx, &bare, "manual", false, None).unwrap() else { panic!("backup") };
        assert_eq!(load_index(&location_dir(&a.ctx.root, &info.location_key).unwrap()).sync_key, keys[0]);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn future_dated_manifest_entries_are_reported_and_never_stall_ids() {
        let (base, folder) = setup("ss-future");
        let a = device(&base, "alpha", &folder);
        let b = device(&base, "bravo", &folder);
        let made = snapshot(&a, "alpha data");
        snapshot(&b, "bravo data");
        let sdir = sync_dir(&folder, &made, &a);
        for stamp in [now_ms() + 86_400_000, u64::MAX, 0] {
            let mut manifest = read_manifest(&sdir);
            for entry in manifest.snapshots.iter_mut().filter(|e| e.device_id == "alpha") { entry.created_at = stamp; }
            write_manifest(&sdir, &manifest).unwrap();
            let tally = sync(&b);
            assert_eq!((tally.imported, tally.errors.len()), (0, 1), "{stamp}");
        }
        let backups = load_index(&location_dir(&b.ctx.root, &local_keys(&b.ctx)[0]).unwrap()).backups;
        assert!(remote_newer(&backups).is_none());
        // Local ids stay O(1) even after a backup dated slightly ahead.
        let mut index = load_index(&location_dir(&b.ctx.root, &local_keys(&b.ctx)[0]).unwrap());
        let ahead = index.backups.last().unwrap().created_at + 1_800_000;
        fs::copy(location_dir(&b.ctx.root, &local_keys(&b.ctx)[0]).unwrap().join(format!("{}.zip", index.backups[0].created_at)), location_dir(&b.ctx.root, &local_keys(&b.ctx)[0]).unwrap().join(format!("{ahead}.zip"))).unwrap();
        index.backups.push(BackupInfo { id: "x~1".into(), created_at: ahead, ..index.backups[0].clone() });
        save_index(&location_dir(&b.ctx.root, &local_keys(&b.ctx)[0]).unwrap(), &index).unwrap();
        let started = std::time::Instant::now();
        let next = snapshot(&b, "bravo data, newer and longer");
        assert!(next.created_at > ahead && started.elapsed().as_secs() < 5);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn imported_snapshots_never_push_out_this_devices_own_backups() {
        let (base, folder) = setup("ss-keep");
        let a = device(&base, "alpha", &folder);
        let mut b = device(&base, "bravo", &folder);
        b.ctx.settings.keep = 1;
        snapshot(&a, "alpha one");
        std::thread::sleep(std::time::Duration::from_millis(5));
        snapshot(&a, "alpha two two");
        let own = snapshot(&b, "bravo only");
        let tally = sync(&b);
        assert_eq!(tally.imported, 2);
        let dir = location_dir(&b.ctx.root, &own.location_key).unwrap();
        let backups = load_index(&dir).backups;
        assert_eq!(backups.iter().filter(|x| x.origin.is_empty()).count(), 1);
        assert_eq!(backups.iter().filter(|x| !x.origin.is_empty()).count(), 1);
        assert!(dir.join(format!("{}.zip", own.created_at)).is_file());
        // Pruned imports leave the sync folder untouched, and do not come back.
        let sdir = sync_dir(&folder, &own, &b);
        assert_eq!(read_manifest(&sdir).snapshots.iter().filter(|e| e.device_id == "alpha").count(), 2);
        assert_eq!(sync(&b).imported, 0);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn a_copied_device_id_is_replaced_on_another_machine() {
        let mut config = SyncConfig { device_id: "cloned".into(), ..Default::default() };
        ensure_device_id_for(&mut config, "machine-a");
        assert_eq!((config.device_id.as_str(), config.machine.as_str()), ("cloned", "machine-a"));
        ensure_device_id_for(&mut config, "machine-a");
        assert_eq!(config.device_id, "cloned");
        ensure_device_id_for(&mut config, "machine-b");
        assert_ne!(config.device_id, "cloned");
        assert!(valid_id(&config.device_id, 40) && config.machine == "machine-b");
        assert_eq!(machine_fingerprint(), machine_fingerprint());
    }
}
