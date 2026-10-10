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
    // A unique sibling and create_new prevent a pre-created symlink or file from being followed.
    let temp = temp_path(&target);
    write_atomic_to(&target, content, &temp, "pack")?;
    Ok(target)
}

static TEMP_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn temp_path(target: &Path) -> PathBuf {
    let mut temp = target.as_os_str().to_os_string();
    temp.push(format!(".part-{}-{}", std::process::id(), TEMP_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed)));
    PathBuf::from(temp)
}

/// The temp file is created exclusively (never follows a symlink), then renamed into place.
fn write_atomic_to(target: &Path, content: &str, temp: &Path, label: &str) -> Result<(), String> {
    use std::io::Write;
    let mut file = fs::OpenOptions::new().write(true).create_new(true).open(temp)
        .map_err(|error| format!("Could not save the {label}: {error}"))?;
    if let Err(error) = file.write_all(content.as_bytes()) {
        drop(file);
        let _ = fs::remove_file(temp);
        return Err(format!("Could not save the {label}: {error}"));
    }
    drop(file);
    fs::rename(temp, target).map_err(|error| {
        let _ = fs::remove_file(temp);
        format!("Could not save the {label}: {error}")
    })
}
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

        assert!(write_atomic_to(&target, "overwrite", &temp, "pack").is_err());
        assert_eq!(fs::read_to_string(&victim).unwrap(), "keep me");
        assert!(fs::symlink_metadata(&temp).unwrap().file_type().is_symlink());
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
