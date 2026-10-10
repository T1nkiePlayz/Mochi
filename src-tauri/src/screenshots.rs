//! Screenshot manager: finds a game's screenshots where launchers and the user keep them and makes small
//! thumbnails the window can show. Files are only read, never moved or deleted.
//!
//! Steam keeps them in `userdata/<account>/760/remote/<appid>/screenshots`. Other launchers have no standard
//! place, so the user can name folders per game (used directly) or shared folders whose sub-folder named like the game is used.
use crate::util::fsio;
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, fs, path::{Path, PathBuf}, sync::Mutex, time::UNIX_EPOCH};
use tauri::AppHandle;

const MAX_FILES: usize = 300;
const MAX_FOLDER_DEPTH: usize = 2;
const MAX_THUMBS_PER_CALL: usize = 60;
const THUMB_WIDTH: u32 = 480;
const MAX_SOURCE_BYTES: u64 = 80 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ScanRequest {
    pub steam_app_id: Option<u32>,
    pub game_name: String,
    /// Folders that hold this game's screenshots directly.
    pub game_folders: Vec<String>,
    /// Folders with one sub-folder per game, named like the game.
    pub shared_folders: Vec<String>,
}
impl Default for ScanRequest { fn default() -> Self { Self { steam_app_id: None, game_name: String::new(), game_folders: vec![], shared_folders: vec![] } } }

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotFile { pub path: String, /// Unix seconds.
    pub modified: u64, pub source: &'static str }

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Thumb { pub path: String, pub thumb: String }

/// Paths the scan returned: only these may be turned into thumbnails, so the command cannot read arbitrary files.
static KNOWN: Mutex<Option<HashSet<PathBuf>>> = Mutex::new(None);

fn is_image(path: &Path) -> bool {
    path.extension().and_then(|ext| ext.to_str()).is_some_and(|ext| matches!(ext.to_ascii_lowercase().as_str(), "png" | "jpg" | "jpeg" | "webp"))
}

fn normalize(name: &str) -> String { name.chars().filter(|c| c.is_alphanumeric()).flat_map(char::to_lowercase).collect() }

fn real_dir(path: &Path) -> bool { fs::symlink_metadata(path).is_ok_and(|meta| meta.is_dir()) }

fn collect(dir: &Path, source: &'static str, depth: usize, out: &mut Vec<ScreenshotFile>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(meta) = fs::symlink_metadata(&path) else { continue };
        if meta.is_dir() {
            // Steam keeps downscaled copies in `thumbnails`; they are not wanted.
            if depth < MAX_FOLDER_DEPTH && path.file_name().is_some_and(|name| name != "thumbnails") { collect(&path, source, depth + 1, out); }
        } else if meta.is_file() && is_image(&path) && meta.len() <= MAX_SOURCE_BYTES {
            let modified = meta.modified().ok().and_then(|time| time.duration_since(UNIX_EPOCH).ok()).map_or(0, |d| d.as_secs());
            out.push(ScreenshotFile { path: path.to_string_lossy().into_owned(), modified, source });
        }
        if out.len() >= MAX_FILES * 2 { return; }
    }
}

fn steam_roots(home: &Path) -> Vec<PathBuf> {
    vec![home.join(".steam/steam"), home.join(".local/share/Steam"), home.join(".var/app/com.valvesoftware.Steam/.local/share/Steam"), home.join("Library/Application Support/Steam")]
}

/// `userdata/<account>/760/remote/<appid>/screenshots` for every account of every Steam install.
fn steam_dirs(home: &Path, appid: u32) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    for root in steam_roots(home) {
        for account in fs::read_dir(root.join("userdata")).into_iter().flatten().flatten() {
            let dir = account.path().join("760/remote").join(appid.to_string()).join("screenshots");
            if real_dir(&dir) { dirs.push(dir); }
        }
    }
    dirs
}

pub fn scan_in(home: Option<&Path>, request: &ScanRequest) -> Vec<ScreenshotFile> {
    let mut found = Vec::new();
    if let (Some(home), Some(appid)) = (home, request.steam_app_id) {
        for dir in steam_dirs(home, appid) { collect(&dir, "steam", 0, &mut found); }
    }
    for folder in &request.game_folders {
        let path = PathBuf::from(folder);
        if path.is_absolute() && real_dir(&path) { collect(&path, "folder", 0, &mut found); }
    }
    let wanted = normalize(&request.game_name);
    if !wanted.is_empty() {
        for folder in &request.shared_folders {
            let base = PathBuf::from(folder);
            if !base.is_absolute() || !real_dir(&base) { continue; }
            for child in fs::read_dir(&base).into_iter().flatten().flatten() {
                let path = child.path();
                if real_dir(&path) && path.file_name().is_some_and(|name| normalize(&name.to_string_lossy()) == wanted) { collect(&path, "folder", 0, &mut found); }
            }
        }
    }
    found.sort_by(|a, b| b.modified.cmp(&a.modified).then_with(|| a.path.cmp(&b.path)));
    found.dedup_by(|a, b| a.path == b.path);
    found.truncate(MAX_FILES);
    found
}

#[tauri::command(async)]
pub fn scan_screenshots(request: ScanRequest) -> Vec<ScreenshotFile> {
    let home = crate::platform::home_dir();
    let found = scan_in(home.as_deref(), &request);
    if let Ok(mut known) = KNOWN.lock() { known.get_or_insert_with(HashSet::new).extend(found.iter().map(|file| PathBuf::from(&file.path))); }
    found
}

fn thumb_name(path: &Path, modified: u64) -> String {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    (path, modified).hash(&mut hasher);
    format!("{:016x}.jpg", hasher.finish())
}

fn make_thumb(source: &Path, target: &Path) -> Result<(), String> {
    let image = image::open(source).map_err(|error| format!("Unable to read {}: {error}", source.display()))?;
    let small = image.thumbnail(THUMB_WIDTH, THUMB_WIDTH);
    let mut bytes = Vec::new();
    small.to_rgb8().write_to(&mut std::io::Cursor::new(&mut bytes), image::ImageFormat::Jpeg).map_err(|error| error.to_string())?;
    fsio::write_atomic(target, &bytes).map_err(|error| error.to_string())
}

/// Thumbnails (inside the artwork cache, which the window may display) for paths a scan returned. Others are ignored.
#[tauri::command(async)]
pub fn make_screenshot_thumbs(app: AppHandle, paths: Vec<String>) -> Vec<Thumb> {
    let Ok(dir) = crate::themes::game_artwork_cache_dir(&app).map(|dir| dir.join("screenshots")) else { return vec![] };
    if fs::create_dir_all(&dir).is_err() { return vec![]; }
    let known = KNOWN.lock().ok().and_then(|guard| guard.clone()).unwrap_or_default();
    paths.into_iter().take(MAX_THUMBS_PER_CALL).filter_map(|path| {
        let source = PathBuf::from(&path);
        if !known.contains(&source) { return None; }
        let modified = fs::metadata(&source).ok()?.modified().ok()?.duration_since(UNIX_EPOCH).ok()?.as_secs();
        let target = dir.join(thumb_name(&source, modified));
        if !target.exists() && make_thumb(&source, &target).is_err() { return None; }
        Some(Thumb { path, thumb: target.to_string_lossy().into_owned() })
    }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mochi-shots-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn finds_steam_and_named_folder_screenshots_and_skips_thumbnails() {
        let home = temp("home");
        let steam = home.join(".local/share/Steam/userdata/42/760/remote/620/screenshots");
        fs::create_dir_all(steam.join("thumbnails")).unwrap();
        fs::write(steam.join("a.jpg"), b"x").unwrap();
        fs::write(steam.join("thumbnails/a.jpg"), b"x").unwrap();
        fs::write(steam.join("notes.txt"), b"x").unwrap();
        let shared = home.join("Pictures");
        fs::create_dir_all(shared.join("Portal 2")).unwrap();
        fs::create_dir_all(shared.join("Other")).unwrap();
        fs::write(shared.join("Portal 2/b.png"), b"x").unwrap();
        fs::write(shared.join("Other/c.png"), b"x").unwrap();
        let request = ScanRequest { steam_app_id: Some(620), game_name: "portal-2".into(), shared_folders: vec![shared.to_string_lossy().into()], ..Default::default() };
        let mut names: Vec<_> = scan_in(Some(&home), &request).iter().map(|f| (Path::new(&f.path).file_name().unwrap().to_string_lossy().into_owned(), f.source)).collect();
        names.sort();
        assert_eq!(names, [("a.jpg".to_string(), "steam"), ("b.png".to_string(), "folder")]);
        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn relative_and_missing_folders_are_ignored() {
        let request = ScanRequest { game_name: "x".into(), game_folders: vec!["relative/dir".into(), "/definitely/not/here".into()], ..Default::default() };
        assert!(scan_in(None, &request).is_empty());
    }
}
