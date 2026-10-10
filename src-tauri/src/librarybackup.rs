//! `.mochibackup` files: one JSON file holding a copy of the library data kept in the webview. The file dialogs run in the
//! webview; these commands only move the text to and from disk with hard limits (extension, size, regular files, a fixed
//! file-name pattern for scheduled copies), so a backup path can never reach anything else.

use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
};

const MAX_BYTES: u64 = 64 * 1024 * 1024;
const EXTENSION: &str = "mochibackup";
const SCHEDULED_PREFIX: &str = "mochi-backup-";
const MAX_KEEP: usize = 50;

fn extension_of(path: &Path) -> String { path.extension().and_then(|value| value.to_str()).map(str::to_ascii_lowercase).unwrap_or_default() }

fn write_atomic(target: &Path, content: &str) -> Result<(), String> {
    if content.len() as u64 > MAX_BYTES { return Err("The backup is too large to save.".into()); }
    if target.is_dir() { return Err("Choose a file name, not a folder.".into()); }
    write_atomic_to(target, content)
}

static TEMP_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn temp_path(target: &Path) -> PathBuf {
    let mut temp = target.as_os_str().to_os_string();
    temp.push(format!(".part-{}-{}", std::process::id(), TEMP_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed)));
    PathBuf::from(temp)
}

/// Retry stale-name collisions and keep backup contents private to the current user.
fn write_atomic_to(target: &Path, content: &str) -> Result<(), String> {
    for _ in 0..16 {
        let temp = temp_path(target);
        match write_atomic_file(target, content, &temp) {
            Ok(()) => return Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("Could not save the backup: {error}")),
        }
    }
    Err("Could not save the backup: could not allocate a unique temporary file.".into())
}

/// Exclusive creation prevents symlink redirection; mode 0600 avoids leaking backup contents on Unix.
fn write_atomic_file(target: &Path, content: &str, temp: &Path) -> std::io::Result<()> {
    use std::io::Write;
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(temp)?;
    if let Err(error) = file.write_all(content.as_bytes()) {
        drop(file);
        let _ = fs::remove_file(temp);
        return Err(error);
    }
    drop(file);
    fs::rename(temp, target).inspect_err(|_| { let _ = fs::remove_file(temp); })
}

pub(crate) fn write_backup(path: &Path, content: &str) -> Result<PathBuf, String> {
    if !path.is_absolute() { return Err("Choose where to save the backup.".into()); }
    let mut target = path.to_path_buf();
    if extension_of(&target) != EXTENSION { target.set_extension(EXTENSION); }
    write_atomic(&target, content)?;
    Ok(target)
}

pub(crate) fn read_backup(path: &Path) -> Result<String, String> {
    if !path.is_absolute() { return Err("Choose a backup file.".into()); }
    if extension_of(path) != EXTENSION { return Err("Choose a .mochibackup file.".into()); }
    let meta = fs::metadata(path).map_err(|error| format!("Could not read the file: {error}"))?;
    if !meta.is_file() { return Err("Choose a backup file.".into()); }
    if meta.len() > MAX_BYTES { return Err("This file is too large to be a Mochi backup.".into()); }
    let mut bytes = Vec::new();
    fs::File::open(path).and_then(|file| file.take(MAX_BYTES + 1).read_to_end(&mut bytes)).map_err(|error| format!("Could not read the file: {error}"))?;
    if bytes.len() as u64 > MAX_BYTES { return Err("This file is too large to be a Mochi backup.".into()); }
    String::from_utf8(bytes).map_err(|_| "This file is not a Mochi backup.".to_string())
}

/// A scheduled copy's file name: `mochi-backup-<letters, digits, dashes>.mochibackup`, nothing else.
fn scheduled_name_ok(name: &str) -> bool {
    let Some(stem) = name.strip_suffix(&format!(".{EXTENSION}")) else { return false };
    let Some(rest) = stem.strip_prefix(SCHEDULED_PREFIX) else { return false };
    !rest.is_empty() && rest.len() <= 40 && rest.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}

/// Scheduled copies already in `dir`, oldest first.
fn scheduled_files(dir: &Path) -> Vec<(std::time::SystemTime, PathBuf)> {
    let mut found: Vec<_> = fs::read_dir(dir).into_iter().flatten().flatten()
        .filter(|entry| entry.file_name().to_str().is_some_and(scheduled_name_ok) && entry.metadata().is_ok_and(|meta| meta.is_file()))
        .filter_map(|entry| Some((entry.metadata().ok()?.modified().ok()?, entry.path())))
        .collect();
    found.sort();
    found
}

/// Writes a scheduled copy into `dir` and keeps only the newest `keep` copies (copies made by hand are never touched).
pub(crate) fn write_scheduled(dir: &Path, name: &str, content: &str, keep: usize) -> Result<PathBuf, String> {
    if !dir.is_absolute() || !dir.is_dir() { return Err("The backup folder is not available.".into()); }
    if !scheduled_name_ok(name) { return Err("Invalid backup name.".into()); }
    let target = dir.join(name);
    write_atomic(&target, content)?;
    let files = scheduled_files(dir);
    let surplus = files.len().saturating_sub(keep.clamp(1, MAX_KEEP));
    for (_, old) in files.into_iter().take(surplus) { if old != target { let _ = fs::remove_file(old); } }
    Ok(target)
}

/// Saves a backup chosen in a save dialog; returns the path written (the extension is added when missing).
#[tauri::command(async)]
pub fn write_library_backup(path: String, content: String) -> Result<String, String> { write_backup(Path::new(&path), &content).map(|target| target.to_string_lossy().into_owned()) }

/// Reads a backup file as text (the frontend validates it strictly).
#[tauri::command(async)]
pub fn read_library_backup(path: String) -> Result<String, String> { read_backup(Path::new(&path)) }

/// Writes the scheduled copy `name` into `folder` and prunes older scheduled copies.
#[tauri::command(async)]
pub fn write_scheduled_library_backup(folder: String, name: String, content: String, keep: usize) -> Result<String, String> {
    write_scheduled(Path::new(&folder), &name, &content, keep).map(|target| target.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mochi-backup-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn only_the_fixed_scheduled_names_are_accepted() {
        assert!(scheduled_name_ok("mochi-backup-2026-05-01.mochibackup"));
        for bad in ["../x.mochibackup", "mochi-backup-.mochibackup", "mochi-backup-a/b.mochibackup", "other.mochibackup", "mochi-backup-1.json"] { assert!(!scheduled_name_ok(bad), "{bad}"); }
    }

    #[test]
    fn scheduled_copies_are_pruned_but_manual_ones_stay() {
        let dir = temp("prune");
        fs::write(dir.join("my-own.mochibackup"), "x").unwrap();
        for day in 1..=4 {
            write_scheduled(&dir, &format!("mochi-backup-2026-05-0{day}.mochibackup"), "{}", 2).unwrap();
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        assert_eq!(scheduled_files(&dir).len(), 2);
        assert!(dir.join("my-own.mochibackup").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn refuses_a_precreated_symlink_as_the_temporary_file() {
        use std::os::unix::fs::symlink;
        let dir = temp("symlink-temp");
        let target = dir.join("export.mochibackup");
        let victim = dir.join("victim.txt");
        let temp = dir.join("export.mochibackup.part");
        fs::write(&victim, "keep me").unwrap();
        symlink(&victim, &temp).unwrap();

        assert!(write_atomic_file(&target, "overwrite", &temp).is_err());
        assert_eq!(fs::read_to_string(&victim).unwrap(), "keep me");
        assert!(fs::symlink_metadata(&temp).unwrap().file_type().is_symlink());
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn backup_files_are_private_to_the_current_user() {
        use std::os::unix::fs::PermissionsExt;
        let dir = temp("private-mode");
        let target = dir.join("private.mochibackup");
        write_backup(&target, "{\"private\":true}").unwrap();
        assert_eq!(fs::metadata(target).unwrap().permissions().mode() & 0o777, 0o600);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn manual_backups_need_an_absolute_path_and_the_extension() {
        assert!(write_backup(Path::new("relative.mochibackup"), "{}").is_err());
        assert!(read_backup(Path::new("/tmp/x.txt")).is_err());
        let dir = temp("manual");
        let written = write_backup(&dir.join("lib"), "{\"a\":1}").unwrap();
        assert_eq!(written.extension().unwrap(), "mochibackup");
        assert_eq!(read_backup(&written).unwrap(), "{\"a\":1}");
        let _ = fs::remove_dir_all(&dir);
    }
}
