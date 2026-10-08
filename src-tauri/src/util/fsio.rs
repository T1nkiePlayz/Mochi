//! Atomic file writes: write a uniquely named sibling, then rename over the target, so a crash or a
//! concurrent writer never leaves a half-written file behind.

use std::{
    fs,
    io::Write,
    path::Path,
    sync::atomic::{AtomicU64, Ordering},
};

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

fn write_atomic_inner(path: &Path, bytes: &[u8], sync: bool) -> std::io::Result<()> {
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("file");
    // Unique per call: two concurrent writers of one target must not interleave into one temp file.
    let temp = path.with_file_name(format!(".{name}.{}-{}.tmp", std::process::id(), TEMP_COUNTER.fetch_add(1, Ordering::Relaxed)));
    let result = (|| {
        let mut file = fs::File::create(&temp)?;
        file.write_all(bytes)?;
        if sync { file.sync_all()?; }
        drop(file);
        fs::rename(&temp, path)
    })();
    if result.is_err() { let _ = fs::remove_file(&temp); }
    result
}

/// For caches and downloads that can simply be fetched again.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    write_atomic_inner(path, bytes, false)
}

/// Also flushes the data to disk before the rename, for user data (config, playtime history).
pub fn write_atomic_durable(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    write_atomic_inner(path, bytes, true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replaces_content_and_leaves_no_temp_files() {
        let dir = std::env::temp_dir().join(format!("mochi-fsio-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let target = dir.join("data.json");
        write_atomic(&target, b"one").unwrap();
        write_atomic_durable(&target, b"two").unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"two");
        let names: Vec<String> = fs::read_dir(&dir).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        assert_eq!(names, vec!["data.json"]);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_failed_write_cleans_up_its_temp_file() {
        let dir = std::env::temp_dir().join(format!("mochi-fsio-fail-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("target")).unwrap();
        // Renaming a file over a directory fails.
        assert!(write_atomic(&dir.join("target"), b"x").is_err());
        let names: Vec<String> = fs::read_dir(&dir).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        assert_eq!(names, vec!["target"]);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn concurrent_writers_do_not_clash() {
        let dir = std::env::temp_dir().join(format!("mochi-fsio-par-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let target = dir.join("x");
        std::thread::scope(|scope| {
            for i in 0..8 { let target = &target; scope.spawn(move || write_atomic(target, format!("writer {i}").as_bytes()).unwrap()); }
        });
        assert!(fs::read_to_string(&target).unwrap().starts_with("writer "));
        let _ = fs::remove_dir_all(&dir);
    }
}
