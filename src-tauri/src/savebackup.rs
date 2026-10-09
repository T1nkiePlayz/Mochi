//! Save backups: zip snapshots of a game's save folders, kept under `<app data>/save-backups/<location key>/`.
//!
//! Layout: `<key>/<created ms>.zip` plus `<key>/index.json` (the folder path, label and one record per backup), and
//! `settings.json` (how many backups to keep per folder, total size cap). A backup is skipped when the folder's content
//! fingerprint (sorted relative paths, sizes, mtimes) equals the newest backup's. Restoring always snapshots the current
//! folder first ("safety" backup), extracts to a temporary sibling and swaps it in, rolling back when the swap fails.
//! Symlinks inside a folder are never followed (they are left out), and system folders or the home folder itself are refused.
use crate::util::{blocking, fsio, hex, now_ms, valid_id, MutexExt};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    io::{BufReader, BufWriter, Read, Write},
    os::unix::fs::PermissionsExt,
    path::{Component, Path, PathBuf},
    sync::Mutex,
    time::UNIX_EPOCH,
};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

const DEFAULT_KEEP: usize = 10;
const DEFAULT_CAP: u64 = 2 << 30;
const MAX_ENTRIES: usize = 200_000;
const MAX_SOURCE_BYTES: u64 = 8 << 30;
const MAX_WORLDS: usize = 500;
const BUF: usize = 64 * 1024;
/// Folders that are never a save location, compared lowercase (macOS file systems are case-insensitive).
const SYSTEM_DIRS: &[&str] = &[
    "/", "/bin", "/boot", "/dev", "/etc", "/home", "/lib", "/lib64", "/mnt", "/media", "/opt", "/proc", "/root", "/run", "/sbin", "/srv", "/sys", "/tmp",
    "/usr", "/var", "/users", "/applications", "/library", "/system", "/volumes", "/private", "/cores", "/network",
];

/// One backup, as listed and as stored in the index.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct BackupInfo {
    /// `<location key>~<created ms>`.
    pub id: String,
    pub location_key: String,
    pub created_at: u64,
    /// Size of the zip on disk.
    pub size: u64,
    /// Files and folders inside.
    pub entries: usize,
    pub files: usize,
    /// "manual", "auto" or "safety" (taken right before a restore).
    pub kind: String,
    pub fingerprint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct Index { path: String, label: String, backups: Vec<BackupInfo> }

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// Backups kept per folder.
    pub keep: usize,
    /// Total size of all backups, in bytes.
    pub max_total_bytes: u64,
}
impl Default for Settings { fn default() -> Self { Settings { keep: DEFAULT_KEEP, max_total_bytes: DEFAULT_CAP } } }
impl Settings { fn clamped(self) -> Settings { Settings { keep: self.keep.clamp(1, 100), max_total_bytes: self.max_total_bytes.clamp(100 << 20, 200 << 30) } } }

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct InstanceHint { pub id: String, pub name: String, pub content_root: String }

/// What the UI knows about a game that helps find its saves.
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Hints {
    pub steam_app_id: Option<u64>,
    /// Folders the user added by hand.
    pub folders: Vec<String>,
    /// Minecraft instances (Tofus) with their game folder.
    pub instances: Vec<InstanceHint>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SaveLocation {
    pub key: String,
    /// "minecraft", "steam" or "custom".
    pub kind: String,
    pub label: String,
    /// The instance a Minecraft world belongs to.
    pub group: Option<String>,
    pub path: String,
    /// The folder exactly as the user added it (custom folders only), to remove it from the list again.
    pub source: Option<String>,
    /// Why the folder cannot be backed up (missing, a system folder, ...).
    pub problem: Option<String>,
    pub backups: usize,
    pub last_backup: Option<u64>,
    pub backup_bytes: u64,
}

/// What `create_save_backup` is asked to back up (a location returned by `list_save_locations`).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocationInput { pub piko_id: String, pub path: String, #[serde(default)] pub label: String }

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BackupResult {
    pub backup: Option<BackupInfo>,
    /// "unchanged" (same content as the newest backup) or "empty" when nothing was created.
    pub skipped: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreResult { pub safety: Option<BackupInfo>, pub files: usize }

#[derive(Debug, Clone, Serialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AutoSummary { pub created: usize, pub unchanged: usize, pub failed: usize, pub first_error: Option<String> }

/// Everything the logic needs from the outside world, injectable for tests.
#[derive(Debug, Clone)]
pub struct Ctx { pub root: PathBuf, pub home: Option<PathBuf>, pub steam_roots: Vec<PathBuf>, pub settings: Settings }

impl Ctx {
    fn current() -> Result<Ctx, String> {
        let root = crate::modinstance::data_dir().ok_or("Mochi is still starting.")?.join("save-backups");
        let home = crate::platform::home_dir();
        let steam_roots = home.as_deref().map(crate::sources::steam_install_roots).unwrap_or_default();
        let settings = load_settings(&root);
        Ok(Ctx { root, home, steam_roots, settings })
    }
}

/// Backups, restores and deletes run one at a time so two never fight over an index or a folder.
static WORK: Mutex<()> = Mutex::new(());

// ---------------------------------------------------------------------------
// Settings, index
// ---------------------------------------------------------------------------

fn load_settings(root: &Path) -> Settings {
    fs::read(root.join("settings.json")).ok().and_then(|bytes| serde_json::from_slice::<Settings>(&bytes).ok()).unwrap_or_default().clamped()
}

fn location_dir(root: &Path, key: &str) -> Result<PathBuf, String> {
    if !valid_id(key, 120) { return Err("Invalid save location.".into()); }
    Ok(root.join(key))
}

fn load_index(dir: &Path) -> Index {
    let mut index: Index = fs::read(dir.join("index.json")).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok()).unwrap_or_default();
    index.backups.retain(|backup| dir.join(format!("{}.zip", backup.created_at)).is_file());
    index.backups.sort_by_key(|backup| backup.created_at);
    index
}

fn save_index(dir: &Path, index: &Index) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| format!("Unable to create the backup folder: {e}"))?;
    let bytes = serde_json::to_vec(index).map_err(|e| e.to_string())?;
    fsio::write_atomic_durable(&dir.join("index.json"), &bytes).map_err(|e| format!("Unable to save the backup list: {e}"))
}

fn parse_id(id: &str) -> Result<(String, u64), String> {
    let (key, stamp) = id.rsplit_once('~').ok_or("Invalid backup id.")?;
    let stamp: u64 = stamp.parse().map_err(|_| "Invalid backup id.")?;
    if !valid_id(key, 120) { return Err("Invalid backup id.".into()); }
    Ok((key.to_string(), stamp))
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

fn norm(path: &Path) -> String { path.to_string_lossy().to_lowercase().trim_end_matches('/').to_string() }
fn within(parent: &str, child: &str) -> bool { child == parent || child.starts_with(&format!("{parent}/")) }

/// A folder that may be backed up or restored into: an existing directory (links resolved once, here) that is not a
/// system folder, the home folder or one of its parents, nor part of Mochi's own backup store.
pub fn check_location(path: &Path, ctx: &Ctx) -> Result<PathBuf, String> {
    let meta = fs::metadata(path).map_err(|_| "That folder does not exist.".to_string())?;
    if !meta.is_dir() { return Err("That is not a folder.".into()); }
    let canon = fs::canonicalize(path).map_err(|e| format!("Unable to read that folder: {e}"))?;
    check_target(&canon, ctx)?;
    Ok(canon)
}

/// The path rules without the "exists" check (a restore may recreate a folder that was deleted).
fn check_target(canon: &Path, ctx: &Ctx) -> Result<(), String> {
    let text = norm(canon);
    let depth = canon.components().filter(|part| matches!(part, Component::Normal(_))).count();
    if depth < 2 || SYSTEM_DIRS.contains(&text.as_str()) { return Err("That is a system folder. Choose the game's own save folder.".into()); }
    if let Some(home) = &ctx.home {
        let home = norm(&fs::canonicalize(home).unwrap_or_else(|_| home.clone()));
        if within(&text, &home) { return Err("That is your home folder (or contains it). Choose a folder inside it.".into()); }
    }
    let root = norm(&fs::canonicalize(&ctx.root).unwrap_or_else(|_| ctx.root.clone()));
    if within(&text, &root) || within(&root, &text) { return Err("That folder is part of Mochi's own backup storage.".into()); }
    Ok(())
}

fn safe_part(text: &str, max: usize) -> String {
    text.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '-' }).take(max).collect()
}

/// Stable key of a (game, folder) pair: letters of the game id plus a hash of the resolved folder.
pub fn location_key(piko_id: &str, canonical: &Path) -> String {
    let digest = Sha256::digest(canonical.to_string_lossy().as_bytes());
    let prefix = safe_part(piko_id, 40);
    format!("{}-{}", if prefix.is_empty() { "game".to_string() } else { prefix }, &hex(&digest)[..16])
}

// ---------------------------------------------------------------------------
// Walking and fingerprint
// ---------------------------------------------------------------------------

struct Item { rel: String, abs: PathBuf, dir: bool, size: u64, mtime: u128, mode: u32 }

/// Everything below `root` that is a plain file or folder, sorted by relative path. Symlinks and special files are left out.
fn scan(root: &Path) -> Result<Vec<Item>, String> {
    let mut out = Vec::new();
    let mut total = 0u64;
    let mut stack = vec![(root.to_path_buf(), String::new())];
    while let Some((dir, prefix)) = stack.pop() {
        let entries = fs::read_dir(&dir).map_err(|e| format!("Unable to read {}: {e}", dir.display()))?;
        for entry in entries {
            let entry = entry.map_err(|e| format!("Unable to read {}: {e}", dir.display()))?;
            let Some(name) = entry.file_name().to_str().map(str::to_owned) else { continue };
            let Ok(meta) = entry.metadata() else { continue };
            let kind = meta.file_type();
            if kind.is_symlink() || !(kind.is_dir() || kind.is_file()) { continue; }
            let rel = if prefix.is_empty() { name } else { format!("{prefix}/{name}") };
            let mtime = meta.modified().ok().and_then(|time| time.duration_since(UNIX_EPOCH).ok()).map_or(0, |d| d.as_nanos());
            if kind.is_dir() { stack.push((entry.path(), rel.clone())); } else { total += meta.len(); }
            out.push(Item { rel, abs: entry.path(), dir: kind.is_dir(), size: if kind.is_dir() { 0 } else { meta.len() }, mtime, mode: meta.permissions().mode() });
            if out.len() > MAX_ENTRIES { return Err("That folder has too many files to back up.".into()); }
            if total > MAX_SOURCE_BYTES { return Err("That folder is too large to back up (over 8 GB).".into()); }
        }
    }
    out.sort_by(|a, b| a.rel.cmp(&b.rel));
    Ok(out)
}

fn fingerprint(items: &[Item]) -> String {
    let mut hasher = Sha256::new();
    for item in items {
        hasher.update(format!("{}\0{}\0{}\0{}\n", item.rel, u8::from(item.dir), item.size, item.mtime).as_bytes());
    }
    hex(&hasher.finalize())
}

// ---------------------------------------------------------------------------
// Zip
// ---------------------------------------------------------------------------

fn copy_stream(reader: &mut impl Read, writer: &mut impl Write) -> std::io::Result<()> {
    let mut buffer = vec![0u8; BUF];
    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 { return Ok(()); }
        writer.write_all(&buffer[..read])?;
    }
}

fn write_zip(items: &[Item], dest: &Path) -> Result<(), String> {
    let part = dest.with_extension("zip.part");
    let result = (|| -> Result<(), String> {
        let file = fs::File::create(&part).map_err(|e| format!("Unable to create the backup: {e}"))?;
        let mut zip = ZipWriter::new(BufWriter::new(file));
        for item in items {
            let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated).unix_permissions(item.mode & 0o777).large_file(item.size >= u64::from(u32::MAX));
            if item.dir {
                zip.add_directory(format!("{}/", item.rel), options).map_err(|e| e.to_string())?;
            } else {
                zip.start_file(item.rel.as_str(), options).map_err(|e| e.to_string())?;
                let mut source = fs::File::open(&item.abs).map_err(|e| format!("Unable to read {}: {e}", item.rel))?;
                copy_stream(&mut source, &mut zip).map_err(|e| format!("Unable to back up {}: {e}", item.rel))?;
            }
        }
        let mut writer = zip.finish().map_err(|e| e.to_string())?;
        writer.flush().map_err(|e| e.to_string())?;
        writer.into_inner().map_err(|e| e.to_string())?.sync_all().map_err(|e| e.to_string())?;
        fs::rename(&part, dest).map_err(|e| e.to_string())
    })();
    if result.is_err() { let _ = fs::remove_file(&part); }
    result
}

/// Extracts a backup into the new folder `dest`, reading every entry to its end so the stored CRCs are verified,
/// and checks the entry count against what the index says was written.
fn extract_zip(zip_path: &Path, dest: &Path, expected_entries: usize) -> Result<usize, String> {
    let file = fs::File::open(zip_path).map_err(|e| format!("Unable to open the backup: {e}"))?;
    let mut archive = ZipArchive::new(BufReader::new(file)).map_err(|e| format!("The backup is damaged: {e}"))?;
    if archive.len() != expected_entries { return Err("The backup is incomplete (entry count differs).".into()); }
    fs::create_dir_all(dest).map_err(|e| format!("Unable to create a folder: {e}"))?;
    let mut files = 0;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|e| format!("The backup is damaged: {e}"))?;
        let rel = entry.enclosed_name().filter(|rel| rel.components().all(|part| matches!(part, Component::Normal(_)))).ok_or("The backup contains an unsafe path.")?;
        let out = dest.join(&rel);
        let mode = entry.unix_mode().unwrap_or(0o644) & 0o777;
        if entry.is_dir() {
            fs::create_dir_all(&out).map_err(|e| format!("Unable to create a folder: {e}"))?;
            let _ = fs::set_permissions(&out, fs::Permissions::from_mode(mode | 0o700));
        } else {
            if let Some(parent) = out.parent() { fs::create_dir_all(parent).map_err(|e| format!("Unable to create a folder: {e}"))?; }
            let mut target = BufWriter::new(fs::File::create(&out).map_err(|e| format!("Unable to write {}: {e}", rel.display()))?);
            copy_stream(&mut entry, &mut target).map_err(|e| format!("The backup is damaged ({}): {e}", rel.display()))?;
            target.flush().map_err(|e| e.to_string())?;
            drop(target);
            let _ = fs::set_permissions(&out, fs::Permissions::from_mode(mode | 0o600));
            files += 1;
        }
    }
    Ok(files)
}

// ---------------------------------------------------------------------------
// Backups
// ---------------------------------------------------------------------------

enum Created { Backup(BackupInfo), Unchanged, Empty }

fn create_backup(ctx: &Ctx, input: &LocationInput, kind: &str, dedupe: bool, protect: Option<&str>) -> Result<Created, String> {
    let canon = check_location(Path::new(&input.path), ctx)?;
    let key = location_key(&input.piko_id, &canon);
    create_at(ctx, &key, &canon, &input.label, kind, dedupe, protect)
}

fn create_at(ctx: &Ctx, key: &str, canon: &Path, label: &str, kind: &str, dedupe: bool, protect: Option<&str>) -> Result<Created, String> {
    let dir = location_dir(&ctx.root, key)?;
    let items = scan(canon)?;
    if items.is_empty() { return Ok(Created::Empty); }
    let print = fingerprint(&items);
    let mut index = load_index(&dir);
    if dedupe && index.backups.last().is_some_and(|last| last.fingerprint == print) { return Ok(Created::Unchanged); }
    fs::create_dir_all(&dir).map_err(|e| format!("Unable to create the backup folder: {e}"))?;
    let mut stamp = now_ms();
    while dir.join(format!("{stamp}.zip")).exists() || index.backups.last().is_some_and(|last| last.created_at >= stamp) { stamp += 1; }
    let dest = dir.join(format!("{stamp}.zip"));
    write_zip(&items, &dest)?;
    let info = BackupInfo {
        id: format!("{key}~{stamp}"), location_key: key.to_string(), created_at: stamp, size: fs::metadata(&dest).map_or(0, |m| m.len()),
        entries: items.len(), files: items.iter().filter(|item| !item.dir).count(), kind: kind.to_string(), fingerprint: print,
    };
    index.path = canon.to_string_lossy().into_owned();
    index.label = label.to_string();
    index.backups.push(info.clone());
    if let Err(error) = save_index(&dir, &index) { let _ = fs::remove_file(&dest); return Err(error); }
    prune(ctx, key, protect);
    Ok(Created::Backup(info))
}

fn remove_backup(dir: &Path, index: &mut Index, id: &str) {
    if let Some(at) = index.backups.iter().position(|backup| backup.id == id) {
        let backup = index.backups.remove(at);
        let _ = fs::remove_file(dir.join(format!("{}.zip", backup.created_at)));
    }
}

/// Keeps the newest `keep` backups of a folder, then brings all backups under the size cap by dropping the oldest ones
/// (the newest backup of each folder and `protect` always stay). Best effort: failures leave extra backups, never fewer.
fn prune(ctx: &Ctx, key: &str, protect: Option<&str>) {
    if let Ok(dir) = location_dir(&ctx.root, key) {
        let mut index = load_index(&dir);
        while index.backups.len() > ctx.settings.keep {
            let Some(id) = index.backups.iter().find(|backup| Some(backup.id.as_str()) != protect).map(|backup| backup.id.clone()) else { break };
            remove_backup(&dir, &mut index, &id);
        }
        let _ = save_index(&dir, &index);
    }
    let Ok(entries) = fs::read_dir(&ctx.root) else { return };
    let mut all: Vec<(PathBuf, BackupInfo)> = Vec::new();
    let mut newest: HashMap<String, u64> = HashMap::new();
    for entry in entries.flatten() {
        let dir = entry.path();
        if !dir.is_dir() { continue; }
        for backup in load_index(&dir).backups {
            let slot = newest.entry(backup.location_key.clone()).or_insert(0);
            *slot = (*slot).max(backup.created_at);
            all.push((dir.clone(), backup));
        }
    }
    let mut total: u64 = all.iter().map(|(_, backup)| backup.size).sum();
    all.sort_by_key(|(_, backup)| backup.created_at);
    for (dir, backup) in all {
        if total <= ctx.settings.max_total_bytes { break; }
        if newest.get(&backup.location_key) == Some(&backup.created_at) || Some(backup.id.as_str()) == protect { continue; }
        let mut index = load_index(&dir);
        remove_backup(&dir, &mut index, &backup.id);
        if save_index(&dir, &index).is_ok() { total = total.saturating_sub(backup.size); }
    }
}

fn list_backups(ctx: &Ctx, key: &str) -> Result<Vec<BackupInfo>, String> {
    let mut backups = load_index(&location_dir(&ctx.root, key)?).backups;
    backups.reverse();
    Ok(backups)
}

fn delete_backup(ctx: &Ctx, id: &str) -> Result<(), String> {
    let (key, _) = parse_id(id)?;
    let dir = location_dir(&ctx.root, &key)?;
    let mut index = load_index(&dir);
    if !index.backups.iter().any(|backup| backup.id == id) { return Err("That backup no longer exists.".into()); }
    remove_backup(&dir, &mut index, id);
    save_index(&dir, &index)
}

/// Puts a backup back in place. The current folder is snapshotted first (a failure here aborts), the backup is extracted
/// and verified beside the folder, and only then swapped in; if the swap fails the old folder is moved back.
fn restore_backup(ctx: &Ctx, id: &str) -> Result<RestoreResult, String> {
    let (key, stamp) = parse_id(id)?;
    let dir = location_dir(&ctx.root, &key)?;
    let index = load_index(&dir);
    let backup = index.backups.iter().find(|backup| backup.id == id).ok_or("That backup no longer exists.")?.clone();
    let target = PathBuf::from(&index.path);
    check_target(&target, ctx)?;
    let name = target.file_name().and_then(|name| name.to_str()).ok_or("Invalid save folder.")?.to_string();
    let parent = target.parent().ok_or("Invalid save folder.")?;
    if !parent.is_dir() { return Err("The folder that held these saves no longer exists.".into()); }
    let marker = now_ms();
    let staging = parent.join(format!("{name}.mochi-restore-{marker}"));
    let old = parent.join(format!("{name}.mochi-old-{marker}"));
    let files = match extract_zip(&dir.join(format!("{stamp}.zip")), &staging, backup.entries) {
        Ok(files) => files,
        Err(error) => { let _ = fs::remove_dir_all(&staging); return Err(error); }
    };
    let mut safety = None;
    if target.is_dir() {
        let canon = check_location(&target, ctx)?;
        match create_at(ctx, &key, &canon, &index.label, "safety", false, Some(id)) {
            Ok(Created::Backup(info)) => safety = Some(info),
            Ok(_) => {}
            Err(error) => { let _ = fs::remove_dir_all(&staging); return Err(format!("Could not back up the current saves first, so nothing was changed: {error}")); }
        }
    }
    let moved = target.exists();
    if moved {
        if let Err(error) = fs::rename(&target, &old) { let _ = fs::remove_dir_all(&staging); return Err(format!("Unable to replace the folder: {error}")); }
    }
    if let Err(error) = fs::rename(&staging, &target) {
        if moved { let _ = fs::rename(&old, &target); }
        let _ = fs::remove_dir_all(&staging);
        return Err(format!("Unable to put the backup in place (your saves were left as they were): {error}"));
    }
    if moved { let _ = fs::remove_dir_all(&old); }
    Ok(RestoreResult { safety, files })
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/// `<steam root>/userdata/<user>/<app id>/remote` folders that exist. Roots are the platform's Steam folders (Linux native
/// and Flatpak, macOS `~/Library/Application Support/Steam`); roots that resolve to the same place count once.
pub fn steam_remote_dirs(roots: &[PathBuf], app_id: u64) -> Vec<(String, PathBuf)> {
    let mut out: Vec<(String, PathBuf)> = Vec::new();
    for root in roots {
        let Ok(users) = fs::read_dir(root.join("userdata")) else { continue };
        let mut names: Vec<String> = users.flatten().filter_map(|user| user.file_name().to_str().map(str::to_owned)).collect();
        names.sort();
        for user in names {
            if user == "0" || user == "anonymous" { continue; }
            let remote = root.join("userdata").join(&user).join(app_id.to_string()).join("remote");
            let Ok(canon) = fs::canonicalize(&remote) else { continue };
            if canon.is_dir() && !out.iter().any(|(_, seen)| *seen == canon) { out.push((user.clone(), canon)); }
        }
    }
    out
}

/// Worlds (folders with a `level.dat`) under an instance's game folder.
fn minecraft_worlds(content_root: &Path) -> Vec<(String, PathBuf)> {
    let mut out = Vec::new();
    for saves in [content_root.join("saves"), content_root.join(".minecraft").join("saves"), content_root.join("minecraft").join("saves")] {
        let Ok(entries) = fs::read_dir(&saves) else { continue };
        for entry in entries.flatten().take(MAX_WORLDS) {
            let path = entry.path();
            if path.join("level.dat").is_file() {
                if let Some(name) = entry.file_name().to_str() { out.push((name.to_string(), path)); }
            }
        }
    }
    out.sort_by_key(|world| world.0.to_lowercase());
    out
}

fn list_locations(ctx: &Ctx, piko_id: &str, hints: &Hints) -> Vec<SaveLocation> {
    let mut out: Vec<SaveLocation> = Vec::new();
    let mut add = |kind: &str, label: String, group: Option<String>, path: &Path, detected: bool| {
        let (key, path_text, problem) = match check_location(path, ctx) {
            Ok(canon) => (location_key(piko_id, &canon), canon.to_string_lossy().into_owned(), None),
            Err(_) if detected => return,
            Err(error) => (location_key(piko_id, path), path.to_string_lossy().into_owned(), Some(error)),
        };
        if out.iter().any(|seen| seen.key == key) { return; }
        let backups = location_dir(&ctx.root, &key).map(|dir| load_index(&dir).backups).unwrap_or_default();
        out.push(SaveLocation {
            key, kind: kind.to_string(), label, group, path: path_text, source: (!detected).then(|| path.to_string_lossy().into_owned()), problem, backups: backups.len(),
            last_backup: backups.last().map(|backup| backup.created_at), backup_bytes: backups.iter().map(|backup| backup.size).sum(),
        });
    };
    for instance in hints.instances.iter().filter(|instance| !instance.content_root.trim().is_empty()) {
        for (name, path) in minecraft_worlds(Path::new(&instance.content_root)) { add("minecraft", name, Some(instance.name.clone()), &path, true); }
    }
    if let Some(app_id) = hints.steam_app_id.filter(|id| *id > 0) {
        for (user, path) in steam_remote_dirs(&ctx.steam_roots, app_id) { add("steam", format!("Steam Cloud saves (account {user})"), None, &path, true); }
    }
    for folder in hints.folders.iter().filter(|folder| !folder.trim().is_empty()) {
        let path = Path::new(folder.trim());
        let label = path.file_name().and_then(|name| name.to_str()).unwrap_or(folder).to_string();
        add("custom", label, None, path, false);
    }
    out
}

/// Backs up every location of a game, one after the other, skipping unchanged ones.
fn auto_backup(ctx: &Ctx, piko_id: &str, hints: &Hints) -> AutoSummary {
    let mut summary = AutoSummary::default();
    for location in list_locations(ctx, piko_id, hints).into_iter().filter(|location| location.problem.is_none()) {
        let input = LocationInput { piko_id: piko_id.to_string(), path: location.path, label: location.label };
        let result = { let _guard = WORK.lock_recover(); create_backup(ctx, &input, "auto", true, None) };
        match result {
            Ok(Created::Backup(_)) => summary.created += 1,
            Ok(_) => summary.unchanged += 1,
            Err(error) => { summary.failed += 1; summary.first_error.get_or_insert(error); }
        }
    }
    summary
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn list_save_locations(piko_id: String, hints: Hints) -> Result<Vec<SaveLocation>, String> {
    let ctx = Ctx::current()?;
    blocking(move || list_locations(&ctx, &piko_id, &hints)).await
}

#[tauri::command]
pub async fn create_save_backup(location: LocationInput) -> Result<BackupResult, String> {
    let ctx = Ctx::current()?;
    blocking(move || {
        let _guard = WORK.lock_recover();
        Ok(match create_backup(&ctx, &location, "manual", true, None)? {
            Created::Backup(backup) => BackupResult { backup: Some(backup), skipped: None },
            Created::Unchanged => BackupResult { backup: None, skipped: Some("unchanged".into()) },
            Created::Empty => BackupResult { backup: None, skipped: Some("empty".into()) },
        })
    }).await?
}

#[tauri::command]
pub async fn list_save_backups(location_key: String) -> Result<Vec<BackupInfo>, String> {
    let ctx = Ctx::current()?;
    blocking(move || list_backups(&ctx, &location_key)).await?
}

#[tauri::command]
pub async fn restore_save_backup(id: String) -> Result<RestoreResult, String> {
    let ctx = Ctx::current()?;
    blocking(move || { let _guard = WORK.lock_recover(); restore_backup(&ctx, &id) }).await?
}

#[tauri::command]
pub async fn delete_save_backup(id: String) -> Result<(), String> {
    let ctx = Ctx::current()?;
    blocking(move || { let _guard = WORK.lock_recover(); delete_backup(&ctx, &id) }).await?
}

/// Called when a game closes: backs up its locations in the background, unless it is running again.
#[tauri::command]
pub async fn auto_backup_saves(piko_id: String, hints: Hints) -> Result<AutoSummary, String> {
    if crate::playtime::active().unwrap_or_default().iter().any(|session| session.game_id == piko_id) { return Ok(AutoSummary::default()); }
    let ctx = Ctx::current()?;
    blocking(move || auto_backup(&ctx, &piko_id, &hints)).await
}

#[tauri::command]
pub async fn get_save_backup_settings() -> Result<Settings, String> { Ok(Ctx::current()?.settings) }

#[tauri::command]
pub async fn set_save_backup_settings(settings: Settings) -> Result<Settings, String> {
    let ctx = Ctx::current()?;
    let settings = settings.clamped();
    blocking(move || {
        let _guard = WORK.lock_recover();
        fs::create_dir_all(&ctx.root).map_err(|e| e.to_string())?;
        fsio::write_atomic(&ctx.root.join("settings.json"), &serde_json::to_vec(&settings).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        // Apply the new limits now, to every folder that has backups.
        let ctx = Ctx { settings, ..ctx };
        if let Ok(entries) = fs::read_dir(&ctx.root) { for entry in entries.flatten() { if let Some(key) = entry.file_name().to_str() { if entry.path().is_dir() { prune(&ctx, key, None); } } } }
        Ok(settings)
    }).await?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sources::testutil::temp_dir;
    use std::os::unix::fs::symlink;

    struct Env { base: PathBuf, ctx: Ctx }
    fn env(tag: &str) -> Env {
        let base = fs::canonicalize(temp_dir(tag)).unwrap();
        let home = base.join("home").join("me");
        fs::create_dir_all(&home).unwrap();
        let ctx = Ctx { root: base.join("data").join("save-backups"), home: Some(home), steam_roots: Vec::new(), settings: Settings::default() };
        Env { base, ctx }
    }
    fn write(path: &Path, text: &str) { fs::create_dir_all(path.parent().unwrap()).unwrap(); fs::write(path, text).unwrap(); }
    fn world(env: &Env, name: &str) -> PathBuf {
        let dir = env.ctx.home.as_ref().unwrap().join("saves").join(name);
        write(&dir.join("level.dat"), "level");
        write(&dir.join("region").join("r.0.0.mca"), &"chunk".repeat(1000));
        fs::create_dir_all(dir.join("empty")).unwrap();
        dir
    }
    fn input(path: &Path) -> LocationInput { LocationInput { piko_id: "minecraft".into(), path: path.to_string_lossy().into_owned(), label: "World".into() } }
    fn make(env: &Env, path: &Path, kind: &str, dedupe: bool) -> Created { create_backup(&env.ctx, &input(path), kind, dedupe, None).unwrap() }
    fn info(created: Created) -> BackupInfo { match created { Created::Backup(info) => info, _ => panic!("expected a backup") } }
    fn key_of(env: &Env, path: &Path) -> String { location_key("minecraft", &check_location(path, &env.ctx).unwrap()) }

    #[test]
    fn zip_round_trip_restores_content_and_takes_a_safety_backup() {
        let env = env("sb-roundtrip");
        let dir = world(&env, "World1");
        let first = info(make(&env, &dir, "manual", true));
        assert_eq!((first.files, first.entries), (2, 4));
        write(&dir.join("level.dat"), "changed later");
        write(&dir.join("extra.txt"), "new file");
        let result = restore_backup(&env.ctx, &first.id).unwrap();
        assert_eq!(result.files, 2);
        assert_eq!(fs::read_to_string(dir.join("level.dat")).unwrap(), "level");
        assert!(!dir.join("extra.txt").exists());
        assert!(dir.join("empty").is_dir());
        let safety = result.safety.expect("safety backup");
        assert_eq!(safety.kind, "safety");
        assert_eq!(list_backups(&env.ctx, &first.location_key).unwrap().len(), 2);
        // The safety backup holds the state that was replaced.
        restore_backup(&env.ctx, &safety.id).unwrap();
        assert_eq!(fs::read_to_string(dir.join("extra.txt")).unwrap(), "new file");
        let leftovers: Vec<_> = fs::read_dir(dir.parent().unwrap()).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        assert_eq!(leftovers, ["World1"]);
        let _ = fs::remove_dir_all(&env.base);
    }

    #[test]
    fn unchanged_content_is_not_backed_up_twice() {
        let env = env("sb-dedupe");
        let dir = world(&env, "World1");
        info(make(&env, &dir, "manual", true));
        assert!(matches!(make(&env, &dir, "auto", true), Created::Unchanged));
        write(&dir.join("level.dat"), "a different length");
        info(make(&env, &dir, "auto", true));
        assert_eq!(list_backups(&env.ctx, &key_of(&env, &dir)).unwrap().len(), 2);
        let empty = env.ctx.home.as_ref().unwrap().join("empty-saves");
        fs::create_dir_all(&empty).unwrap();
        assert!(matches!(make(&env, &empty, "manual", true), Created::Empty));
        let _ = fs::remove_dir_all(&env.base);
    }

    #[test]
    fn keeps_only_the_newest_n_backups() {
        let mut env = env("sb-keep");
        env.ctx.settings.keep = 3;
        let dir = world(&env, "World1");
        let mut ids = Vec::new();
        for round in 0..5 { write(&dir.join("level.dat"), &"x".repeat(round + 1)); ids.push(info(make(&env, &dir, "manual", true)).id); }
        let kept: Vec<String> = list_backups(&env.ctx, &key_of(&env, &dir)).unwrap().into_iter().map(|b| b.id).collect();
        assert_eq!(kept, [ids[4].clone(), ids[3].clone(), ids[2].clone()]);
        let key = key_of(&env, &dir);
        assert_eq!(fs::read_dir(env.ctx.root.join(&key)).unwrap().flatten().filter(|e| e.path().extension().is_some_and(|x| x == "zip")).count(), 3);
        let _ = fs::remove_dir_all(&env.base);
    }

    #[test]
    fn size_cap_drops_oldest_but_never_the_newest_of_a_folder() {
        let mut env = env("sb-cap");
        let a = world(&env, "A");
        let b = world(&env, "B");
        let a1 = info(make(&env, &a, "manual", true));
        write(&a.join("level.dat"), "second");
        let a2 = info(make(&env, &a, "manual", true));
        let b1 = info(make(&env, &b, "manual", true));
        env.ctx.settings.max_total_bytes = 1;
        prune(&env.ctx, &b1.location_key, None);
        assert_eq!(list_backups(&env.ctx, &a1.location_key).unwrap().iter().map(|x| x.id.clone()).collect::<Vec<_>>(), [a2.id]);
        assert_eq!(list_backups(&env.ctx, &b1.location_key).unwrap().len(), 1);
        assert!(!env.ctx.root.join(&a1.location_key).join(format!("{}.zip", a1.created_at)).exists());
        let _ = fs::remove_dir_all(&env.base);
    }

    #[test]
    fn a_damaged_backup_fails_the_restore_and_leaves_the_folder_alone() {
        let env = env("sb-damaged");
        let dir = world(&env, "World1");
        let first = info(make(&env, &dir, "manual", true));
        let zip = env.ctx.root.join(&first.location_key).join(format!("{}.zip", first.created_at));
        let bytes = fs::read(&zip).unwrap();
        fs::write(&zip, &bytes[..bytes.len() / 2]).unwrap();
        write(&dir.join("level.dat"), "current");
        assert!(restore_backup(&env.ctx, &first.id).is_err());
        assert_eq!(fs::read_to_string(dir.join("level.dat")).unwrap(), "current");
        assert_eq!(list_backups(&env.ctx, &first.location_key).unwrap().len(), 1);
        // A flipped byte inside the data is caught by the CRC (or the decoder).
        let noisy = env.ctx.home.as_ref().unwrap().join("noisy");
        let data: Vec<u8> = (0..20_000u32).map(|n| (n.wrapping_mul(2_654_435_761) >> 13) as u8).collect();
        fs::create_dir_all(&noisy).unwrap();
        fs::write(noisy.join("data.bin"), &data).unwrap();
        let second = info(make(&env, &noisy, "manual", true));
        let zip = env.ctx.root.join(&second.location_key).join(format!("{}.zip", second.created_at));
        let mut flipped = fs::read(&zip).unwrap();
        let middle = flipped.len() / 2;
        flipped[middle] ^= 0xff;
        fs::write(&zip, flipped).unwrap();
        fs::write(noisy.join("data.bin"), b"current").unwrap();
        assert!(restore_backup(&env.ctx, &second.id).is_err());
        assert_eq!(fs::read(noisy.join("data.bin")).unwrap(), b"current");
        assert_eq!(fs::read_dir(&noisy).unwrap().count(), 1);
        let names: Vec<_> = fs::read_dir(dir.parent().unwrap()).unwrap().flatten().collect();
        assert_eq!(names.len(), 1, "no staging folder left behind");
        let _ = fs::remove_dir_all(&env.base);
    }

    #[test]
    fn a_deleted_folder_is_recreated_by_a_restore() {
        let env = env("sb-recreate");
        let dir = world(&env, "World1");
        let first = info(make(&env, &dir, "manual", true));
        fs::remove_dir_all(&dir).unwrap();
        let result = restore_backup(&env.ctx, &first.id).unwrap();
        assert!(result.safety.is_none());
        assert_eq!(fs::read_to_string(dir.join("level.dat")).unwrap(), "level");
        delete_backup(&env.ctx, &first.id).unwrap();
        assert!(list_backups(&env.ctx, &first.location_key).unwrap().is_empty());
        assert!(delete_backup(&env.ctx, &first.id).is_err());
        let _ = fs::remove_dir_all(&env.base);
    }

    #[test]
    fn unsafe_locations_are_refused_and_symlinks_are_not_followed() {
        let env = env("sb-paths");
        let home = env.ctx.home.clone().unwrap();
        assert!(check_location(&home, &env.ctx).is_err(), "home itself");
        assert!(check_location(home.parent().unwrap(), &env.ctx).is_err(), "a parent of home");
        assert!(check_location(Path::new("/"), &env.ctx).is_err());
        assert!(check_location(Path::new("/usr"), &env.ctx).is_err());
        assert!(check_location(&env.base.join("data"), &env.ctx).is_err(), "contains the backup store");
        assert!(check_location(&home.join("missing"), &env.ctx).is_err());
        write(&home.join("file.txt"), "x");
        assert!(check_location(&home.join("file.txt"), &env.ctx).is_err(), "a file");
        let dir = world(&env, "World1");
        assert!(check_location(&dir, &env.ctx).is_ok());
        // A link that leads to a system folder is resolved before the check.
        symlink("/usr", home.join("usr-link")).unwrap();
        assert!(check_location(&home.join("usr-link"), &env.ctx).is_err());
        // Links inside the folder are left out of the backup, so nothing outside leaks in.
        let secret = env.base.join("secret");
        write(&secret.join("passwords.txt"), "hunter2");
        symlink(&secret, dir.join("escape")).unwrap();
        symlink(secret.join("passwords.txt"), dir.join("link.txt")).unwrap();
        let backup = info(make(&env, &dir, "manual", true));
        assert_eq!(backup.files, 2);
        restore_backup(&env.ctx, &backup.id).unwrap();
        assert!(!dir.join("escape").exists() && !dir.join("link.txt").exists());
        let _ = fs::remove_dir_all(&env.base);
    }

    #[test]
    fn steam_userdata_is_found_in_linux_flatpak_and_macos_layouts() {
        let base = fs::canonicalize(temp_dir("sb-steam")).unwrap();
        let mac = base.join("Users/me/Library/Application Support/Steam");
        let flatpak = base.join("home/me/.var/app/com.valvesoftware.Steam/.local/share/Steam");
        let native = base.join("home/me/.local/share/Steam");
        for root in [&mac, &flatpak, &native] {
            write(&root.join("userdata/1234/480/remote/save.dat"), "s");
            write(&root.join("userdata/1234/570/remote/other.dat"), "o");
            fs::create_dir_all(root.join("userdata/anonymous/480/remote")).unwrap();
        }
        write(&mac.join("userdata/99/480/config/not-remote.txt"), "c");
        // `.steam/steam` is usually a link to the native folder: it counts once.
        fs::create_dir_all(base.join("home/me/.steam")).unwrap();
        symlink(&native, base.join("home/me/.steam/steam")).unwrap();
        let found = steam_remote_dirs(std::slice::from_ref(&mac), 480);
        assert_eq!(found, [("1234".to_string(), mac.join("userdata/1234/480/remote"))]);
        let found = steam_remote_dirs(&[base.join("home/me/.steam/steam"), native.clone(), flatpak.clone()], 480);
        assert_eq!(found.len(), 2);
        assert_eq!(found[0].1, native.join("userdata/1234/480/remote"));
        assert_eq!(found[1].1, flatpak.join("userdata/1234/480/remote"));
        assert!(steam_remote_dirs(&[mac], 12345).is_empty());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn locations_come_from_worlds_steam_and_user_folders() {
        let mut env = env("sb-locations");
        let home = env.ctx.home.clone().unwrap();
        for sub in [".minecraft/saves/Alpha", "minecraft/saves/Beta"] { write(&home.join("inst").join(sub).join("level.dat"), "l"); }
        write(&home.join("inst/.minecraft/saves/not-a-world/readme.txt"), "x");
        let steam = home.join("Steam");
        write(&steam.join("userdata/7/480/remote/a.sav"), "a");
        env.ctx.steam_roots = vec![steam];
        let custom = home.join("docs/MyGame");
        write(&custom.join("slot1.sav"), "s");
        let hints = Hints {
            steam_app_id: Some(480), folders: vec![custom.to_string_lossy().into_owned(), home.join("gone").to_string_lossy().into_owned()],
            instances: vec![InstanceHint { id: "i".into(), name: "Pack".into(), content_root: home.join("inst").to_string_lossy().into_owned() }],
        };
        let found = list_locations(&env.ctx, "minecraft", &hints);
        let kinds: Vec<(&str, &str)> = found.iter().map(|l| (l.kind.as_str(), l.label.as_str())).collect();
        assert_eq!(kinds, [("minecraft", "Alpha"), ("minecraft", "Beta"), ("steam", "Steam Cloud saves (account 7)"), ("custom", "MyGame"), ("custom", "gone")]);
        assert_eq!(found[0].group.as_deref(), Some("Pack"));
        assert!(found[3].problem.is_none() && found[4].problem.is_some());
        info(make(&env, &custom, "manual", true));
        let again = list_locations(&env.ctx, "minecraft", &hints);
        assert_eq!((again[3].backups, again[3].last_backup.is_some()), (1, true));
        let summary = auto_backup(&env.ctx, "minecraft", &hints);
        assert_eq!((summary.created, summary.unchanged, summary.failed), (3, 1, 0));
        assert_eq!(auto_backup(&env.ctx, "minecraft", &hints).created, 0);
        let _ = fs::remove_dir_all(&env.base);
    }

    #[test]
    fn ids_and_settings_are_validated() {
        assert_eq!(parse_id("minecraft-ab12~1700").unwrap(), ("minecraft-ab12".to_string(), 1700));
        assert!(parse_id("../x~1").is_err() && parse_id("a~b").is_err() && parse_id("nothing").is_err());
        let low = Settings { keep: 0, max_total_bytes: 1 }.clamped();
        assert_eq!((low.keep, low.max_total_bytes), (1, 100 << 20));
        assert_eq!(Settings::default().keep, 10);
        assert_eq!(Settings::default().max_total_bytes, 2 << 30);
    }
}
