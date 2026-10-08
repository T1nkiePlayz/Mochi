//! Provider-aware mod downloader: host allow-lists, size cap, SHA-1 verification and safe zip extraction.
use crate::modrinth::{
    cleanup_downloads, downloads, now_ms, update_download, validate_download_filename, validate_path, DownloadEntry,
    MAX_DOWNLOAD_BYTES, NEXT_DOWNLOAD_ID,
};
use serde::Deserialize;
use sha1::{Digest, Sha1};
use std::{
    fs,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    sync::{atomic::Ordering, OnceLock},
};

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
}

impl Provider {
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
    static CURSEFORGE: OnceLock<Result<reqwest::Client, String>> = OnceLock::new();
    static NEXUS: OnceLock<Result<reqwest::Client, String>> = OnceLock::new();
    let cell = if provider == Provider::Curseforge { &CURSEFORGE } else { &NEXUS };
    cell.get_or_init(|| {
        // Redirects may only land on the same provider's hosts.
        let policy = reqwest::redirect::Policy::custom(move |attempt| {
            if attempt.previous().len() < 5 && url_allowed(provider, attempt.url()) { attempt.follow() } else { attempt.stop() }
        });
        reqwest::Client::builder()
            .user_agent("T1nkiePlayz/Mochi/0.1.0 (https://github.com/T1nkiePlayz/Mochi)")
            .redirect(policy)
            .connect_timeout(std::time::Duration::from_secs(20))
            .build()
            .map_err(|e| format!("Unable to prepare {} downloads: {e}", provider.label()))
    }).as_ref().map_err(Clone::clone)
}

fn normalize_sha1(value: &str) -> Result<String, String> {
    let v = value.trim().to_ascii_lowercase();
    if v.len() == 40 && v.bytes().all(|b| b.is_ascii_hexdigit()) { Ok(v) } else { Err("Invalid SHA-1 checksum.".into()) }
}

fn check_sha1(actual: &str, expected: &str) -> Result<(), String> {
    if actual.eq_ignore_ascii_case(expected) { Ok(()) } else { Err("Downloaded file failed its SHA-1 check and was discarded.".into()) }
}

/// Streams `url` into `destination` through a temp file, enforcing the size cap and the optional SHA-1.
/// Nothing is left at `destination` unless every check passed.
pub(crate) async fn fetch_to_file(
    provider: Provider, url: reqwest::Url, destination: &Path, expected_sha1: Option<&str>, progress: impl Fn(u64, Option<u64>),
) -> Result<(), String> {
    let label = provider.label();
    let mut response = client_for(provider)?.get(url).send().await.map_err(|e| format!("{label} download failed: {e}"))?;
    if !response.status().is_success() { return Err(format!("{label} download failed ({}).", response.status())); }
    let total = response.content_length();
    if total.is_some_and(|length| length > MAX_DOWNLOAD_BYTES) { return Err(format!("{label} file exceeds Mochi's 250 MiB safety limit.")); }
    progress(0, total);

    let name = destination.file_name().and_then(|n| n.to_str()).unwrap_or("download");
    let temp = destination.with_file_name(format!("{name}.mochi-download-{}", NEXT_DOWNLOAD_ID.fetch_add(1, Ordering::Relaxed)));
    let result: Result<(), String> = async {
        let mut file = fs::File::create(&temp).map_err(|e| format!("Unable to create temporary download: {e}"))?;
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
        if let Some(expected) = expected_sha1 {
            let actual: String = hasher.finalize().iter().map(|byte| format!("{byte:02x}")).collect();
            check_sha1(&actual, expected)?;
        }
        fs::rename(&temp, destination).map_err(|e| format!("Unable to finalize downloaded file: {e}"))
    }.await;
    if result.is_err() { let _ = fs::remove_file(&temp); }
    result
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct ExtractLimits { max_entries: usize, max_total_bytes: u64, max_entry_bytes: u64, max_ratio: u64 }

pub(crate) const EXTRACT_LIMITS: ExtractLimits = ExtractLimits {
    max_entries: 10_000, max_total_bytes: 1024 * 1024 * 1024, max_entry_bytes: 512 * 1024 * 1024, max_ratio: 200,
};

/// Extracts `archive` into `dest`. Entries that would escape `dest` (zip-slip), symlinks, and archives
/// beyond the entry/size/ratio caps are rejected. Sizes are enforced on bytes actually written, not on headers.
pub(crate) fn extract_zip(archive: &Path, dest: &Path, limits: ExtractLimits) -> Result<usize, String> {
    let file = fs::File::open(archive).map_err(|e| format!("Unable to open archive: {e}"))?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| format!("Not a valid zip archive: {e}"))?;
    if zip.len() > limits.max_entries { return Err("Archive has too many files.".into()); }
    fs::create_dir_all(dest).map_err(|e| format!("Unable to create extraction folder: {e}"))?;
    let mut total = 0u64;
    let mut written = 0usize;
    for index in 0..zip.len() {
        let mut entry = zip.by_index(index).map_err(|e| format!("Unable to read archive entry: {e}"))?;
        let relative = entry.enclosed_name().ok_or_else(|| format!("Archive entry '{}' escapes the target folder.", entry.name()))?;
        if relative.components().any(|c| !matches!(c, Component::Normal(_))) { return Err(format!("Archive entry '{}' is not allowed.", entry.name())); }
        if entry.unix_mode().is_some_and(|mode| mode & 0o170000 == 0o120000) { return Err(format!("Archive entry '{}' is a symlink.", entry.name())); }
        let target: PathBuf = dest.join(&relative);
        if entry.is_dir() { fs::create_dir_all(&target).map_err(|e| format!("Unable to create folder: {e}"))?; continue; }
        if entry.size() > limits.max_entry_bytes { return Err(format!("Archive entry '{}' is too large.", entry.name())); }
        if entry.compressed_size() > 0 && entry.size() / entry.compressed_size() > limits.max_ratio { return Err("Archive looks like a zip bomb.".into()); }
        if let Some(parent) = target.parent() { fs::create_dir_all(parent).map_err(|e| format!("Unable to create folder: {e}"))?; }
        // Never write through a pre-existing symlink.
        if fs::symlink_metadata(&target).is_ok_and(|m| m.file_type().is_symlink()) { return Err(format!("'{}' is a symlink.", relative.display())); }
        let mut out = fs::File::create(&target).map_err(|e| format!("Unable to write '{}': {e}", relative.display()))?;
        let allowed = limits.max_entry_bytes.min(limits.max_total_bytes.saturating_sub(total));
        let copied = std::io::copy(&mut (&mut entry).take(allowed + 1), &mut out).map_err(|e| format!("Unable to extract '{}': {e}", relative.display()))?;
        if copied > allowed { return Err("Archive expands beyond Mochi's size limit.".into()); }
        total += copied;
        written += 1;
    }
    Ok(written)
}

/// Validates the request and starts the download in the background. Returns the download id.
pub fn start(request: ModDownloadRequest) -> Result<String, String> {
    let provider = request.provider;
    let parsed = parse_download_url(provider, &request.url)?;
    let root = validate_path(&request.path)?;
    let filename = validate_download_filename(&request.filename)?.to_string();
    let expected_sha1 = request.sha1.as_deref().filter(|v| !v.trim().is_empty()).map(normalize_sha1).transpose()?;
    let extract = request.extract.unwrap_or(false);
    if extract && !filename.to_ascii_lowercase().ends_with(".zip") { return Err("Only .zip archives can be extracted.".into()); }
    let keep_archive = request.keep_archive.unwrap_or(false);
    fs::create_dir_all(&root).map_err(|e| format!("Unable to create Tofu folder: {e}"))?;

    cleanup_downloads();
    let id = format!("download-{}-{}", now_ms(), NEXT_DOWNLOAD_ID.fetch_add(1, Ordering::Relaxed));
    let entry = DownloadEntry {
        id: id.clone(), tofu_id: request.tofu_id, tofu_name: request.tofu_name, item_name: request.item_name, filename: filename.clone(),
        downloaded: 0, total: None, status: "downloading".into(), error: None, created_at: now_ms(), finished_at: None,
    };
    downloads().lock().map_err(|_| "Download state is unavailable.".to_string())?.insert(id.clone(), entry);

    let destination = root.join(&filename);
    let task_id = id.clone();
    tauri::async_runtime::spawn(async move {
        let progress_id = task_id.clone();
        let mut result = fetch_to_file(provider, parsed, &destination, expected_sha1.as_deref(), move |downloaded, total| {
            update_download(&progress_id, |entry| { entry.downloaded = downloaded; entry.total = total; })
        }).await;
        if result.is_ok() && extract {
            let (archive, dest) = (destination.clone(), root.clone());
            result = tauri::async_runtime::spawn_blocking(move || {
                let outcome = extract_zip(&archive, &dest, EXTRACT_LIMITS).map(|_| ());
                if outcome.is_ok() && !keep_archive { let _ = fs::remove_file(&archive); }
                outcome
            }).await.map_err(|e| e.to_string()).and_then(|inner| inner);
        }
        update_download(&task_id, |entry| {
            entry.finished_at = Some(now_ms());
            match result {
                Ok(()) => { entry.status = "completed".into(); entry.error = None; }
                Err(error) => { entry.status = "failed".into(); entry.error = Some(error); }
            }
        });
    });
    Ok(id)
}

#[tauri::command]
pub fn start_mod_download(request: ModDownloadRequest) -> Result<String, String> { start(request) }

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
        let digest: String = Sha1::digest(b"hello").iter().map(|b| format!("{b:02x}")).collect();
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
        let ratio = ExtractLimits { max_ratio: 2, ..EXTRACT_LIMITS };
        assert!(extract_zip(&zip_path, &out, ratio).unwrap_err().contains("zip bomb"));
        let _ = fs::remove_dir_all(&dir);
    }
}
