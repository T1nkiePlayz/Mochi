//! Game output capture: stdout/stderr of every game Mochi starts goes into one file per session
//! (`<app data>/logs/<game id>/<start ms>-<direct|handoff>.log`), size-capped and rotated, and can be read back
//! (tail or follow), cleared and revealed from the UI.
//!
//! A game started through another program (Steam, Flatpak's launcher, macOS `open`) writes nowhere Mochi can see;
//! those sessions are tagged `handoff` so the UI can say where to look instead of showing an empty log.
use crate::util::{now_ms, valid_id};
use serde::Serialize;
use std::{
    fs,
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
};

/// Newest sessions kept per game.
pub const MAX_SESSIONS: usize = 8;
/// A running game's log is cut back to `KEEP_BYTES` once it passes this size.
pub const MAX_BYTES: u64 = 16 * 1024 * 1024;
pub const KEEP_BYTES: u64 = 4 * 1024 * 1024;
const DEFAULT_TAIL: u64 = 256 * 1024;
const MAX_CHUNK: u64 = 1024 * 1024;

pub fn game_log_dir(game_id: &str) -> Result<PathBuf, String> {
    // Library ids may contain other characters (imports); fold them into a safe folder name.
    let safe: String = game_id.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '-' }).take(80).collect();
    if !valid_id(&safe, 80) { return Err("Invalid game id.".into()); }
    let data = crate::modinstance::data_dir().ok_or("Mochi is still starting.")?;
    Ok(data.join("logs").join(safe))
}

/// Opens a new session log in `dir` (after pruning old ones). `direct` is whether the process Mochi starts is the game.
pub fn begin_session(dir: &Path, direct: bool, header: &str) -> std::io::Result<(fs::File, PathBuf)> {
    fs::create_dir_all(dir)?;
    prune(dir, MAX_SESSIONS.saturating_sub(1));
    let path = dir.join(format!("{}-{}.log", now_ms(), if direct { "direct" } else { "handoff" }));
    let mut file = fs::OpenOptions::new().create(true).append(true).open(&path)?;
    writeln!(file, "# {header}")?;
    Ok((file, path))
}

fn session_files(dir: &Path) -> Vec<(u64, bool, PathBuf)> {
    let mut out: Vec<(u64, bool, PathBuf)> = fs::read_dir(dir).into_iter().flatten().flatten().filter_map(|entry| {
        let name = entry.file_name().to_string_lossy().into_owned();
        let stem = name.strip_suffix(".log")?;
        let (started, kind) = stem.split_once('-')?;
        Some((started.parse().ok()?, kind == "direct", entry.path()))
    }).collect();
    out.sort_by_key(|a| std::cmp::Reverse(a.0));
    out
}

fn prune(dir: &Path, keep: usize) {
    for (_, _, path) in session_files(dir).into_iter().skip(keep) { let _ = fs::remove_file(path); }
}

/// Cuts an oversized log back to its last `keep` bytes. The game keeps appending through its own handle
/// (opened with O_APPEND), so it writes at the new end afterwards.
pub fn trim_log(path: &Path, max: u64, keep: u64) -> std::io::Result<bool> {
    let size = fs::metadata(path)?.len();
    if size <= max { return Ok(false); }
    let mut file = fs::OpenOptions::new().read(true).write(true).open(path)?;
    file.seek(SeekFrom::Start(size - keep))?;
    let mut tail = Vec::with_capacity(keep as usize);
    file.read_to_end(&mut tail)?;
    // Start on a line boundary so the log does not open mid-sentence.
    let start = tail.iter().position(|b| *b == b'\n').map(|i| i + 1).unwrap_or(0);
    file.set_len(0)?;
    file.seek(SeekFrom::Start(0))?;
    file.write_all(b"# Mochi: earlier output was removed to keep this log small.\n")?;
    file.write_all(&tail[start..])?;
    Ok(true)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogSession { pub id: String, pub started_at: u64, pub size: u64, pub direct: bool }

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogList { pub dir: String, pub sessions: Vec<LogSession> }

pub fn list_in(dir: &Path) -> Vec<LogSession> {
    session_files(dir).into_iter().map(|(started, direct, path)| LogSession {
        id: path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default(), started_at: started, direct, size: fs::metadata(&path).map(|m| m.len()).unwrap_or(0),
    }).collect()
}

#[tauri::command(async)]
pub fn list_game_logs(game_id: String) -> Result<LogList, String> {
    let dir = game_log_dir(&game_id)?;
    // Created on demand so "Open folder" always has somewhere to go.
    let _ = fs::create_dir_all(&dir);
    Ok(LogList { sessions: list_in(&dir), dir: dir.to_string_lossy().into_owned() })
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LogChunk {
    pub text: String,
    /// Byte offset to pass as `from` on the next call.
    pub offset: u64,
    pub size: u64,
    /// The file shrank (it was trimmed or replaced): the text is a fresh start, not a continuation.
    pub reset: bool,
    /// The text begins after the start of the file (only the tail was returned).
    pub cut_start: bool,
}

pub fn read_chunk(path: &Path, from: Option<u64>, max_bytes: u64) -> std::io::Result<LogChunk> {
    let mut file = fs::File::open(path)?;
    let size = file.metadata()?.len();
    let max = max_bytes.clamp(1, MAX_CHUNK);
    let (mut begin, reset) = match from { Some(from) if from <= size => (from, false), Some(_) => (0, true), None => (0, false) };
    let mut cut_start = false;
    if size - begin > max && (from.is_none() || reset) {
        // A first read (or a restarted file) returns only the newest `max` bytes and says the start was skipped.
        // A follow-up read continues forward from `from`, so nothing is skipped while catching up.
        begin = size - max;
        cut_start = begin > 0;
    }
    file.seek(SeekFrom::Start(begin))?;
    let mut bytes = Vec::new();
    file.take(max).read_to_end(&mut bytes)?;
    // A tail may begin inside a UTF-8 sequence; drop the stray continuation bytes.
    let skip = if cut_start { bytes.iter().take(3).take_while(|b| **b & 0xC0 == 0x80).count() } else { 0 };
    let bytes = &bytes[skip..];
    let used = match std::str::from_utf8(bytes) {
        Ok(_) => bytes.len(),
        // An incomplete sequence at the very end waits for the next read; anything else is shown as-is.
        Err(error) if error.error_len().is_none() => error.valid_up_to(),
        Err(_) => bytes.len(),
    };
    Ok(LogChunk { text: String::from_utf8_lossy(&bytes[..used]).into_owned(), offset: begin + skip as u64 + used as u64, size, reset, cut_start })
}

fn session_path(game_id: &str, session_id: &str) -> Result<PathBuf, String> {
    // Only names this module creates: `<digits>-<direct|handoff>`.
    let ok = session_id.split_once('-').is_some_and(|(n, kind)| !n.is_empty() && n.chars().all(|c| c.is_ascii_digit()) && matches!(kind, "direct" | "handoff"));
    if !ok { return Err("Unknown log.".into()); }
    Ok(game_log_dir(game_id)?.join(format!("{session_id}.log")))
}

#[tauri::command(async)]
pub fn read_game_log(game_id: String, session_id: String, from: Option<u64>, max_bytes: Option<u64>) -> Result<LogChunk, String> {
    let path = session_path(&game_id, &session_id)?;
    read_chunk(&path, from, max_bytes.unwrap_or(DEFAULT_TAIL)).map_err(|e| format!("Unable to read the log: {e}"))
}

#[tauri::command(async)]
pub fn clear_game_logs(game_id: String) -> Result<usize, String> {
    let dir = game_log_dir(&game_id)?;
    let files = session_files(&dir);
    let count = files.len();
    for (_, _, path) in files { let _ = fs::remove_file(path); }
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mochi-logs-{name}-{}-{}", std::process::id(), now_ms()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn sessions_rotate_and_list_newest_first() {
        let dir = temp("rotate");
        for i in 0..12u64 {
            fs::write(dir.join(format!("{}-direct.log", 1000 + i)), b"x").unwrap();
        }
        fs::write(dir.join("notes.txt"), b"ignored").unwrap();
        let (_file, path) = begin_session(&dir, false, "test").unwrap();
        let sessions = list_in(&dir);
        assert_eq!(sessions.len(), MAX_SESSIONS);
        assert!(sessions[0].started_at >= 1011 && !sessions[0].direct);
        assert!(path.exists() && dir.join("notes.txt").exists());
        assert!(sessions.windows(2).all(|w| w[0].started_at >= w[1].started_at));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn oversized_logs_keep_their_tail_on_a_line_boundary() {
        let dir = temp("trim");
        let path = dir.join("1-direct.log");
        let text: String = (0..200).map(|i| format!("line number {i}\n")).collect();
        fs::write(&path, &text).unwrap();
        assert!(!trim_log(&path, 1_000_000, 100).unwrap());
        assert!(trim_log(&path, 500, 300).unwrap());
        let after = fs::read_to_string(&path).unwrap();
        assert!(after.starts_with("# Mochi: earlier output"));
        assert!(after.trim_end().ends_with("line number 199"));
        assert!(after.lines().skip(1).all(|line| line.starts_with("line number")));
        assert!(after.len() < 500);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn reading_follows_appends_and_detects_truncation() {
        let dir = temp("read");
        let path = dir.join("1-direct.log");
        fs::write(&path, "hello\n").unwrap();
        let first = read_chunk(&path, None, 1000).unwrap();
        assert_eq!((first.text.as_str(), first.offset, first.reset, first.cut_start), ("hello\n", 6, false, false));
        fs::OpenOptions::new().append(true).open(&path).unwrap().write_all(b"world\n").unwrap();
        let next = read_chunk(&path, Some(first.offset), 1000).unwrap();
        assert_eq!((next.text.as_str(), next.offset), ("world\n", 12));
        let idle = read_chunk(&path, Some(next.offset), 1000).unwrap();
        assert_eq!(idle.text, "");
        fs::write(&path, "new\n").unwrap();
        let reset = read_chunk(&path, Some(12), 1000).unwrap();
        assert!(reset.reset && reset.text == "new\n");
        let tail = read_chunk(&path, None, 2).unwrap();
        assert!(tail.cut_start && tail.text == "w\n");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn multibyte_text_is_not_split() {
        let dir = temp("utf8");
        let path = dir.join("1-direct.log");
        fs::write(&path, "caf\u{e9} \u{1f60a}").unwrap();
        let chunk = read_chunk(&path, Some(0), 7).unwrap();
        assert!(!chunk.text.contains('\u{fffd}'));
        let rest = read_chunk(&path, Some(chunk.offset), 100).unwrap();
        assert_eq!(format!("{}{}", chunk.text, rest.text), "caf\u{e9} \u{1f60a}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn session_ids_are_restricted() {
        assert!(session_path("g", "../../etc/passwd").is_err());
        assert!(session_path("g", "12-other").is_err());
        assert!(session_path("g", "-direct").is_err());
    }
}
