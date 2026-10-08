//! Bounded directory size measurement for the Installed view.

use serde::Serialize;
use std::{fs, path::Path, time::{Duration, Instant}};

const MAX_ENTRIES: u64 = 250_000;
const MAX_DEPTH: usize = 24;
const TIME_BUDGET: Duration = Duration::from_secs(8);

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DirSize {
    pub bytes: u64,
    pub files: u64,
    /// True when the walk hit the entry or time cap, so `bytes` is a lower bound.
    pub truncated: bool,
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
