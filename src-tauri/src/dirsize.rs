//! Bounded directory size measurement for the Installed view.

use serde::Serialize;
use crate::util::MutexExt;
use std::{collections::HashMap, fs, path::Path, sync::Mutex, time::{Duration, Instant, SystemTime}};

const MAX_ENTRIES: u64 = 250_000;
const MAX_DEPTH: usize = 24;
const TIME_BUDGET: Duration = Duration::from_secs(8);

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DirSize {
    pub bytes: u64,
    pub files: u64,
    /// True when the walk hit the entry or time cap, so `bytes` is a lower bound.
    pub truncated: bool,
}

/// A measured folder is reused this long (the Installed view asks again on every visit); a changed top-level
/// folder (files added, removed or renamed there, which is where mods live) invalidates it immediately.
const CACHE_TTL: Duration = Duration::from_secs(30);
const CACHE_MAX_ENTRIES: usize = 256;

type Cache = HashMap<String, (Instant, Option<SystemTime>, DirSize)>;

/// `dir_size` with a short-lived cache. Failed or truncated measurements are never cached.
pub fn dir_size_cached(path: &str) -> Result<DirSize, String> {
    static CACHE: Mutex<Option<Cache>> = Mutex::new(None);
    let modified = fs::metadata(path).and_then(|meta| meta.modified()).ok();
    if let Some((at, stamp, size)) = CACHE.lock_recover().get_or_insert_with(HashMap::new).get(path) {
        if at.elapsed() < CACHE_TTL && *stamp == modified { return Ok(size.clone()); }
    }
    let size = dir_size(path)?;
    if !size.truncated {
        let mut guard = CACHE.lock_recover();
        let cache = guard.get_or_insert_with(HashMap::new);
        if cache.len() >= CACHE_MAX_ENTRIES { cache.retain(|_, (at, _, _)| at.elapsed() < CACHE_TTL); }
        if cache.len() >= CACHE_MAX_ENTRIES { cache.clear(); }
        cache.insert(path.to_string(), (Instant::now(), modified, size.clone()));
    }
    Ok(size)
}

/// Sums file sizes below `path`. Symlinks are never followed; the walk stops at a cap or deadline.
pub fn dir_size(path: &str) -> Result<DirSize, String> {
    let root = Path::new(path);
    // Follows a symlink at the root only: a game library folder that is itself a link is common. Links below it are skipped.
    let meta = fs::metadata(root).map_err(|e| format!("Unable to read folder: {e}"))?;
    if !meta.is_dir() { return Err("Not a folder.".into()); }
    let deadline = Instant::now() + TIME_BUDGET;
    let mut result = DirSize { bytes: 0, files: 0, truncated: false };
    let mut stack = vec![(root.to_path_buf(), 0usize)];
    let mut seen = 0u64;
    while let Some((dir, depth)) = stack.pop() {
        let Ok(entries) = fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            seen += 1;
            if seen > MAX_ENTRIES || Instant::now() > deadline { result.truncated = true; return Ok(result); }
            let Ok(meta) = entry.metadata() else { continue };
            let kind = meta.file_type();
            if kind.is_symlink() { continue; }
            if kind.is_dir() {
                if depth < MAX_DEPTH { stack.push((entry.path(), depth + 1)); } else { result.truncated = true; }
            } else {
                result.bytes = result.bytes.saturating_add(meta.len());
                result.files += 1;
            }
        }
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sums_nested_files_and_rejects_files() {
        let root = std::env::temp_dir().join(format!("mochi-dirsize-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("a/b")).unwrap();
        fs::write(root.join("x"), [0u8; 10]).unwrap();
        fs::write(root.join("a/b/y"), [0u8; 32]).unwrap();
        let size = dir_size(root.to_str().unwrap()).unwrap();
        assert_eq!((size.bytes, size.files, size.truncated), (42, 2, false));
        assert!(dir_size(root.join("x").to_str().unwrap()).is_err());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn cached_sizes_are_reused_until_the_folder_changes() {
        let root = std::env::temp_dir().join(format!("mochi-dirsize-cache-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("sub")).unwrap();
        fs::write(root.join("a"), [0u8; 5]).unwrap();
        let path = root.to_str().unwrap();
        assert_eq!(dir_size_cached(path).unwrap().bytes, 5);
        // A change below the top level is not noticed within the TTL...
        fs::write(root.join("sub/b"), [0u8; 5]).unwrap();
        assert_eq!(dir_size_cached(path).unwrap().bytes, 5);
        // ...but a change at the top level is, at once. (Force a distinct mtime so coarse clocks cannot hide it.)
        fs::write(root.join("c"), [0u8; 5]).unwrap();
        fs::File::open(&root).unwrap().set_modified(SystemTime::now() + Duration::from_secs(5)).unwrap();
        assert_eq!(dir_size_cached(path).unwrap().bytes, 15);
        assert!(dir_size_cached(root.join("missing").to_str().unwrap()).is_err());
        let _ = fs::remove_dir_all(&root);
    }

    #[cfg(unix)]
    #[test]
    fn follows_a_symlinked_root_but_not_inner_links() {
        let base = std::env::temp_dir().join(format!("mochi-dirsize-link-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(base.join("real")).unwrap();
        fs::write(base.join("real/a"), [0u8; 7]).unwrap();
        fs::write(base.join("outside"), [0u8; 1000]).unwrap();
        std::os::unix::fs::symlink(base.join("outside"), base.join("real/inner")).unwrap();
        std::os::unix::fs::symlink(base.join("real"), base.join("lib")).unwrap();
        let size = dir_size(base.join("lib").to_str().unwrap()).unwrap();
        assert_eq!((size.bytes, size.files), (7, 1));
        assert!(dir_size(base.join("missing").to_str().unwrap()).is_err());
        let _ = fs::remove_dir_all(&base);
    }
}
