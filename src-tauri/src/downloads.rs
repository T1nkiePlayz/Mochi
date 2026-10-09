//! Provider-aware mod downloader: host allow-lists, size cap, SHA-1 verification and safe zip extraction.
use crate::modrinth::{
    active_download_count, cleanup_downloads, lock_downloads, update_download, validate_download_filename, validate_path, DownloadEntry,
    MAX_DOWNLOAD_BYTES, NEXT_DOWNLOAD_ID,
};
use crate::util::{hex, http, now_ms, MutexExt};
use serde::Deserialize;
use sha1::{Digest, Sha1};
use std::{
    collections::HashSet,
    fs,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    sync::{atomic::Ordering, Mutex, OnceLock},
};

/// Downloads running at once; more would just compete for the same bandwidth and disk.
const MAX_ACTIVE_DOWNLOADS: usize = 8;
const TEMP_MARKER: &str = ".mochi-download-";
const STALE_TEMP_SECS: u64 = 60 * 60;

/// Destinations currently being written, so two downloads of one filename cannot interleave.
fn in_flight() -> &'static Mutex<HashSet<PathBuf>> {
    static SET: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();
    SET.get_or_init(Default::default)
}

struct DestinationGuard(PathBuf);

impl DestinationGuard {
    fn acquire(path: &Path) -> Result<Self, String> {
        let mut set = in_flight().lock_recover();
        if set.insert(path.to_path_buf()) { Ok(Self(path.to_path_buf())) } else { Err("That file is already being downloaded.".into()) }
    }
}

impl Drop for DestinationGuard {
    fn drop(&mut self) { in_flight().lock_recover().remove(&self.0); }
}

/// Removes `*.mochi-download-N` leftovers from crashed or killed sessions (never one that is still fresh).
fn remove_stale_temp_files(dir: &Path) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        if !entry.file_name().to_string_lossy().contains(TEMP_MARKER) { continue; }
        let old_enough = entry.metadata().ok().and_then(|m| m.modified().ok()).and_then(|t| t.elapsed().ok()).is_some_and(|age| age.as_secs() > STALE_TEMP_SECS);
        if old_enough { let _ = fs::remove_file(entry.path()); }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider { Modrinth, Curseforge, Nexus }

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModDownloadRequest {
    pub provider: Provider,
    pub url: String,
    pub path: String,
    pub tofu_id: String,
    pub tofu_name: String,
    pub item_name: String,
    pub filename: String,
    #[serde(default)]
    pub sha1: Option<String>,
    #[serde(default)]
    pub extract: Option<bool>,
    #[serde(default)]
    pub keep_archive: Option<bool>,
    /// "resourcepacks" or "shaderpacks": lands in that folder inside `path` instead of `path` itself.
    #[serde(default)]
    pub subdir: Option<String>,
    /// Where the file came from, saved with the Tofu's mod list once the download verified.
    #[serde(default)]
    pub record: Option<crate::modinstance::RecordInput>,
}

impl Provider {
    fn id(self) -> &'static str {
        match self { Provider::Modrinth => "modrinth", Provider::Curseforge => "curseforge", Provider::Nexus => "nexus" }
    }

    fn label(self) -> &'static str {
        match self { Provider::Modrinth => "Modrinth", Provider::Curseforge => "CurseForge", Provider::Nexus => "Nexus Mods" }
    }

    /// Exact hosts, plus domains whose subdomains are trusted (suffix match on a dot boundary).
    fn host_rules(self) -> (&'static [&'static str], &'static [&'static str]) {
        match self {
            Provider::Modrinth => (&["cdn.modrinth.com"], &[]),
            Provider::Curseforge => (&["edge.forgecdn.net", "mediafilez.forgecdn.net"], &[]),
            // Nexus download links point at *.nexus-cdn.com (premium-files, supporter-files, ...) and the legacy cf-files host.
            Provider::Nexus => (&["cf-files.nexusmods.com", "filedelivery.nexusmods.com"], &["nexus-cdn.com"]),
        }
    }
}

fn host_allowed(provider: Provider, host: &str) -> bool {
    let host = host.to_ascii_lowercase();
    let (exact, suffixes) = provider.host_rules();
    exact.contains(&host.as_str()) || suffixes.iter().any(|suffix| host == *suffix || host.ends_with(&format!(".{suffix}")))
}

fn url_allowed(provider: Provider, url: &reqwest::Url) -> bool {
    url.scheme() == "https" && url.port().is_none() && url.username().is_empty() && url.host_str().is_some_and(|host| host_allowed(provider, host))
}

pub(crate) fn parse_download_url(provider: Provider, url: &str) -> Result<reqwest::Url, String> {
    let parsed = reqwest::Url::parse(url).map_err(|_| format!("Invalid {} download URL.", provider.label()))?;
    if url_allowed(provider, &parsed) { Ok(parsed) } else { Err(format!("Mochi only downloads from the official {} CDN.", provider.label())) }
}

fn client_for(provider: Provider) -> Result<&'static reqwest::Client, String> {
    if provider == Provider::Modrinth { return crate::modrinth::client(); }
    static CURSEFORGE: http::SharedClient = http::SharedClient::new();
    static NEXUS: http::SharedClient = http::SharedClient::new();
    let cell = if provider == Provider::Curseforge { &CURSEFORGE } else { &NEXUS };
    cell.get(|| {
        // Redirects may only land on the same provider's hosts.
        let policy = reqwest::redirect::Policy::custom(move |attempt| {
            if attempt.previous().len() < 5 && url_allowed(provider, attempt.url()) { attempt.follow() } else { attempt.stop() }
        });
        http::builder()
            .user_agent("T1nkiePlayz/Mochi/0.1.0 (https://github.com/T1nkiePlayz/Mochi)")
            .redirect(policy)
            .connect_timeout(std::time::Duration::from_secs(20))
            .read_timeout(std::time::Duration::from_secs(45))
            .build()
    }, &format!("Unable to prepare {} downloads", provider.label()))
}

pub(crate) fn normalize_sha1(value: &str) -> Result<String, String> {
    let v = value.trim().to_ascii_lowercase();
    if v.len() == 40 && v.bytes().all(|b| b.is_ascii_hexdigit()) { Ok(v) } else { Err("Invalid SHA-1 checksum.".into()) }
}

fn check_sha1(actual: &str, expected: &str) -> Result<(), String> {
    if actual.eq_ignore_ascii_case(expected) { Ok(()) } else { Err("Downloaded file failed its SHA-1 check and was discarded.".into()) }
}

/// Removes the temp file when the download ends for any reason, including the task being aborted (cancel).
struct TempFile(PathBuf);

impl Drop for TempFile {
    fn drop(&mut self) { let _ = fs::remove_file(&self.0); }
}

/// Streams `url` into `destination` through a temp file, enforcing the size cap and the optional SHA-1.
/// Nothing is left at `destination` unless every check passed. Returns the SHA-1 of what was written.
pub(crate) async fn fetch_to_file(
    provider: Provider, url: reqwest::Url, destination: &Path, expected_sha1: Option<&str>, progress: impl Fn(u64, Option<u64>),
) -> Result<String, String> {
    let label = provider.label();
    let _guard = DestinationGuard::acquire(destination)?;
    let mut response = client_for(provider)?.get(url).send().await.map_err(|e| format!("{label} download failed: {e}"))?;
    if !response.status().is_success() { return Err(format!("{label} download failed ({}).", response.status())); }
    let total = response.content_length();
    if total.is_some_and(|length| length > MAX_DOWNLOAD_BYTES) { return Err(format!("{label} file exceeds Mochi's 250 MiB safety limit.")); }
    progress(0, total);

    let name = destination.file_name().and_then(|n| n.to_str()).unwrap_or("download");
    let temp = destination.with_file_name(format!("{name}{TEMP_MARKER}{}", NEXT_DOWNLOAD_ID.fetch_add(1, Ordering::Relaxed)));
    let _temp = TempFile(temp.clone());
    let result: Result<String, String> = async {
        // Chunks arrive in ~16 KiB pieces; buffering turns thousands of tiny writes into a few large ones.
        let mut file = std::io::BufWriter::with_capacity(256 * 1024, fs::File::create(&temp).map_err(|e| format!("Unable to create temporary download: {e}"))?);
        let mut hasher = Sha1::new();
        let mut downloaded = 0u64;
        while let Some(chunk) = response.chunk().await.map_err(|e| format!("Unable to read download: {e}"))? {
            downloaded = downloaded.saturating_add(chunk.len() as u64);
            if downloaded > MAX_DOWNLOAD_BYTES { return Err(format!("{label} file exceeds Mochi's 250 MiB safety limit.")); }
            hasher.update(&chunk);
            file.write_all(&chunk).map_err(|e| format!("Unable to write downloaded file: {e}"))?;
            progress(downloaded, total);
        }
        file.flush().map_err(|e| format!("Unable to finalize downloaded file: {e}"))?;
        // Make sure a power cut right after the rename cannot leave an empty "completed" file.
        file.get_ref().sync_all().map_err(|e| format!("Unable to finalize downloaded file: {e}"))?;
        drop(file);
        let actual = hex(&hasher.finalize());
        if let Some(expected) = expected_sha1 { check_sha1(&actual, expected)?; }
        fs::rename(&temp, destination).map_err(|e| format!("Unable to finalize downloaded file: {e}"))?;
        Ok(actual)
    }.await;
    result
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct ExtractLimits { max_entries: usize, max_total_bytes: u64, max_entry_bytes: u64, max_ratio: u64, ratio_min_bytes: u64 }

pub(crate) const EXTRACT_LIMITS: ExtractLimits = ExtractLimits {
    max_entries: 10_000, max_total_bytes: 1024 * 1024 * 1024, max_entry_bytes: 512 * 1024 * 1024, max_ratio: 200,
    // Tiny files (a few KiB of zeros or repeated JSON) legitimately compress >200x; only judge the ratio of big entries.
    ratio_min_bytes: 1024 * 1024,
};

/// Extracts `archive` into `dest`. Entries that would escape `dest` (zip-slip, also through symlinked folders that
/// already exist inside it), symlinks and other special files, duplicate or case-colliding names, and archives
/// beyond the entry/size/ratio caps are rejected. Sizes are enforced on bytes actually written, not on headers.
/// On failure the files this call created are removed again.
pub(crate) fn extract_zip(archive: &Path, dest: &Path, limits: ExtractLimits) -> Result<usize, String> {
    let mut created = Vec::new();
    let result = extract_zip_inner(archive, dest, limits, &mut created);
    if result.is_err() { for path in created.iter().rev() { let _ = fs::remove_file(path); } }
    result
}

fn extract_zip_inner(archive: &Path, dest: &Path, limits: ExtractLimits, created: &mut Vec<PathBuf>) -> Result<usize, String> {
    let file = fs::File::open(archive).map_err(|e| format!("Unable to open archive: {e}"))?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| format!("Not a valid zip archive: {e}"))?;
    if zip.len() > limits.max_entries { return Err("Archive has too many files.".into()); }
    fs::create_dir_all(dest).map_err(|e| format!("Unable to create extraction folder: {e}"))?;
    let canonical_dest = fs::canonicalize(dest).map_err(|e| format!("Unable to resolve extraction folder: {e}"))?;
    let mut total = 0u64;
    let mut written = 0usize;
    // Lower-cased so "A.txt" and "a.txt" collide here exactly as they would on a case-insensitive macOS volume.
    let mut seen: HashSet<String> = HashSet::new();
    for index in 0..zip.len() {
        let mut entry = zip.by_index(index).map_err(|e| format!("Unable to read archive entry: {e}"))?;
        let relative = entry.enclosed_name().ok_or_else(|| format!("Archive entry '{}' escapes the target folder.", entry.name().escape_debug()))?;
        if relative.components().any(|c| !matches!(c, Component::Normal(_))) || entry.name().chars().any(char::is_control) {
            return Err(format!("Archive entry '{}' is not allowed.", entry.name().escape_debug()));
        }
        if let Some(mode) = entry.unix_mode() {
            let kind = mode & 0o170000;
            if kind == 0o120000 { return Err(format!("Archive entry '{}' is a symlink.", entry.name())); }
            if kind != 0 && kind != 0o100000 && kind != 0o040000 { return Err(format!("Archive entry '{}' is a special file.", entry.name())); }
        }
        let target: PathBuf = dest.join(&relative);
        if entry.is_dir() {
            fs::create_dir_all(&target).map_err(|e| format!("Unable to create folder: {e}"))?;
            ensure_inside(&target, &canonical_dest)?;
            continue;
        }
        if !seen.insert(relative.to_string_lossy().to_lowercase()) { return Err(format!("Archive contains '{}' more than once.", entry.name())); }
        if entry.size() > limits.max_entry_bytes { return Err(format!("Archive entry '{}' is too large.", entry.name())); }
        if entry.size() > limits.ratio_min_bytes && entry.compressed_size() > 0 && entry.size() / entry.compressed_size() > limits.max_ratio { return Err("Archive looks like a zip bomb.".into()); }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("Unable to create folder: {e}"))?;
            // A folder that already exists in `dest` may be a symlink pointing elsewhere.
            ensure_inside(parent, &canonical_dest)?;
        }
        // Never write through a pre-existing symlink; replace a regular file, then create exclusively (O_EXCL does not follow links).
        match fs::symlink_metadata(&target) {
            Ok(meta) if meta.file_type().is_symlink() => return Err(format!("'{}' is a symlink.", relative.display())),
            Ok(meta) if meta.is_file() => fs::remove_file(&target).map_err(|e| format!("Unable to replace '{}': {e}", relative.display()))?,
            _ => {}
        }
        let mut out = fs::OpenOptions::new().write(true).create_new(true).open(&target).map_err(|e| format!("Unable to write '{}': {e}", relative.display()))?;
        created.push(target.clone());
        let allowed = limits.max_entry_bytes.min(limits.max_total_bytes.saturating_sub(total));
        let copied = std::io::copy(&mut (&mut entry).take(allowed + 1), &mut out).map_err(|e| format!("Unable to extract '{}': {e}", relative.display()))?;
        if copied > allowed { return Err("Archive expands beyond Mochi's size limit.".into()); }
        out.sync_all().map_err(|e| format!("Unable to extract '{}': {e}", relative.display()))?;
        total += copied;
        written += 1;
    }
    Ok(written)
}

fn ensure_inside(path: &Path, canonical_root: &Path) -> Result<(), String> {
    let resolved = fs::canonicalize(path).map_err(|e| format!("Unable to resolve extraction path: {e}"))?;
    if resolved.starts_with(canonical_root) { Ok(()) } else { Err("Archive entry resolves outside the target folder.".into()) }
}

/// Running download tasks, so one can be cancelled.
fn tasks() -> &'static Mutex<std::collections::HashMap<String, tauri::async_runtime::JoinHandle<()>>> {
    static TASKS: OnceLock<Mutex<std::collections::HashMap<String, tauri::async_runtime::JoinHandle<()>>>> = OnceLock::new();
    TASKS.get_or_init(Default::default)
}

fn announce(id: &str) { crate::modinstance::emit("mod-download-changed", id.to_string()); }

/// The folder a download lands in: the Tofu folder, or one of its content subfolders.
fn target_dir(root: &Path, subdir: Option<&str>) -> Result<PathBuf, String> {
    crate::modinstance::content_dir(root, subdir.map(str::trim).unwrap_or(""))
}

/// Validates the request and starts the download in the background. Returns the download id.
pub fn start(request: ModDownloadRequest) -> Result<String, String> {
    let provider = request.provider;
    let parsed = parse_download_url(provider, &request.url)?;
    let tofu_root = validate_path(&request.path)?;
    let root = target_dir(&tofu_root, request.subdir.as_deref())?;
    let subdir = request.subdir.as_deref().map(str::trim).unwrap_or("").to_string();
    let filename = validate_download_filename(&request.filename)?.to_string();
    let expected_sha1 = request.sha1.as_deref().filter(|v| !v.trim().is_empty()).map(normalize_sha1).transpose()?;
    let extract = request.extract.unwrap_or(false);
    if extract && !filename.to_ascii_lowercase().ends_with(".zip") { return Err("Only .zip archives can be extracted.".into()); }
    let keep_archive = request.keep_archive.unwrap_or(false);
    fs::create_dir_all(&root).map_err(|e| format!("Unable to create Tofu folder: {e}"))?;
    remove_stale_temp_files(&root);

    cleanup_downloads();
    if active_download_count() >= MAX_ACTIVE_DOWNLOADS { return Err("Too many downloads are running. Wait for one to finish.".into()); }
    let id = format!("download-{}-{}", now_ms(), NEXT_DOWNLOAD_ID.fetch_add(1, Ordering::Relaxed));
    let tofu_id = request.tofu_id.clone();
    let record = request.record;
    let entry = DownloadEntry {
        id: id.clone(), tofu_id: request.tofu_id, tofu_name: request.tofu_name, item_name: request.item_name, filename: filename.clone(),
        downloaded: 0, total: None, status: "downloading".into(), error: None, created_at: now_ms(), finished_at: None,
        provider: provider.id().into(), dir: root.to_string_lossy().into_owned(),
    };
    lock_downloads().insert(id.clone(), entry);
    announce(&id);

    let destination = root.join(&filename);
    let task_id = id.clone();
    let handle = tauri::async_runtime::spawn(async move {
        let progress_id = task_id.clone();
        let mut result = fetch_to_file(provider, parsed, &destination, expected_sha1.as_deref(), move |downloaded, total| {
            update_download(&progress_id, |entry| { entry.downloaded = downloaded; entry.total = total; })
        }).await;
        let mut sha1 = result.as_ref().ok().cloned();
        let mut extracted = false;
        if result.is_ok() && extract {
            extracted = true;
            let (archive, dest) = (destination.clone(), root.clone());
            result = tauri::async_runtime::spawn_blocking(move || {
                let outcome = extract_zip(&archive, &dest, EXTRACT_LIMITS).map(|_| String::new());
                if outcome.is_ok() && !keep_archive { let _ = fs::remove_file(&archive); }
                outcome
            }).await.map_err(|e| e.to_string()).and_then(|inner| inner);
        }
        // Extracted archives have no single file to track; everything else is remembered with its origin.
        if result.is_ok() && !extracted {
            if let Some(input) = record { crate::modinstance::record_install(&tofu_id, input.into_record(&filename, &subdir, sha1.take())); }
        }
        update_download(&task_id, |entry| {
            entry.finished_at = Some(now_ms());
            match result {
                Ok(_) => { entry.status = "completed".into(); entry.error = None; }
                Err(error) => { entry.status = "failed".into(); entry.error = Some(error); }
            }
        });
        tasks().lock_recover().remove(&task_id);
        announce(&task_id);
    });
    tasks().lock_recover().insert(id.clone(), handle);
    Ok(id)
}

/// Stops a running download and removes its partial file. Finished downloads are left alone.
pub fn cancel(id: &str) -> Result<(), String> {
    let running = lock_downloads().get(id).is_some_and(|entry| entry.status == "downloading");
    if !running { return Ok(()); }
    if let Some(handle) = tasks().lock_recover().remove(id) { handle.abort(); }
    update_download(id, |entry| { entry.status = "cancelled".into(); entry.error = None; entry.finished_at = Some(now_ms()); });
    announce(id);
    Ok(())
}

/// Drops finished entries from the list (files stay where they are).
pub fn clear_finished() {
    lock_downloads().retain(|_, entry| entry.finished_at.is_none());
    announce("");
}

#[tauri::command(async)]
pub fn start_mod_download(request: ModDownloadRequest) -> Result<String, String> { start(request) }

#[tauri::command]
pub fn cancel_mod_download(id: String) -> Result<(), String> { cancel(&id) }

#[tauri::command]
pub fn clear_finished_downloads() { clear_finished() }

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mochi-dl-{name}-{}-{}", std::process::id(), NEXT_DOWNLOAD_ID.fetch_add(1, Ordering::Relaxed)));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn build_zip(path: &Path, entries: &[(&str, &[u8])], symlink: Option<(&str, &str)>) {
        let mut writer = zip::ZipWriter::new(fs::File::create(path).unwrap());
        let options = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        for (name, data) in entries {
            writer.start_file(*name, options).unwrap();
            writer.write_all(data).unwrap();
        }
        if let Some((name, target)) = symlink { writer.add_symlink(name, target, options).unwrap(); }
        writer.finish().unwrap();
    }

    #[test]
    fn host_allow_lists_per_provider() {
        let ok = |p, u: &str| parse_download_url(p, u).is_ok();
        assert!(ok(Provider::Modrinth, "https://cdn.modrinth.com/data/a/b.jar"));
        assert!(!ok(Provider::Modrinth, "https://edge.forgecdn.net/files/1/2/a.jar"));
        assert!(!ok(Provider::Modrinth, "http://cdn.modrinth.com/a.jar"));
        assert!(ok(Provider::Curseforge, "https://edge.forgecdn.net/files/1/2/a.jar"));
        assert!(ok(Provider::Curseforge, "https://mediafilez.forgecdn.net/files/1/2/a.jar"));
        assert!(!ok(Provider::Curseforge, "https://forgecdn.net.evil.example/a.jar"));
        assert!(!ok(Provider::Curseforge, "https://evilforgecdn.net/a.jar"));
        assert!(!ok(Provider::Curseforge, "https://cdn.modrinth.com/a.jar"));
        assert!(ok(Provider::Nexus, "https://premium-files.nexus-cdn.com/a/b.zip?md5=x&expires=1"));
        assert!(ok(Provider::Nexus, "https://supporter-files.nexus-cdn.com/a.zip"));
        assert!(ok(Provider::Nexus, "https://cf-files.nexusmods.com/cdn/a.zip"));
        assert!(!ok(Provider::Nexus, "https://evilnexus-cdn.com/a.zip"));
        assert!(!ok(Provider::Nexus, "https://nexus-cdn.com.evil.example/a.zip"));
        assert!(!ok(Provider::Nexus, "https://www.nexusmods.com/a.zip"));
        assert!(!ok(Provider::Nexus, "https://user@premium-files.nexus-cdn.com/a.zip"));
        assert!(!ok(Provider::Nexus, "https://premium-files.nexus-cdn.com:8443/a.zip"));
    }

    #[test]
    fn filenames_are_validated() {
        assert!(validate_download_filename("pack-1.0.zip").is_ok());
        assert!(validate_download_filename("../pack.zip").is_err());
        assert!(validate_download_filename("a\\b.zip").is_err());
        assert!(validate_download_filename("setup.exe").is_err());
        assert!(validate_download_filename("").is_err());
    }

    #[test]
    fn sha1_values_are_checked() {
        let digest = hex(&Sha1::digest(b"hello"));
        assert!(check_sha1(&digest, &digest.to_ascii_uppercase()).is_ok());
        assert!(check_sha1(&digest, "0000000000000000000000000000000000000000").is_err());
        assert!(normalize_sha1("not-a-hash").is_err());
        assert_eq!(normalize_sha1(&format!(" {} ", digest.to_ascii_uppercase())).unwrap(), digest);
    }

    #[test]
    fn extracts_regular_archives() {
        let dir = temp_dir("ok");
        let zip_path = dir.join("pack.zip");
        build_zip(&zip_path, &[("mods/a.jar", b"AAA"), ("config/x.toml", b"x=1")], None);
        let out = dir.join("out");
        assert_eq!(extract_zip(&zip_path, &out, EXTRACT_LIMITS).unwrap(), 2);
        assert_eq!(fs::read(out.join("mods/a.jar")).unwrap(), b"AAA");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_zip_slip_and_symlinks() {
        let dir = temp_dir("slip");
        let out = dir.join("out");
        for name in ["../evil.txt", "a/../../evil.txt", "/abs/evil.txt"] {
            let zip_path = dir.join("bad.zip");
            build_zip(&zip_path, &[(name, b"x")], None);
            assert!(extract_zip(&zip_path, &out, EXTRACT_LIMITS).is_err(), "{name}");
        }
        assert!(!dir.join("evil.txt").exists());
        let link = dir.join("link.zip");
        build_zip(&link, &[("ok.txt", b"x")], Some(("l", "/etc/passwd")));
        assert!(extract_zip(&link, &out, EXTRACT_LIMITS).unwrap_err().contains("symlink"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn enforces_extraction_caps() {
        let dir = temp_dir("caps");
        let zip_path = dir.join("big.zip");
        build_zip(&zip_path, &[("a.txt", &[b'a'; 4096]), ("b.txt", b"b"), ("c.txt", b"c")], None);
        let out = dir.join("out");
        let entries = ExtractLimits { max_entries: 2, ..EXTRACT_LIMITS };
        assert!(extract_zip(&zip_path, &out, entries).unwrap_err().contains("too many"));
        let total = ExtractLimits { max_total_bytes: 1000, ..EXTRACT_LIMITS };
        assert!(extract_zip(&zip_path, &out, total).is_err());
        let entry = ExtractLimits { max_entry_bytes: 1000, ..EXTRACT_LIMITS };
        assert!(extract_zip(&zip_path, &out, entry).is_err());
        let ratio = ExtractLimits { max_ratio: 2, ratio_min_bytes: 0, ..EXTRACT_LIMITS };
        assert!(extract_zip(&zip_path, &out, ratio).unwrap_err().contains("zip bomb"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn small_highly_compressible_entries_are_not_zip_bombs() {
        let dir = temp_dir("small");
        let zip_path = dir.join("pack.zip");
        build_zip(&zip_path, &[("zeros.bin", &[0u8; 100_000])], None);
        assert_eq!(extract_zip(&zip_path, &dir.join("out"), EXTRACT_LIMITS).unwrap(), 1);
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn does_not_write_through_symlinked_folders() {
        let dir = temp_dir("symdir");
        let (out, outside) = (dir.join("out"), dir.join("outside"));
        fs::create_dir_all(&out).unwrap();
        fs::create_dir_all(&outside).unwrap();
        std::os::unix::fs::symlink(&outside, out.join("config")).unwrap();
        let zip_path = dir.join("pack.zip");
        build_zip(&zip_path, &[("config/evil.txt", b"x")], None);
        assert!(extract_zip(&zip_path, &out, EXTRACT_LIMITS).is_err());
        assert!(!outside.join("evil.txt").exists());
        // A pre-existing symlinked file is refused too.
        std::os::unix::fs::symlink(outside.join("victim"), out.join("file.txt")).unwrap();
        build_zip(&zip_path, &[("file.txt", b"x")], None);
        assert!(extract_zip(&zip_path, &out, EXTRACT_LIMITS).is_err());
        assert!(!outside.join("victim").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_duplicate_and_case_colliding_names_and_cleans_up() {
        let dir = temp_dir("dup");
        let zip_path = dir.join("pack.zip");
        let out = dir.join("out");
        build_zip(&zip_path, &[("a/Readme.txt", b"1"), ("a/readme.TXT", b"2")], None);
        assert!(extract_zip(&zip_path, &out, EXTRACT_LIMITS).unwrap_err().contains("more than once"));
        // Files written before the failure are removed again.
        assert!(!out.join("a/Readme.txt").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_control_characters_in_entry_names() {
        let dir = temp_dir("ctl");
        let zip_path = dir.join("pack.zip");
        build_zip(&zip_path, &[("a\nb.txt", b"1")], None);
        assert!(extract_zip(&zip_path, &dir.join("out"), EXTRACT_LIMITS).is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn existing_files_are_replaced_not_appended() {
        let dir = temp_dir("replace");
        let out = dir.join("out");
        fs::create_dir_all(&out).unwrap();
        fs::write(out.join("a.txt"), b"old old old old").unwrap();
        let zip_path = dir.join("pack.zip");
        build_zip(&zip_path, &[("a.txt", b"new")], None);
        extract_zip(&zip_path, &out, EXTRACT_LIMITS).unwrap();
        assert_eq!(fs::read(out.join("a.txt")).unwrap(), b"new");
        let _ = fs::remove_dir_all(&dir);
    }

    /// Property-style: random entry names never produce a file outside the destination.
    #[test]
    fn random_entry_names_never_escape() {
        let dir = temp_dir("fuzz");
        let mut state = 0x2545_f491_4f6c_dd1du64;
        let mut next = move || { state ^= state << 13; state ^= state >> 7; state ^= state << 17; state };
        let pieces = ["..", ".", "a", "B", "/", "/", "\\", "%2e", "\0", " ", "~", "C:", "x.txt"];
        for round in 0..150 {
            let name: String = (0..(next() % 8 + 1)).map(|_| pieces[(next() % pieces.len() as u64) as usize]).collect();
            let sandbox = dir.join(format!("s{round}"));
            let out = sandbox.join("out");
            let zip_path = dir.join(format!("z{round}.zip"));
            let mut writer = zip::ZipWriter::new(fs::File::create(&zip_path).unwrap());
            if writer.start_file(name.as_str(), zip::write::SimpleFileOptions::default()).is_err() { continue; }
            writer.write_all(b"x").unwrap();
            writer.finish().unwrap();
            let _ = extract_zip(&zip_path, &out, EXTRACT_LIMITS);
            // Nothing may exist in the sandbox besides `out` itself.
            let stray: Vec<_> = fs::read_dir(&sandbox).map(|rd| rd.flatten().map(|e| e.file_name()).filter(|n| n != "out").collect()).unwrap_or_default();
            assert!(stray.is_empty(), "{name:?} wrote {stray:?}");
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn same_destination_cannot_download_twice() {
        let path = PathBuf::from("/tmp/mochi-guard-test/a.jar");
        let first = DestinationGuard::acquire(&path).unwrap();
        assert!(DestinationGuard::acquire(&path).is_err());
        drop(first);
        assert!(DestinationGuard::acquire(&path).is_ok());
    }

    #[test]
    fn stale_temp_files_are_only_removed_when_old() {
        let dir = temp_dir("stale");
        let fresh = dir.join(format!("a.jar{TEMP_MARKER}1"));
        fs::write(&fresh, b"x").unwrap();
        fs::write(dir.join("keep.jar"), b"x").unwrap();
        remove_stale_temp_files(&dir);
        assert!(fresh.exists() && dir.join("keep.jar").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn other_games_content_types_are_accepted() {
        for name in ["Cool.tmod", "Machine.smod", "plugin.dll", "Patch.esp", "pack.7z"] { assert!(validate_download_filename(name).is_ok(), "{name}"); }
        for name in ["run.sh", "setup.exe", "x.app", "a.jar.disabled"] { assert!(validate_download_filename(name).is_err(), "{name}"); }
    }

    #[test]
    fn subfolders_are_limited_to_known_content_folders() {
        let root = Path::new("/tmp/tofu");
        assert_eq!(target_dir(root, None).unwrap(), root);
        assert_eq!(target_dir(root, Some("resourcepacks")).unwrap(), root.join("resourcepacks"));
        assert!(target_dir(root, Some("../x")).is_err());
        assert!(target_dir(root, Some("mods/evil")).is_err());
    }

    #[test]
    fn cancel_marks_only_running_downloads_and_clear_keeps_them() {
        let entry = |id: &str, status: &str, finished: Option<u64>| DownloadEntry {
            id: id.into(), tofu_id: "t".into(), tofu_name: "T".into(), item_name: "I".into(), filename: "a.jar".into(), downloaded: 0, total: None,
            status: status.into(), error: None, created_at: 1, finished_at: finished, provider: "modrinth".into(), dir: "/tmp".into(),
        };
        lock_downloads().insert("test-run".into(), entry("test-run", "downloading", None));
        lock_downloads().insert("test-done".into(), entry("test-done", "completed", Some(now_ms())));
        cancel("test-run").unwrap();
        cancel("test-done").unwrap();
        assert_eq!(lock_downloads().get("test-run").unwrap().status, "cancelled");
        assert_eq!(lock_downloads().get("test-done").unwrap().status, "completed");
        lock_downloads().insert("test-run2".into(), entry("test-run2", "downloading", None));
        clear_finished();
        assert!(lock_downloads().get("test-run").is_none() && lock_downloads().get("test-done").is_none());
        assert!(lock_downloads().get("test-run2").is_some());
        lock_downloads().remove("test-run2");
    }
}
