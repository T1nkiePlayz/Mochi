//! Installing a newly opened Mochi build over the managed installed copy, after checking that it is an
//! official release. Linux keeps `~/.local/bin/mochi.AppImage`; macOS keeps `Mochi.app` in an Applications
//! folder. The verification manifest (`install-hashes.json`) is signed with the updater key.

use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, State};

use crate::platform;

const RELEASE_BASE: &str = "https://github.com/T1nkiePlayz/Mochi/releases/download";
const MAX_BODY: usize = 64 * 1024;
const MACOS_EXECUTABLE: &str = "Contents/MacOS/mochi";

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub version: String,
    pub installed_version: Option<String>,
    pub first_install: bool,
    pub source_path: String,
    pub target_path: String,
}

pub type SelfInstallState = Mutex<Option<Candidate>>;

#[derive(Serialize)]
pub struct VerifyResult { status: &'static str, detail: String }

fn verdict(status: &'static str, detail: impl Into<String>) -> VerifyResult { VerifyResult { status, detail: detail.into() } }

// ---------------------------------------------------------------- pure decisions

/// `~/.local/bin/mochi.AppImage`, the one place the Linux install location is defined.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub fn linux_install_target() -> Option<PathBuf> {
    platform::home_dir().map(|home| home.join(".local/bin/mochi.AppImage"))
}

/// (size, modified seconds since the epoch) of a file.
type FileStamp = (u64, u64);

/// Same heuristic Mochi always used: install when there is no copy, or its size differs, or the source is newer.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn linux_needs_install(same_file: bool, source: FileStamp, target: Option<FileStamp>) -> bool {
    if same_file { return false; }
    match target {
        None => true,
        Some(target) => target.0 != source.0 || source.1 > target.1,
    }
}

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn stamp(meta: &std::fs::Metadata) -> FileStamp {
    let seconds = meta.modified().ok().and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok()).map_or(0, |d| d.as_secs());
    (meta.len(), seconds)
}

/// `<X>.app` for an executable at `<X>.app/Contents/MacOS/<bin>`.
#[cfg_attr(not(any(target_os = "macos", test)), allow(dead_code))]
fn macos_bundle_from_exe(exe: &Path) -> Option<PathBuf> {
    let macos_dir = exe.parent()?;
    let contents = macos_dir.parent()?;
    let bundle = contents.parent()?;
    if macos_dir.file_name()? != "MacOS" || contents.file_name()? != "Contents" { return None; }
    if bundle.extension()? != "app" { return None; }
    Some(bundle.to_path_buf())
}

/// A bundle already under /Applications or ~/Applications is an installed copy. Disk images
/// (/Volumes) and Gatekeeper's AppTranslocation copies are not.
#[cfg_attr(not(any(target_os = "macos", test)), allow(dead_code))]
fn macos_in_applications(bundle: &Path, home: Option<&Path>) -> bool {
    bundle.starts_with("/Applications") || home.is_some_and(|home| bundle.starts_with(home.join("Applications")))
}

#[cfg_attr(not(any(target_os = "macos", test)), allow(dead_code))]
fn macos_install_target(applications_writable: bool, home: Option<&Path>) -> Option<PathBuf> {
    if applications_writable { Some(PathBuf::from("/Applications/Mochi.app")) } else { home.map(|home| home.join("Applications/Mochi.app")) }
}

#[cfg_attr(not(any(target_os = "macos", test)), allow(dead_code))]
fn macos_needs_install(target_exists: bool, source_size: Option<u64>, target_size: Option<u64>, source_version: Option<&str>, target_version: Option<&str>) -> bool {
    !target_exists || source_size != target_size || source_version != target_version
}

#[cfg_attr(not(any(target_os = "macos", test)), allow(dead_code))]
fn plist_short_version(path: &Path) -> Option<String> {
    let value = plist::Value::from_file(path).ok()?;
    value.as_dictionary()?.get("CFBundleShortVersionString")?.as_string().map(str::to_owned)
}

// ---------------------------------------------------------------- detection

/// Whether this launch is a build that should offer to install itself. Cheap; called before the app is built.
pub fn detect() -> Option<Candidate> {
    if cfg!(debug_assertions) && std::env::var_os("MOCHI_SELFINSTALL_DEV").is_none_or(|v| v != "1") { return None; }
    detect_platform()
}

#[cfg(target_os = "linux")]
fn detect_platform() -> Option<Candidate> {
    let source = PathBuf::from(std::env::var_os("APPIMAGE")?);
    let source_meta = std::fs::metadata(&source).ok().filter(|meta| meta.is_file())?;
    let target = linux_install_target()?;
    let source = std::fs::canonicalize(&source).ok()?;
    let target_meta = std::fs::metadata(&target).ok();
    let same = std::fs::canonicalize(&target).ok().as_deref() == Some(source.as_path());
    if !linux_needs_install(same, stamp(&source_meta), target_meta.as_ref().map(stamp)) { return None; }
    Some(Candidate {
        version: env!("CARGO_PKG_VERSION").into(),
        installed_version: None,
        first_install: target_meta.is_none(),
        source_path: source.to_string_lossy().into_owned(),
        target_path: target.to_string_lossy().into_owned(),
    })
}

#[cfg(target_os = "macos")]
fn detect_platform() -> Option<Candidate> {
    let bundle = macos_bundle_from_exe(&std::env::current_exe().ok()?)?;
    let home = platform::home_dir();
    if macos_in_applications(&bundle, home.as_deref()) { return None; }
    let writable = unsafe { libc::access(c"/Applications".as_ptr(), libc::W_OK) } == 0;
    let target = macos_install_target(writable, home.as_deref())?;
    let size = |bundle: &Path| std::fs::metadata(bundle.join(MACOS_EXECUTABLE)).ok().map(|meta| meta.len());
    let source_version = plist_short_version(&bundle.join("Contents/Info.plist"));
    let target_version = plist_short_version(&target.join("Contents/Info.plist"));
    let exists = target.exists();
    if !macos_needs_install(exists, size(&bundle), size(&target), source_version.as_deref(), target_version.as_deref()) { return None; }
    Some(Candidate {
        version: env!("CARGO_PKG_VERSION").into(),
        installed_version: target_version,
        first_install: !exists,
        source_path: bundle.to_string_lossy().into_owned(),
        target_path: target.to_string_lossy().into_owned(),
    })
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
fn detect_platform() -> Option<Candidate> { None }

// ---------------------------------------------------------------- manifest and signature

#[derive(Deserialize)]
struct Manifest {
    version: String,
    #[serde(default)]
    linux: Vec<ManifestFile>,
    #[serde(default)]
    macos: Vec<ManifestFile>,
}

#[derive(Deserialize)]
struct ManifestFile { sha256: String }

fn decode_text(base64_text: &str) -> Result<String, String> {
    let bytes = base64::engine::general_purpose::STANDARD.decode(base64_text.trim()).map_err(|e| e.to_string())?;
    String::from_utf8(bytes).map_err(|e| e.to_string())
}

/// Checks the minisign signature over the raw manifest bytes (the way the updater does), then that the
/// manifest is for this version and lists `sha256`. Err is a plain-English reason for a mismatch.
fn check_manifest(manifest: &[u8], signature_b64: &str, public_key_b64: &str, version: &str, mac: bool, sha256: &str) -> Result<(), String> {
    let key = decode_text(public_key_b64).ok().and_then(|text| minisign_verify::PublicKey::decode(&text).ok()).ok_or("The bundled public key could not be read.")?;
    let signature = decode_text(signature_b64).ok().and_then(|text| minisign_verify::Signature::decode(&text).ok()).ok_or("The release signature could not be read.")?;
    key.verify(manifest, &signature, true).map_err(|_| "The release signature does not match Mochi's signing key.")?;
    let parsed: Manifest = serde_json::from_slice(manifest).map_err(|_| "The release manifest could not be read.")?;
    if parsed.version != version { return Err(format!("The release manifest is for version {}, not {version}.", parsed.version)); }
    let files = if mac { &parsed.macos } else { &parsed.linux };
    if files.iter().any(|file| file.sha256.eq_ignore_ascii_case(sha256)) { Ok(()) } else { Err("This file is not one of the official release files.".into()) }
}

fn sha256_file(path: &Path) -> std::io::Result<String> {
    use std::io::Read;
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1 << 20];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 { break; }
        hasher.update(&buffer[..read]);
    }
    Ok(hasher.finalize().iter().map(|byte| format!("{byte:02x}")).collect())
}

enum Fetch { Body(Vec<u8>), Missing, Offline, Failed(String) }

async fn fetch_limited(client: &reqwest::Client, url: &str) -> Fetch {
    let mut response = match client.get(url).send().await {
        Ok(response) => response,
        Err(error) if error.is_connect() || error.is_timeout() => return Fetch::Offline,
        Err(error) => return Fetch::Failed(error.to_string()),
    };
    if response.status() == reqwest::StatusCode::NOT_FOUND { return Fetch::Missing; }
    if !response.status().is_success() { return Fetch::Failed(format!("GitHub answered with HTTP {}.", response.status().as_u16())); }
    if response.content_length().is_some_and(|len| len > MAX_BODY as u64) { return Fetch::Failed("The release manifest is unexpectedly large.".into()); }
    let mut body = Vec::new();
    loop {
        match response.chunk().await {
            Ok(Some(chunk)) => {
                body.extend_from_slice(&chunk);
                if body.len() > MAX_BODY { return Fetch::Failed("The release manifest is unexpectedly large.".into()); }
            }
            Ok(None) => return Fetch::Body(body),
            Err(error) if error.is_connect() || error.is_timeout() => return Fetch::Offline,
            Err(error) => return Fetch::Failed(error.to_string()),
        }
    }
}

fn candidate(state: &SelfInstallState) -> Option<Candidate> { state.lock().ok().and_then(|guard| guard.clone()) }

// ---------------------------------------------------------------- commands

#[tauri::command]
pub fn self_install_status(state: State<'_, SelfInstallState>) -> Option<Candidate> { candidate(&state) }

#[tauri::command]
pub async fn self_install_verify(app: AppHandle, state: State<'_, SelfInstallState>) -> Result<VerifyResult, String> {
    let Some(candidate) = candidate(&state) else { return Err("There is nothing to install.".into()) };
    let version = env!("CARGO_PKG_VERSION");
    let public_key = app.config().plugins.0.get("updater").and_then(|updater| updater.get("pubkey")).and_then(|key| key.as_str()).map(str::to_owned);
    let Some(public_key) = public_key else { return Ok(verdict("mismatch", "Mochi has no signing key to check this build against.")) };

    let client = reqwest::Client::builder().timeout(Duration::from_secs(10)).user_agent(concat!("Mochi/", env!("CARGO_PKG_VERSION"))).build().map_err(|e| e.to_string())?;
    let manifest_url = format!("{RELEASE_BASE}/v{version}/install-hashes.json");
    let manifest = match fetch_limited(&client, &manifest_url).await {
        Fetch::Body(body) => body,
        Fetch::Missing => return Ok(verdict("unavailable", format!("No verification data is published for Mochi {version}."))),
        Fetch::Offline => return Ok(verdict("offline", "Mochi could not reach GitHub to check this build.")),
        Fetch::Failed(error) => return Ok(verdict("unavailable", format!("The verification data could not be downloaded: {error}"))),
    };
    let signature = match fetch_limited(&client, &format!("{manifest_url}.sig")).await {
        Fetch::Body(body) => String::from_utf8_lossy(&body).into_owned(),
        Fetch::Missing => return Ok(verdict("unavailable", format!("No release signature is published for Mochi {version}."))),
        Fetch::Offline => return Ok(verdict("offline", "Mochi could not reach GitHub to check this build.")),
        Fetch::Failed(error) => return Ok(verdict("unavailable", format!("The release signature could not be downloaded: {error}"))),
    };

    let source = PathBuf::from(&candidate.source_path);
    let mac = cfg!(target_os = "macos");
    let outcome = tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let file = if mac { source.join(MACOS_EXECUTABLE) } else { source.clone() };
        let hash = sha256_file(&file).map_err(|e| format!("This build could not be read to check it: {e}"))?;
        check_manifest(&manifest, &signature, &public_key, version, mac, &hash)?;
        #[cfg(target_os = "macos")]
        {
            let status = std::process::Command::new("codesign").args(["--verify", "--deep", "--strict"]).arg(&source).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).status();
            if !status.is_ok_and(|status| status.success()) { return Err("This app's code signature is not valid.".into()); }
        }
        Ok(())
    }).await.map_err(|e| e.to_string())?;
    Ok(match outcome {
        Ok(()) => verdict("verified", format!("This is the official Mochi {version} release.")),
        Err(reason) => verdict("mismatch", reason),
    })
}

#[tauri::command(async)]
pub fn self_install_apply(app: AppHandle, state: State<'_, SelfInstallState>) -> Result<(), String> {
    let Some(candidate) = candidate(&state) else { return Err("There is nothing to install.".into()) };
    let source = PathBuf::from(&candidate.source_path);
    let target = PathBuf::from(&candidate.target_path);
    install_copy(&source, &target)?;
    stop_other_instances(&target);
    relaunch(&target)?;
    if let Ok(mut guard) = state.lock() { *guard = None; }
    app.exit(0);
    Ok(())
}

#[tauri::command(async)]
pub fn self_install_skip(app: AppHandle, state: State<'_, SelfInstallState>) -> Result<(), String> {
    let Some(candidate) = candidate(&state) else { return Ok(()) };
    let target = PathBuf::from(&candidate.target_path);
    if target.exists() {
        relaunch(&target)?;
        app.exit(0);
    } else {
        if let Ok(mut guard) = state.lock() { *guard = None; }
        std::thread::spawn(|| {
            if let Err(error) = platform::ensure_platform_integration() { eprintln!("Mochi platform integration: {error}"); }
        });
    }
    Ok(())
}

// ---------------------------------------------------------------- installing

#[cfg(target_os = "linux")]
fn install_copy(source: &Path, target: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    let directory = target.parent().ok_or("Unable to determine the install directory.")?;
    std::fs::create_dir_all(directory).map_err(|e| format!("Unable to create the AppImage install directory: {e}"))?;
    let temporary = directory.join(format!(".mochi.AppImage.{}.tmp", std::process::id()));
    let _ = std::fs::remove_file(&temporary);
    let result = std::fs::copy(source, &temporary)
        .map_err(|e| format!("Unable to copy Mochi into {}: {e}", directory.display()))
        .and_then(|_| std::fs::metadata(source).map_err(|e| format!("Unable to inspect the launched AppImage: {e}")))
        .and_then(|meta| std::fs::set_permissions(&temporary, std::fs::Permissions::from_mode(meta.permissions().mode() | 0o100)).map_err(|e| format!("Unable to make the installed AppImage executable: {e}")))
        .and_then(|_| std::fs::rename(&temporary, target).map_err(|e| format!("Unable to update the installed Mochi AppImage: {e}")));
    if result.is_err() { let _ = std::fs::remove_file(&temporary); }
    result
}

#[cfg(target_os = "macos")]
fn install_copy(source: &Path, target: &Path) -> Result<(), String> {
    let with_suffix = |suffix: &str| { let mut name = target.as_os_str().to_owned(); name.push(suffix); PathBuf::from(name) };
    let (new, old) = (with_suffix(".mochi-new"), with_suffix(".mochi-old"));
    if let Some(parent) = target.parent() { std::fs::create_dir_all(parent).map_err(|e| format!("Unable to create the Applications folder: {e}"))?; }
    let _ = std::fs::remove_dir_all(&new);
    let _ = std::fs::remove_dir_all(&old);
    let copied = std::process::Command::new("ditto").arg(source).arg(&new).status();
    if !copied.is_ok_and(|status| status.success()) {
        let _ = std::fs::remove_dir_all(&new);
        return Err("Unable to copy Mochi into the Applications folder.".into());
    }
    let had_old = target.exists();
    if had_old {
        std::fs::rename(target, &old).map_err(|e| { let _ = std::fs::remove_dir_all(&new); format!("Unable to replace the installed Mochi: {e}") })?;
    }
    if let Err(error) = std::fs::rename(&new, target) {
        if had_old { let _ = std::fs::rename(&old, target); }
        let _ = std::fs::remove_dir_all(&new);
        return Err(format!("Unable to put the new Mochi in place: {error}"));
    }
    let _ = std::fs::remove_dir_all(&old);
    Ok(())
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
fn install_copy(_source: &Path, _target: &Path) -> Result<(), String> { Err("Installing is not supported on this system.".into()) }

fn relaunch(target: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let command = { let mut command = std::process::Command::new("open"); command.arg("-n").arg(target); command };
    #[cfg(not(target_os = "macos"))]
    let command = {
        let mut command = std::process::Command::new(target);
        // These describe the AppImage we are running from, not the one being started.
        for name in ["APPIMAGE", "APPDIR", "ARGV0", "OWD"] { command.env_remove(name); }
        command
    };
    platform::spawn_detached(command).map(|_| ()).map_err(|e| format!("Unable to start the installed Mochi: {e}"))
}

// ---------------------------------------------------------------- stopping other instances

#[cfg_attr(not(any(target_os = "macos", test)), allow(dead_code))]
fn parse_ps_matches(output: &str, uid: u32, prefix: &str) -> Vec<u32> {
    output.lines().filter_map(|line| {
        let line = line.trim_start();
        let (pid, rest) = line.split_once(char::is_whitespace)?;
        let (line_uid, comm) = rest.trim_start().split_once(char::is_whitespace)?;
        (line_uid.parse::<u32>().ok()? == uid && comm.trim_start().starts_with(prefix)).then(|| pid.parse().ok()).flatten()
    }).collect()
}

#[cfg(target_os = "linux")]
fn other_instances(target: &Path) -> Vec<u32> {
    use std::os::unix::fs::MetadataExt;
    let own = std::process::id();
    let uid = unsafe { libc::getuid() };
    let wanted = format!("APPIMAGE={}", target.display());
    let Ok(entries) = std::fs::read_dir("/proc") else { return Vec::new() };
    entries.flatten().filter_map(|entry| {
        let pid: u32 = entry.file_name().to_str()?.parse().ok()?;
        if pid == own || entry.metadata().ok()?.uid() != uid { return None; }
        let proc = entry.path();
        let environ_match = std::fs::read(proc.join("environ")).is_ok_and(|bytes| bytes.split(|b| *b == 0).any(|var| var == wanted.as_bytes()));
        let exe_match = std::fs::read_link(proc.join("exe")).is_ok_and(|exe| {
            let text = exe.to_string_lossy();
            Path::new(text.strip_suffix(" (deleted)").unwrap_or(&text)).starts_with(target)
        });
        (environ_match || exe_match).then_some(pid)
    }).collect()
}

#[cfg(target_os = "macos")]
fn other_instances(target: &Path) -> Vec<u32> {
    let mut command = std::process::Command::new("ps");
    command.args(["-axo", "pid=,uid=,comm="]);
    let Some(output) = platform::run_capture(command, Duration::from_secs(5)) else { return Vec::new() };
    let prefix = format!("{}/Contents/MacOS/", target.display());
    let own = std::process::id();
    parse_ps_matches(&String::from_utf8_lossy(&output), unsafe { libc::getuid() }, &prefix).into_iter().filter(|pid| *pid != own).collect()
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
fn other_instances(_target: &Path) -> Vec<u32> { Vec::new() }

/// Ends every other running Mochi from the installed location: SIGTERM, up to 5 s grace, then SIGKILL.
fn stop_other_instances(target: &Path) {
    let pids = other_instances(target);
    if pids.is_empty() { return; }
    for pid in &pids { unsafe { libc::kill(*pid as i32, libc::SIGTERM); } }
    let alive = |pid: &u32| unsafe { libc::kill(*pid as i32, 0) == 0 };
    let started = std::time::Instant::now();
    while started.elapsed() < Duration::from_secs(5) && pids.iter().any(alive) { std::thread::sleep(Duration::from_millis(100)); }
    for pid in pids.iter().filter(|pid| alive(pid)) { unsafe { libc::kill(*pid as i32, libc::SIGKILL); } }
}

#[cfg(test)]
mod tests {
    use super::*;

    // A throwaway key generated only for these tests; it signs nothing real.
    const TEST_PUBKEY_B64: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDIxM0U5MjYyMzY1QjMzOTkKUldTWk0xczJZcEkrSWV1VDFJMWd3K1JmUmhzZzViMGRzZWR2L1psZ0NnblFpNGdHQ1VoaE1FZmkK";
    const TEST_SIG_B64: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVTWk0xczJZcEkrSVZxMkRJdEdjQ1FvcXpycG82dUlvelR6NWhvWVg1QlFxOS9BVHAza1Y2aU1BdW9vSzZRUERldEQ3eHBGTzlnQ0IwSmVySDNHQTlKendQYy9xL0dDZlFZPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzkxNTM5OTA1CWZpbGU6bWFuaWZlc3QuanNvbgpXVDB1RlJmOUlvUDdrc25GUFAwUDBzSkhkb1M2ZjNQeUNFOTdqZDNFSE93bkZLQ0VlMUlqdHlSb1ZJRHJpTk9iUWZTV3FtbmlHTExYRjMyRFh1WURBUT09Cg==";
    const TEST_MANIFEST: &str = r#"{"version":"1.2.3","linux":[{"name":"Mochi_1.2.3_amd64.AppImage","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}],"macos":[{"name":"Mochi.app/Contents/MacOS/mochi","arch":"universal","sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}]}"#;
    const TEST_LINUX_SHA: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const TEST_MAC_SHA: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    #[test]
    fn linux_decision() {
        assert!(!linux_needs_install(true, (10, 5), None));
        assert!(linux_needs_install(false, (10, 5), None));
        assert!(linux_needs_install(false, (10, 5), Some((11, 9))));
        assert!(linux_needs_install(false, (10, 9), Some((10, 5))));
        assert!(!linux_needs_install(false, (10, 5), Some((10, 9))));
        assert!(!linux_needs_install(false, (10, 5), Some((10, 5))));
    }

    #[test]
    fn macos_bundle_detection() {
        let home = Path::new("/Users/me");
        let bundle = |exe: &str| macos_bundle_from_exe(Path::new(exe)).unwrap();
        assert_eq!(bundle("/Applications/Mochi.app/Contents/MacOS/mochi"), Path::new("/Applications/Mochi.app"));
        assert!(macos_bundle_from_exe(Path::new("/usr/local/bin/mochi")).is_none());
        assert!(macos_in_applications(&bundle("/Applications/Mochi.app/Contents/MacOS/mochi"), Some(home)));
        assert!(macos_in_applications(&bundle("/Users/me/Applications/Mochi.app/Contents/MacOS/mochi"), Some(home)));
        assert!(!macos_in_applications(&bundle("/Volumes/Mochi/Mochi.app/Contents/MacOS/mochi"), Some(home)));
        assert!(!macos_in_applications(&bundle("/private/var/folders/ab/T/AppTranslocation/1234/d/Mochi.app/Contents/MacOS/mochi"), Some(home)));
        assert!(!macos_in_applications(&bundle("/Users/me/Downloads/Mochi.app/Contents/MacOS/mochi"), Some(home)));
    }

    #[test]
    fn macos_target_and_decision() {
        let home = Some(Path::new("/Users/me"));
        assert_eq!(macos_install_target(true, home).unwrap(), Path::new("/Applications/Mochi.app"));
        assert_eq!(macos_install_target(false, home).unwrap(), Path::new("/Users/me/Applications/Mochi.app"));
        assert!(macos_needs_install(false, Some(1), None, Some("1"), None));
        assert!(macos_needs_install(true, Some(1), Some(2), Some("1"), Some("1")));
        assert!(macos_needs_install(true, Some(1), Some(1), Some("2"), Some("1")));
        assert!(!macos_needs_install(true, Some(1), Some(1), Some("1"), Some("1")));
    }

    #[test]
    fn plist_version_and_ps_parsing() {
        let dir = std::env::temp_dir().join(format!("mochi-selfinstall-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("Info.plist");
        std::fs::write(&path, "<?xml version=\"1.0\"?><plist version=\"1.0\"><dict><key>CFBundleShortVersionString</key><string>1.2.3</string></dict></plist>").unwrap();
        assert_eq!(plist_short_version(&path).as_deref(), Some("1.2.3"));
        let _ = std::fs::remove_dir_all(&dir);
        let ps = "  101   501 /Applications/Mochi.app/Contents/MacOS/mochi\n  102   502 /Applications/Mochi.app/Contents/MacOS/mochi\n  103   501 /usr/bin/other\n";
        assert_eq!(parse_ps_matches(ps, 501, "/Applications/Mochi.app/Contents/MacOS/"), vec![101]);
    }

    #[test]
    fn manifest_verifies_and_looks_up_hashes() {
        let check = |version: &str, mac: bool, sha: &str| check_manifest(TEST_MANIFEST.as_bytes(), TEST_SIG_B64, TEST_PUBKEY_B64, version, mac, sha);
        assert!(check("1.2.3", false, TEST_LINUX_SHA).is_ok());
        assert!(check("1.2.3", true, TEST_MAC_SHA).is_ok());
        assert!(check("1.2.3", false, TEST_MAC_SHA).is_err());
        assert!(check("1.2.3", false, &"c".repeat(64)).is_err());
        assert!(check("1.2.4", false, TEST_LINUX_SHA).is_err());
    }

    #[test]
    fn tampered_manifest_fails() {
        let tampered = TEST_MANIFEST.replace(TEST_LINUX_SHA, &"c".repeat(64));
        assert!(check_manifest(tampered.as_bytes(), TEST_SIG_B64, TEST_PUBKEY_B64, "1.2.3", false, &"c".repeat(64)).is_err());
    }

    #[test]
    fn file_hash_is_sha256() {
        let path = std::env::temp_dir().join(format!("mochi-selfinstall-hash-{}", std::process::id()));
        std::fs::write(&path, b"abc").unwrap();
        assert_eq!(sha256_file(&path).unwrap(), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        let _ = std::fs::remove_file(&path);
    }
}
