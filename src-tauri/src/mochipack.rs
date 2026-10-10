//! `.mochipack` files: a small JSON list of a Tofu's mods. The file dialogs run in the webview; these two commands only move
//! the text to and from disk with hard limits (extension, size, regular files), so a pack never reaches anything else.

use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
};

/// Same limit as `MOCHIPACK_MAX_BYTES` in src/lib/mods/mochipack.ts.
const MAX_BYTES: u64 = 2 * 1024 * 1024;

fn extension_of(path: &Path) -> String { path.extension().and_then(|value| value.to_str()).map(str::to_ascii_lowercase).unwrap_or_default() }

pub(crate) fn write_pack(path: &Path, content: &str) -> Result<PathBuf, String> {
    if !path.is_absolute() { return Err("Choose where to save the pack.".into()); }
    if content.len() as u64 > MAX_BYTES { return Err("The pack is too large to save.".into()); }
    let mut target = path.to_path_buf();
    if extension_of(&target) != "mochipack" { target.set_extension("mochipack"); }
    if target.is_dir() { return Err("Choose a file name, not a folder.".into()); }
    write_atomic(&target, content, "pack")?;
    Ok(target)
}

static TEMP_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn temp_path(target: &Path) -> PathBuf {
    let mut temp = target.as_os_str().to_os_string();
    temp.push(format!(".part-{}-{}", std::process::id(), TEMP_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed)));
    PathBuf::from(temp)
}

/// Retry stale-name collisions, while refusing to follow pre-existing files or symlinks.
fn write_atomic(target: &Path, content: &str, label: &str) -> Result<(), String> {
    for _ in 0..16 {
        let temp = temp_path(target);
        match write_atomic_file(target, content, &temp) {
            Ok(()) => return Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("Could not save the {label}: {error}")),
        }
    }
    Err(format!("Could not save the {label}: could not allocate a unique temporary file."))
}

/// Exclusively creates a private sibling file, then renames the completed file into place.
fn write_atomic_file(target: &Path, content: &str, temp: &Path) -> std::io::Result<()> {
    use std::io::Write;
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    // Library/pack contents may be private; do not expose them to other local users.
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
    // Flush file contents before publishing the completed export at its final path.
    if let Err(error) = file.sync_all() {
        drop(file);
        let _ = fs::remove_file(temp);
        return Err(error);
    }
    drop(file);
    fs::rename(temp, target).inspect_err(|_| { let _ = fs::remove_file(temp); })
}

pub(crate) fn read_pack(path: &Path) -> Result<String, String> {
    if !path.is_absolute() { return Err("Choose a modpack file.".into()); }
    if !matches!(extension_of(path).as_str(), "mochipack" | "json" | "txt") { return Err("Choose a .mochipack file.".into()); }
    let meta = fs::metadata(path).map_err(|error| format!("Could not read the file: {error}"))?;
    if !meta.is_file() { return Err("Choose a modpack file.".into()); }
    if meta.len() > MAX_BYTES { return Err("This file is too large to be a modpack.".into()); }
    let mut bytes = Vec::new();
    fs::File::open(path).and_then(|file| file.take(MAX_BYTES + 1).read_to_end(&mut bytes)).map_err(|error| format!("Could not read the file: {error}"))?;
    if bytes.len() as u64 > MAX_BYTES { return Err("This file is too large to be a modpack.".into()); }
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// Saves a pack's JSON; returns the path actually written (the `.mochipack` extension is added when missing).
#[tauri::command(async)]
pub fn write_mochipack_file(path: String, content: String) -> Result<String, String> { write_pack(Path::new(&path), &content).map(|target| target.to_string_lossy().into_owned()) }

/// Reads a pack file as text (the frontend validates it strictly).
#[tauri::command(async)]
pub fn read_mochipack_file(path: String) -> Result<String, String> { read_pack(Path::new(&path)) }

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mochi-mochipack-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn writes_with_the_extension_and_reads_back() {
        let dir = temp_dir("roundtrip");
        let written = write_pack(&dir.join("my pack"), "{\"format\":\"mochipack\"}").unwrap();
        assert_eq!(written, dir.join("my pack.mochipack"));
        assert_eq!(read_pack(&written).unwrap(), "{\"format\":\"mochipack\"}");
        assert!(!dir.join("my pack.mochipack.part").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn refuses_relative_paths_wrong_extensions_folders_and_big_files() {
        let dir = temp_dir("refuse");
        assert!(write_pack(Path::new("pack.mochipack"), "x").is_err());
        assert!(read_pack(Path::new("pack.mochipack")).is_err());
        assert!(read_pack(&dir.join("notes.exe")).is_err());
        assert!(read_pack(&dir).is_err());
        let big = dir.join("big.mochipack");
        fs::write(&big, vec![b'a'; (MAX_BYTES + 1) as usize]).unwrap();
        assert!(read_pack(&big).is_err());
        assert!(write_pack(&dir.join("x"), &"a".repeat((MAX_BYTES + 1) as usize)).is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn refuses_a_precreated_symlink_as_the_temporary_file() {
        use std::os::unix::fs::symlink;
        let dir = temp_dir("symlink-temp");
        let target = dir.join("export.mochipack");
        let victim = dir.join("victim.txt");
        let temp = dir.join("export.mochipack.part");
        fs::write(&victim, "keep me").unwrap();
        symlink(&victim, &temp).unwrap();

        assert!(write_atomic_file(&target, "overwrite", &temp).is_err());
        assert_eq!(fs::read_to_string(&victim).unwrap(), "keep me");
        assert!(fs::symlink_metadata(&temp).unwrap().file_type().is_symlink());
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn replaces_an_existing_export_without_leaving_partial_contents() {
        let dir = temp_dir("replace-existing");
        let target = dir.join("existing.mochipack");
        fs::write(&target, "old contents that are longer").unwrap();
        write_pack(&target, r#"{"new":true}"#).unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), r#"{"new":true}"#);
        let leftovers: Vec<_> = fs::read_dir(&dir).unwrap().flatten()
            .filter(|entry| entry.file_name().to_string_lossy().contains(".part-"))
            .collect();
        assert!(leftovers.is_empty(), "temporary export files should be cleaned up");
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn exported_files_are_private_to_the_current_user() {
        use std::os::unix::fs::PermissionsExt;
        let dir = temp_dir("private-mode");
        let target = dir.join("private.mochipack");
        write_pack(&target, "{}").unwrap();
        assert_eq!(fs::metadata(target).unwrap().permissions().mode() & 0o777, 0o600);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_name_that_is_a_folder_is_refused() {
        let dir = temp_dir("folder");
        fs::create_dir_all(dir.join("x.mochipack")).unwrap();
        assert!(write_pack(&dir.join("x.mochipack"), "{}").is_err());
        let _ = fs::remove_dir_all(&dir);
    }
}
