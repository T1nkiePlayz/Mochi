//! Installs Proton-GE and Wine-GE from GloriousEggroll's GitHub releases (Linux).
//!
//! Releases come from the GitHub API, the archive is verified against the published SHA-512 before it is
//! unpacked, and unpacking happens in a temporary folder beside the final location, then one rename.
//! Proton-GE goes to Steam's `compatibilitytools.d`; Wine-GE goes to `<Mochi data>/runtimes/wine`.

use crate::util::http;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha512};
use std::{
    fs,
    io::{BufReader, BufWriter, Read, Write},
    path::{Component, Path, PathBuf},
    sync::atomic::{AtomicBool, AtomicU64, Ordering},
};

const MAX_ARCHIVE_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_UNPACKED_BYTES: u64 = 8 * 1024 * 1024 * 1024;
const MAX_ENTRIES: usize = 200_000;
const MAX_API_BYTES: usize = 8 * 1024 * 1024;
const MAX_SUM_BYTES: usize = 64 * 1024;
const PROGRESS_EVENT: &str = "runtime-install-progress";
const HOSTS: [&str; 4] = ["api.github.com", "github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind { Proton, Wine }

impl Kind {
    fn parse(value: &str) -> Result<Kind, String> {
        match value { "proton" => Ok(Kind::Proton), "wine" => Ok(Kind::Wine), _ => Err("Unknown runtime kind.".into()) }
    }

    fn repo(self) -> &'static str {
        match self { Kind::Proton => "GloriousEggroll/proton-ge-custom", Kind::Wine => "GloriousEggroll/wine-ge-custom" }
    }
}

#[derive(Debug, Deserialize, Clone)]
struct GhAsset { name: String, size: u64, browser_download_url: String }

#[derive(Debug, Deserialize, Clone)]
struct GhRelease {
    tag_name: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    published_at: Option<String>,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    prerelease: bool,
    #[serde(default)]
    assets: Vec<GhAsset>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseInfo { tag: String, name: String, published_at: Option<String>, size: u64, installed: bool }

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InstalledRuntime { name: String, path: String }

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InstalledRuntimes { root: Option<String>, runtimes: Vec<InstalledRuntime> }

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Progress { kind: String, tag: String, phase: &'static str, downloaded: u64, total: Option<u64> }

// ---------------------------------------------------------------------------
// Pure helpers (tested)
// ---------------------------------------------------------------------------

fn host_allowed(host: &str) -> bool { HOSTS.contains(&host.to_ascii_lowercase().as_str()) }

fn url_allowed(url: &reqwest::Url) -> bool {
    url.scheme() == "https" && url.port().is_none() && url.username().is_empty() && url.host_str().is_some_and(host_allowed)
}

fn archive_stem(name: &str) -> Option<&str> { name.strip_suffix(".tar.gz").or_else(|| name.strip_suffix(".tar.xz")) }

/// The archive (preferring .tar.gz) and its .sha512sum among a release's assets.
fn select_assets(assets: &[GhAsset]) -> Option<(&GhAsset, &GhAsset)> {
    let archive = assets.iter().find(|a| a.name.ends_with(".tar.gz")).or_else(|| assets.iter().find(|a| a.name.ends_with(".tar.xz")))?;
    let stem = archive_stem(&archive.name)?;
    let sums: Vec<&GhAsset> = assets.iter().filter(|a| a.name.ends_with(".sha512sum")).collect();
    let sum = sums.iter().find(|a| a.name == format!("{}.sha512sum", archive.name) || a.name == format!("{stem}.sha512sum")).or_else(|| sums.first())?;
    Some((archive, sum))
}

/// The hex digest for `file_name` from a `sha512sum` file (`<hash>  <name>` or `<hash> *<name>`).
/// A file with a single line and no matching name is accepted, since some releases rename the archive.
fn parse_sha512(text: &str, file_name: &str) -> Result<String, String> {
    let mut entries = Vec::new();
    for line in text.lines().map(str::trim).filter(|l| !l.is_empty()) {
        let (hash, name) = line.split_once(char::is_whitespace).unwrap_or((line, ""));
        if hash.len() != 128 || !hash.bytes().all(|b| b.is_ascii_hexdigit()) { return Err("The release's checksum file is not a valid SHA-512 list.".into()); }
        entries.push((hash.to_ascii_lowercase(), name.trim().trim_start_matches('*')));
    }
    if let Some((hash, _)) = entries.iter().find(|(_, name)| *name == file_name) { return Ok(hash.clone()); }
    if entries.len() == 1 { return Ok(entries.remove(0).0); }
    Err("The release's checksum file does not list the archive.".into())
}

fn managed_name_ok(name: &str) -> bool {
    !name.is_empty() && name.len() <= 200 && !name.starts_with('.') && name != ".." && !name.contains(['/', '\\', '\0'])
}

/// Where `kind` installs: Steam's custom compatibility tools folder, or Mochi's own wine folder.
fn install_root(kind: Kind, steam_root: Option<&Path>, data_dir: Option<&Path>) -> Result<PathBuf, String> {
    match kind {
        Kind::Proton => steam_root.map(|root| root.join("compatibilitytools.d")).ok_or_else(|| "Proton-GE installs into Steam. Install and start Steam once, then try again.".to_owned()),
        Kind::Wine => data_dir.map(wine_root_in).ok_or_else(|| "Mochi's data folder is not ready yet.".to_owned()),
    }
}

fn wine_root_in(data_dir: &Path) -> PathBuf { data_dir.join("runtimes").join("wine") }

/// Mochi's own Wine-GE folder, listed by runtime detection.
pub fn wine_root() -> Option<PathBuf> { crate::modinstance::data_dir().map(|dir| wine_root_in(&dir)) }

fn is_runtime_dir(kind: Kind, dir: &Path) -> bool {
    match kind { Kind::Proton => dir.join("proton").is_file(), Kind::Wine => dir.join("bin/wine").is_file() }
}

fn installed_in(kind: Kind, root: &Path) -> Vec<InstalledRuntime> {
    let Ok(entries) = fs::read_dir(root) else { return Vec::new() };
    let mut found: Vec<InstalledRuntime> = entries.flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()) && is_runtime_dir(kind, &e.path()))
        .map(|e| InstalledRuntime { name: e.file_name().to_string_lossy().into_owned(), path: e.path().to_string_lossy().into_owned() })
        .filter(|r| managed_name_ok(&r.name))
        .collect();
    found.sort_by(|a, b| b.name.cmp(&a.name));
    found
}

/// A release counts as installed when a runtime folder is named exactly after its tag (Wine-GE folders add a `lutris-` prefix and an arch suffix).
fn is_installed(tag: &str, installed: &[InstalledRuntime]) -> bool {
    installed.iter().any(|r| {
        let bare = r.name.strip_prefix("lutris-").unwrap_or(&r.name);
        let bare = bare.strip_suffix("-x86_64").unwrap_or(bare);
        r.name == tag || bare == tag
    })
}

/// Deletes `name` under the managed root of `kind`; refuses anything that is not a plain folder directly inside it.
fn remove_in(root: &Path, name: &str) -> Result<(), String> {
    if !managed_name_ok(name) { return Err("That is not a runtime Mochi installed.".into()); }
    let target = root.join(name);
    let meta = fs::symlink_metadata(&target).map_err(|_| "That runtime is not installed.".to_owned())?;
    if !meta.is_dir() { return Err("That is not a runtime folder.".into()); }
    let canonical_root = fs::canonicalize(root).map_err(|e| format!("Unable to resolve the runtime folder: {e}"))?;
    let canonical = fs::canonicalize(&target).map_err(|e| format!("Unable to resolve the runtime: {e}"))?;
    if canonical.parent() != Some(canonical_root.as_path()) { return Err("That runtime is outside Mochi's managed folders.".into()); }
    fs::remove_dir_all(&target).map_err(|e| format!("Unable to remove the runtime: {e}"))
}

/// A path from an archive entry, relative and free of `..`; None means reject.
fn safe_relative(path: &Path) -> Option<PathBuf> {
    let mut clean = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => clean.push(part),
            Component::CurDir => {}
            _ => return None,
        }
    }
    (!clean.as_os_str().is_empty()).then_some(clean)
}

/// Resolves `target` lexically against the folder holding the link; None if it is absolute or leaves the archive root.
fn link_stays_inside(entry: &Path, target: &Path) -> Option<PathBuf> {
    if target.is_absolute() { return None; }
    let mut resolved: Vec<std::ffi::OsString> = entry.parent().map(|p| p.components().map(|c| c.as_os_str().to_owned()).collect()).unwrap_or_default();
    for component in target.components() {
        match component {
            Component::Normal(part) => resolved.push(part.to_owned()),
            Component::CurDir => {}
            Component::ParentDir => { resolved.pop()?; }
            _ => return None,
        }
    }
    Some(resolved.iter().collect())
}

struct LimitedWriter<W: Write> { inner: W, written: u64, max: u64 }

impl<W: Write> Write for LimitedWriter<W> {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.written += buf.len() as u64;
        if self.written > self.max { return Err(std::io::Error::other("unpacked size limit exceeded")); }
        self.inner.write(buf)
    }
    fn flush(&mut self) -> std::io::Result<()> { self.inner.flush() }
}

/// Unpacks a tar stream into `dest`, refusing absolute paths, `..`, special files and links that leave `dest`.
fn extract_tar<R: Read>(reader: R, dest: &Path) -> Result<(), String> {
    fs::create_dir_all(dest).map_err(|e| format!("Unable to create the install folder: {e}"))?;
    let canonical_dest = fs::canonicalize(dest).map_err(|e| format!("Unable to resolve the install folder: {e}"))?;
    let mut archive = tar::Archive::new(reader);
    let (mut count, mut total) = (0usize, 0u64);
    for entry in archive.entries().map_err(|e| format!("The archive is damaged: {e}"))? {
        let mut entry = entry.map_err(|e| format!("The archive is damaged: {e}"))?;
        count += 1;
        total = total.saturating_add(entry.size());
        if count > MAX_ENTRIES || total > MAX_UNPACKED_BYTES { return Err("The archive is larger than Mochi allows.".into()); }
        let raw = entry.path().map_err(|e| format!("The archive has an unreadable path: {e}"))?.into_owned();
        let relative = match safe_relative(&raw) {
            Some(relative) => relative,
            None if raw.as_os_str().is_empty() || raw == Path::new(".") || raw == Path::new("./") => continue,
            None => return Err(format!("The archive contains an unsafe path ({}).", raw.display())),
        };
        let kind = entry.header().entry_type();
        let target = dest.join(&relative);
        let parent = target.parent().unwrap_or(dest);
        fs::create_dir_all(parent).map_err(|e| format!("Unable to create a folder: {e}"))?;
        // A symlinked folder created earlier in the archive must not redirect later entries out of `dest`.
        let real_parent = fs::canonicalize(parent).map_err(|e| format!("Unable to resolve a folder: {e}"))?;
        if !real_parent.starts_with(&canonical_dest) { return Err("The archive tries to write outside the install folder.".into()); }
        if fs::symlink_metadata(&target).is_ok_and(|m| m.file_type().is_symlink()) { return Err("The archive tries to write through a link.".into()); }
        if kind.is_dir() {
            match fs::create_dir(&target) { Ok(()) => {} Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {} Err(e) => return Err(format!("Unable to create a folder: {e}")) }
            if let Ok(mode) = entry.header().mode() {
                use std::os::unix::fs::PermissionsExt;
                let _ = fs::set_permissions(&target, fs::Permissions::from_mode(mode & 0o777 | 0o700));
            }
        } else if kind.is_file() {
            entry.unpack(&target).map_err(|e| format!("Unable to unpack {}: {e}", relative.display()))?;
        } else if kind.is_symlink() {
            let link = entry.link_name().map_err(|e| format!("The archive has a bad link: {e}"))?.ok_or("The archive has a link without a target.")?.into_owned();
            if link_stays_inside(&relative, &link).is_none() { return Err(format!("The archive contains a link that leaves the install folder ({}).", relative.display())); }
            std::os::unix::fs::symlink(&link, &target).map_err(|e| format!("Unable to create a link: {e}"))?;
        } else if kind.is_hard_link() {
            let link = entry.link_name().map_err(|e| format!("The archive has a bad link: {e}"))?.ok_or("The archive has a link without a target.")?.into_owned();
            let inside = safe_relative(&link).filter(|_| !link.is_absolute()).ok_or_else(|| format!("The archive contains a link that leaves the install folder ({}).", relative.display()))?;
            let source = fs::canonicalize(dest.join(inside)).map_err(|_| "The archive contains a link to a missing file.".to_owned())?;
            if !source.starts_with(&canonical_dest) { return Err("The archive contains a link that leaves the install folder.".into()); }
            fs::hard_link(&source, &target).map_err(|e| format!("Unable to create a link: {e}"))?;
        } else if matches!(kind, tar::EntryType::XGlobalHeader | tar::EntryType::XHeader | tar::EntryType::GNULongName | tar::EntryType::GNULongLink) {
            continue;
        } else {
            return Err(format!("The archive contains an unsupported entry ({}).", relative.display()));
        }
    }
    // Per-entry checks are lexical; this resolves chained links against the real filesystem.
    verify_links(dest)
}

/// Resolves `path` against the real filesystem; a dangling tail is resolved lexically on top of its canonical parent.
fn resolve_real(path: &Path) -> Option<PathBuf> {
    if let Ok(real) = fs::canonicalize(path) { return Some(real); }
    let parent = fs::canonicalize(path.parent()?).ok()?;
    let name = path.file_name()?;
    // `..` as a final component cannot be dangling; a plain name that does not exist is fine.
    if name == ".." || name == "." { return None; }
    Some(parent.join(name))
}

/// Walks the unpacked tree and fails if any symlink, followed on disk (chains included), leaves `root`.
fn verify_links(root: &Path) -> Result<(), String> {
    let canonical_root = fs::canonicalize(root).map_err(|e| format!("Unable to resolve the install folder: {e}"))?;
    let mut pending = vec![root.to_path_buf()];
    while let Some(dir) = pending.pop() {
        for entry in fs::read_dir(&dir).map_err(|e| format!("Unable to read the unpacked runtime: {e}"))?.flatten() {
            let path = entry.path();
            let file_type = entry.file_type().map_err(|e| format!("Unable to read the unpacked runtime: {e}"))?;
            if file_type.is_symlink() {
                let target = fs::read_link(&path).map_err(|e| format!("Unable to read a link: {e}"))?;
                let joined = path.parent().unwrap_or(root).join(&target);
                let ok = match fs::canonicalize(&joined) {
                    Ok(real) => real.starts_with(&canonical_root),
                    Err(_) => {
                        // Dangling: canonicalize the parent of the link target and resolve the remainder lexically.
                        let mut base = fs::canonicalize(path.parent().unwrap_or(root)).ok();
                        for component in target.components() {
                            let Some(current) = base.take() else { break };
                            base = match component {
                                Component::Normal(part) => { let next = current.join(part); Some(resolve_real(&next).unwrap_or(next)) }
                                Component::ParentDir => current.parent().map(Path::to_path_buf),
                                Component::CurDir => Some(current),
                                _ => None,
                            };
                        }
                        base.is_some_and(|real| real.starts_with(&canonical_root))
                    }
                };
                if !ok { return Err(format!("The archive contains a link that leaves the install folder ({}).", path.strip_prefix(root).unwrap_or(&path).display())); }
            } else if file_type.is_dir() {
                pending.push(path);
            }
        }
    }
    Ok(())
}

/// Opens `archive` (gzip or xz) and unpacks it into `stage`.
fn extract_archive(archive: &Path, stage: &Path, scratch: &Path) -> Result<(), String> {
    let name = archive.file_name().and_then(|n| n.to_str()).unwrap_or("");
    let file = fs::File::open(archive).map_err(|e| format!("Unable to open the download: {e}"))?;
    if name.ends_with(".tar.gz") {
        extract_tar(BufReader::new(flate2::read::GzDecoder::new(file)), stage)
    } else if name.ends_with(".tar.xz") {
        // lzma-rs decodes whole streams, so inflate to a scratch tar first.
        let tar_path = scratch.join("runtime.tar");
        {
            let out = fs::File::create(&tar_path).map_err(|e| format!("Unable to create a temporary file: {e}"))?;
            let mut writer = LimitedWriter { inner: BufWriter::new(out), written: 0, max: MAX_UNPACKED_BYTES };
            lzma_rs::xz_decompress(&mut BufReader::new(file), &mut writer).map_err(|e| format!("Unable to decompress the archive: {e}"))?;
            writer.flush().map_err(|e| format!("Unable to write a temporary file: {e}"))?;
        }
        let tar_file = fs::File::open(&tar_path).map_err(|e| format!("Unable to open a temporary file: {e}"))?;
        extract_tar(BufReader::new(tar_file), stage)
    } else {
        Err("Unsupported archive type.".into())
    }
}

/// Moves the single top-level folder of the unpacked archive into `root`, returning its name.
fn promote(stage: &Path, root: &Path) -> Result<String, String> {
    let mut dirs = fs::read_dir(stage).map_err(|e| format!("Unable to read the unpacked runtime: {e}"))?.flatten().collect::<Vec<_>>();
    if dirs.len() != 1 || !dirs[0].file_type().is_ok_and(|t| t.is_dir()) { return Err("The archive does not contain a single runtime folder.".into()); }
    let entry = dirs.remove(0);
    let name = entry.file_name().to_string_lossy().into_owned();
    if !managed_name_ok(&name) { return Err("The archive's runtime folder has an unsafe name.".into()); }
    let destination = root.join(&name);
    if fs::symlink_metadata(&destination).is_ok() { return Err(format!("{name} is already installed.")); }
    fs::rename(entry.path(), &destination).map_err(|e| format!("Unable to move the runtime into place: {e}"))?;
    Ok(name)
}

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

fn client() -> Result<&'static reqwest::Client, String> {
    static CLIENT: http::SharedClient = http::SharedClient::new();
    CLIENT.get(|| {
        let policy = reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() < 5 && url_allowed(attempt.url()) { attempt.follow() } else { attempt.stop() }
        });
        http::builder()
            .user_agent("T1nkiePlayz/Mochi/0.1.0 (https://github.com/T1nkiePlayz/Mochi)")
            .redirect(policy)
            .connect_timeout(std::time::Duration::from_secs(20))
            .read_timeout(std::time::Duration::from_secs(45))
            .build()
    }, "Unable to start the runtime downloader").map_err(|e| e.clone())
}

fn checked_url(url: &str) -> Result<reqwest::Url, String> {
    let parsed = reqwest::Url::parse(url).map_err(|_| "Invalid runtime download URL.".to_owned())?;
    if url_allowed(&parsed) { Ok(parsed) } else { Err("Mochi only downloads runtimes from GitHub.".into()) }
}

async fn get(url: reqwest::Url) -> Result<reqwest::Response, String> {
    let response = client()?.get(url).send().await.map_err(|e| format!("GitHub request failed: {e}"))?;
    if !response.status().is_success() { return Err(format!("GitHub request failed ({}).", response.status())); }
    if !url_allowed(response.url()) { return Err("GitHub redirected somewhere Mochi does not trust.".into()); }
    Ok(response)
}

async fn fetch_releases(kind: Kind) -> Result<Vec<GhRelease>, String> {
    let url = checked_url(&format!("https://api.github.com/repos/{}/releases?per_page=15", kind.repo()))?;
    let mut response = get(url).await?;
    let body = http::read_capped(&mut response, MAX_API_BYTES).await.map_err(|_| "GitHub's release list was too large or the connection dropped.".to_owned())?;
    let mut releases: Vec<GhRelease> = serde_json::from_slice(&body).map_err(|e| format!("Unexpected response from GitHub: {e}"))?;
    releases.retain(|r| !r.draft && !r.prerelease && select_assets(&r.assets).is_some());
    Ok(releases)
}

fn emit(kind: &str, tag: &str, phase: &'static str, downloaded: u64, total: Option<u64>) {
    crate::modinstance::emit(PROGRESS_EVENT, Progress { kind: kind.to_owned(), tag: tag.to_owned(), phase, downloaded, total });
}

static INSTALLING: AtomicBool = AtomicBool::new(false);
struct BusyGuard;
impl BusyGuard {
    fn acquire() -> Result<BusyGuard, String> {
        if INSTALLING.swap(true, Ordering::SeqCst) { Err("Another runtime install is already running.".into()) } else { Ok(BusyGuard) }
    }
}
impl Drop for BusyGuard { fn drop(&mut self) { INSTALLING.store(false, Ordering::SeqCst); } }

struct ScratchDir(PathBuf);
impl Drop for ScratchDir { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }

fn require_supported() -> Result<(), String> {
    if cfg!(target_os = "linux") { Ok(()) } else { Err("Installing runtimes is only available on Linux.".into()) }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

fn current_root(kind: Kind) -> Result<PathBuf, String> {
    install_root(kind, crate::platform::steam_root().as_deref(), crate::modinstance::data_dir().as_deref())
}

#[tauri::command(async)]
pub fn list_installed_runtimes(kind: String) -> Result<InstalledRuntimes, String> {
    require_supported()?;
    let kind = Kind::parse(&kind)?;
    Ok(match current_root(kind) {
        Ok(root) => InstalledRuntimes { runtimes: installed_in(kind, &root), root: Some(root.to_string_lossy().into_owned()) },
        Err(_) => InstalledRuntimes { root: None, runtimes: Vec::new() },
    })
}

#[tauri::command]
pub async fn list_runtime_releases(kind: String) -> Result<Vec<ReleaseInfo>, String> {
    require_supported()?;
    let kind = Kind::parse(&kind)?;
    let installed = current_root(kind).map(|root| installed_in(kind, &root)).unwrap_or_default();
    Ok(fetch_releases(kind).await?.into_iter().filter_map(|release| {
        let (archive, _) = select_assets(&release.assets)?;
        Some(ReleaseInfo {
            installed: is_installed(&release.tag_name, &installed),
            name: release.name.clone().filter(|n| !n.is_empty()).unwrap_or_else(|| release.tag_name.clone()),
            published_at: release.published_at.clone(),
            size: archive.size,
            tag: release.tag_name,
        })
    }).collect())
}

#[tauri::command]
pub async fn install_runtime(kind: String, tag: String) -> Result<String, String> {
    require_supported()?;
    let kind_name = kind.clone();
    let kind = Kind::parse(&kind)?;
    let _busy = BusyGuard::acquire()?;
    let result = install(kind, &kind_name, &tag).await;
    if result.is_err() { emit(&kind_name, &tag, "failed", 0, None); }
    result
}

async fn install(kind: Kind, kind_name: &str, tag: &str) -> Result<String, String> {
    let root = current_root(kind)?;
    emit(kind_name, tag, "preparing", 0, None);
    let releases = fetch_releases(kind).await?;
    let release = releases.iter().find(|r| r.tag_name == tag).ok_or("That release is no longer listed on GitHub.")?;
    let (archive, sum) = select_assets(&release.assets).ok_or("That release has no downloadable archive.")?;
    if archive.size > MAX_ARCHIVE_BYTES { return Err("The archive exceeds Mochi's 2 GiB safety limit.".into()); }
    let archive_url = checked_url(&archive.browser_download_url)?;
    let sum_url = checked_url(&sum.browser_download_url)?;

    let mut sum_response = get(sum_url).await?;
    let sum_body = http::read_capped(&mut sum_response, MAX_SUM_BYTES).await.map_err(|_| "The checksum file was too large or the connection dropped.".to_owned())?;
    let expected = parse_sha512(&String::from_utf8_lossy(&sum_body), &archive.name)?;

    fs::create_dir_all(&root).map_err(|e| format!("Unable to create {}: {e}", root.display()))?;
    static NEXT: AtomicU64 = AtomicU64::new(1);
    let scratch = ScratchDir(root.join(format!(".mochi-install-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed))));
    fs::create_dir_all(&scratch.0).map_err(|e| format!("Unable to create a temporary folder: {e}"))?;
    let archive_path = scratch.0.join(if archive.name.ends_with(".tar.xz") { "runtime.tar.xz" } else { "runtime.tar.gz" });

    let mut response = get(archive_url).await?;
    let total = response.content_length().or(Some(archive.size)).filter(|n| *n > 0);
    if total.is_some_and(|n| n > MAX_ARCHIVE_BYTES) { return Err("The archive exceeds Mochi's 2 GiB safety limit.".into()); }
    let digest = {
        let mut file = BufWriter::with_capacity(256 * 1024, fs::File::create(&archive_path).map_err(|e| format!("Unable to create the download: {e}"))?);
        let mut hasher = Sha512::new();
        let (mut downloaded, mut last_emit) = (0u64, 0u64);
        emit(kind_name, tag, "downloading", 0, total);
        while let Some(chunk) = response.chunk().await.map_err(|e| format!("Unable to read the download: {e}"))? {
            downloaded += chunk.len() as u64;
            if downloaded > MAX_ARCHIVE_BYTES { return Err("The archive exceeds Mochi's 2 GiB safety limit.".into()); }
            hasher.update(&chunk);
            file.write_all(&chunk).map_err(|e| format!("Unable to write the download: {e}"))?;
            if downloaded - last_emit >= 512 * 1024 { last_emit = downloaded; emit(kind_name, tag, "downloading", downloaded, total); }
        }
        file.flush().map_err(|e| format!("Unable to finish the download: {e}"))?;
        emit(kind_name, tag, "downloading", downloaded, total);
        hasher.finalize().iter().map(|b| format!("{b:02x}")).collect::<String>()
    };
    emit(kind_name, tag, "verifying", 0, None);
    if digest != expected { return Err("The download failed its SHA-512 check and was discarded.".into()); }

    emit(kind_name, tag, "extracting", 0, None);
    let (scratch_dir, root_dir) = (scratch.0.clone(), root.clone());
    let name = tauri::async_runtime::spawn_blocking(move || {
        let stage = scratch_dir.join("stage");
        extract_archive(&archive_path, &stage, &scratch_dir)?;
        promote(&stage, &root_dir)
    }).await.map_err(|e| format!("The install was interrupted: {e}"))??;
    emit(kind_name, tag, "done", 0, None);
    Ok(name)
}

#[tauri::command(async)]
pub fn remove_runtime(kind: String, name: String) -> Result<(), String> {
    require_supported()?;
    let kind = Kind::parse(&kind)?;
    remove_in(&current_root(kind)?, &name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sources::testutil::temp_dir;

    fn asset(name: &str) -> GhAsset { GhAsset { name: name.into(), size: 1, browser_download_url: format!("https://github.com/x/{name}") } }

    #[test]
    fn sumfiles_parse_both_formats_and_reject_junk() {
        let hash = "ab".repeat(64);
        assert_eq!(parse_sha512(&format!("{hash}  GE.tar.gz\n"), "GE.tar.gz").unwrap(), hash);
        assert_eq!(parse_sha512(&format!("{}  other\n{hash} *GE.tar.gz\n", "cd".repeat(64)), "GE.tar.gz").unwrap(), hash);
        assert_eq!(parse_sha512(&format!("{}  GE.tar.gz", hash.to_uppercase()), "GE.tar.gz").unwrap(), hash);
        assert_eq!(parse_sha512(&format!("{hash}  renamed.tar.gz"), "GE.tar.gz").unwrap(), hash);
        assert!(parse_sha512(&format!("{hash}  a\n{hash}  b"), "GE.tar.gz").is_err());
        assert!(parse_sha512("deadbeef  GE.tar.gz", "GE.tar.gz").is_err());
        assert!(parse_sha512("", "GE.tar.gz").is_err());
    }

    #[test]
    fn assets_prefer_gz_and_pair_with_their_checksum() {
        let assets = [asset("GE-Proton9-1.sha512sum"), asset("GE-Proton9-1.tar.gz"), asset("notes.txt")];
        let (archive, sum) = select_assets(&assets).unwrap();
        assert_eq!((archive.name.as_str(), sum.name.as_str()), ("GE-Proton9-1.tar.gz", "GE-Proton9-1.sha512sum"));
        let wine = [asset("wine-lutris-GE-8-26-x86_64.tar.xz"), asset("wine-lutris-GE-8-26-x86_64.sha512sum")];
        assert_eq!(select_assets(&wine).unwrap().0.name, "wine-lutris-GE-8-26-x86_64.tar.xz");
        assert!(select_assets(&[asset("a.tar.gz")]).is_none());
        assert!(select_assets(&[asset("a.zip"), asset("a.sha512sum")]).is_none());
    }

    #[test]
    fn urls_must_be_github_https() {
        for ok in ["https://api.github.com/repos/a/b", "https://github.com/a/b/releases/download/x/y", "https://objects.githubusercontent.com/x", "https://release-assets.githubusercontent.com/x"] {
            assert!(url_allowed(&reqwest::Url::parse(ok).unwrap()), "{ok}");
        }
        for bad in ["http://github.com/x", "https://evil.com/x", "https://github.com.evil.com/x", "https://user@github.com/x", "https://github.com:8443/x", "https://raw.githubusercontent.com/x"] {
            assert!(!url_allowed(&reqwest::Url::parse(bad).unwrap()), "{bad}");
        }
        assert!(checked_url("https://example.com/a").is_err());
    }

    #[test]
    fn install_roots_follow_the_kind() {
        let steam = Path::new("/home/u/.steam/steam");
        let data = Path::new("/home/u/.local/share/mochi");
        assert_eq!(install_root(Kind::Proton, Some(steam), Some(data)).unwrap(), steam.join("compatibilitytools.d"));
        assert_eq!(install_root(Kind::Wine, Some(steam), Some(data)).unwrap(), data.join("runtimes/wine"));
        assert!(install_root(Kind::Proton, None, Some(data)).is_err());
        assert!(install_root(Kind::Wine, Some(steam), None).is_err());
    }

    #[test]
    fn installed_flag_matches_tags_inside_wine_folder_names() {
        let installed = vec![InstalledRuntime { name: "lutris-GE-Proton8-26-x86_64".into(), path: String::new() }];
        assert!(is_installed("GE-Proton8-26", &installed));
        assert!(!is_installed("GE-Proton8-27", &installed));
    }

    #[test]
    fn installed_flag_needs_the_exact_folder_name() {
        let named = |n: &str| vec![InstalledRuntime { name: n.into(), path: String::new() }];
        assert!(is_installed("GE-Proton10-1", &named("GE-Proton10-1")));
        assert!(!is_installed("GE-Proton10-1", &named("GE-Proton10-10")));
        assert!(!is_installed("GE-Proton10-1", &named("lutris-GE-Proton10-10-x86_64")));
        assert!(is_installed("GE-Proton10-1", &named("lutris-GE-Proton10-1-x86_64")));
    }

    #[test]
    fn remove_stays_inside_the_managed_root() {
        let base = temp_dir("rt-remove");
        let root = base.join("root");
        fs::create_dir_all(root.join("GE-Proton9-1")).unwrap();
        fs::write(root.join("GE-Proton9-1/proton"), "x").unwrap();
        let outside = base.join("outside");
        fs::create_dir_all(&outside).unwrap();
        std::os::unix::fs::symlink(&outside, root.join("sneaky")).unwrap();
        fs::write(root.join("file"), "x").unwrap();
        for bad in ["../outside", "..", "", "/etc", "a/b", ".hidden", "sneaky", "file", "missing"] {
            assert!(remove_in(&root, bad).is_err(), "{bad}");
        }
        assert!(outside.exists());
        remove_in(&root, "GE-Proton9-1").unwrap();
        assert!(!root.join("GE-Proton9-1").exists());
        let _ = fs::remove_dir_all(base);
    }

    fn tar_with(entries: &[(&str, tar::EntryType, &str, &[u8])]) -> Vec<u8> {
        let mut builder = tar::Builder::new(Vec::new());
        for (path, kind, link, data) in entries {
            let mut header = tar::Header::new_gnu();
            header.as_old_mut().name[..path.len()].copy_from_slice(path.as_bytes());
            if !link.is_empty() { header.as_old_mut().linkname[..link.len()].copy_from_slice(link.as_bytes()); }
            header.set_entry_type(*kind);
            header.set_size(data.len() as u64);
            header.set_mode(0o755);
            header.set_cksum();
            builder.append(&header, *data).unwrap();
        }
        builder.into_inner().unwrap()
    }

    fn unpack(tag: &str, bytes: &[u8]) -> (PathBuf, Result<(), String>) {
        let base = temp_dir(tag);
        let result = extract_tar(bytes, &base.join("stage"));
        (base, result)
    }

    #[test]
    fn extraction_unpacks_files_dirs_and_inside_links() {
        let bytes = tar_with(&[
            ("GE/", tar::EntryType::Directory, "", b""),
            ("GE/proton", tar::EntryType::Regular, "", b"#!/bin/sh"),
            ("GE/lib", tar::EntryType::Directory, "", b""),
            ("GE/lib/link", tar::EntryType::Symlink, "../proton", b""),
            ("GE/hard", tar::EntryType::Link, "GE/proton", b""),
        ]);
        let (base, result) = unpack("rt-ok", &bytes);
        result.unwrap();
        assert_eq!(fs::read(base.join("stage/GE/lib/link")).unwrap(), b"#!/bin/sh");
        assert_eq!(fs::read(base.join("stage/GE/hard")).unwrap(), b"#!/bin/sh");
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn chained_links_that_resolve_outside_are_rejected_but_internal_ones_work() {
        let hop = tar_with(&[("d/s", tar::EntryType::Symlink, "..", b""), ("x", tar::EntryType::Symlink, "d/s/..", b"")]);
        let (base, result) = unpack("rt-chain", &hop);
        assert!(result.is_err());
        let _ = fs::remove_dir_all(base);
        let ok = tar_with(&[
            ("GE/", tar::EntryType::Directory, "", b""),
            ("GE/files/", tar::EntryType::Directory, "", b""),
            ("GE/files/lib/", tar::EntryType::Directory, "", b""),
            ("GE/files/lib64", tar::EntryType::Symlink, "lib", b""),
            ("GE/files/dangling", tar::EntryType::Symlink, "lib/missing", b""),
        ]);
        let (base, result) = unpack("rt-internal", &ok);
        result.unwrap();
        assert!(base.join("stage/GE/files/lib64").is_dir());
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn extraction_rejects_traversal_and_escaping_links() {
        let cases: Vec<(&str, Vec<u8>)> = vec![
            ("dotdot", tar_with(&[("../evil", tar::EntryType::Regular, "", b"x")])),
            ("nested-dotdot", tar_with(&[("a/../../evil", tar::EntryType::Regular, "", b"x")])),
            ("absolute", tar_with(&[("/tmp/mochi-evil", tar::EntryType::Regular, "", b"x")])),
            ("abs-symlink", tar_with(&[("l", tar::EntryType::Symlink, "/etc", b"")])),
            ("up-symlink", tar_with(&[("l", tar::EntryType::Symlink, "../../etc", b"")])),
            ("deep-up-symlink", tar_with(&[("a/b/l", tar::EntryType::Symlink, "../../../x", b"")])),
            ("abs-hardlink", tar_with(&[("h", tar::EntryType::Link, "/etc/passwd", b"")])),
            ("up-hardlink", tar_with(&[("h", tar::EntryType::Link, "../x", b"")])),
            ("device", tar_with(&[("dev", tar::EntryType::Char, "", b"")])),
            ("through-link", tar_with(&[("a/l", tar::EntryType::Symlink, "..", b""), ("a/l/../../evil", tar::EntryType::Regular, "", b"x")])),
            ("link-hop", tar_with(&[("d/s", tar::EntryType::Symlink, "..", b""), ("x", tar::EntryType::Symlink, "d/s/..", b""), ("x/evil", tar::EntryType::Regular, "", b"x")])),
        ];
        for (tag, bytes) in cases {
            let (base, result) = unpack(&format!("rt-bad-{tag}"), &bytes);
            assert!(result.is_err(), "{tag} should be rejected");
            assert!(!base.join("evil").exists() && !base.join("stage/evil").exists(), "{tag} escaped");
            let _ = fs::remove_dir_all(base);
        }
        assert!(!Path::new("/tmp/mochi-evil").exists());
    }

    #[test]
    fn promote_needs_one_folder_and_will_not_overwrite() {
        let base = temp_dir("rt-promote");
        let (stage, root) = (base.join("stage"), base.join("root"));
        fs::create_dir_all(stage.join("GE-Proton9-1")).unwrap();
        fs::create_dir_all(&root).unwrap();
        assert_eq!(promote(&stage, &root).unwrap(), "GE-Proton9-1");
        assert!(root.join("GE-Proton9-1").is_dir());
        fs::create_dir_all(stage.join("GE-Proton9-1")).unwrap();
        assert!(promote(&stage, &root).unwrap_err().contains("already installed"));
        fs::create_dir_all(stage.join("two")).unwrap();
        assert!(promote(&stage, &root).is_err());
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn xz_and_gzip_archives_unpack() {
        let bytes = tar_with(&[("GE/", tar::EntryType::Directory, "", b""), ("GE/proton", tar::EntryType::Regular, "", b"hi")]);
        let base = temp_dir("rt-codecs");
        let mut gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
        gz.write_all(&bytes).unwrap();
        fs::write(base.join("a.tar.gz"), gz.finish().unwrap()).unwrap();
        extract_archive(&base.join("a.tar.gz"), &base.join("gz"), &base).unwrap();
        assert_eq!(fs::read(base.join("gz/GE/proton")).unwrap(), b"hi");
        let mut xz = Vec::new();
        lzma_rs::xz_compress(&mut &bytes[..], &mut xz).unwrap();
        fs::write(base.join("b.tar.xz"), xz).unwrap();
        extract_archive(&base.join("b.tar.xz"), &base.join("xz"), &base).unwrap();
        assert_eq!(fs::read(base.join("xz/GE/proton")).unwrap(), b"hi");
        let _ = fs::remove_dir_all(base);
    }
}
