//! Interface sound packs: a folder or zip holding `manifest.json` that maps UI events to short audio files.
//!
//! Packs are copied into `<Mochi config>/sound-packs/<id>/` (Linux `~/.config/Mochi`, macOS
//! `~/Library/Application Support/Mochi`). Only the manifest and the files it names are ever read or written, every
//! path is checked to stay inside the pack, sizes are capped before anything is buffered, and audio files must
//! carry a real WAV, Ogg or MP3 signature. Built-in packs are synthesised by the frontend and never stored here.

use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};
use tauri::AppHandle;

const PACKS_DIR: &str = "sound-packs";
const MANIFEST: &str = "manifest.json";
const MAX_MANIFEST_BYTES: u64 = 64 * 1024;
const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES: u64 = 16 * 1024 * 1024;
const MAX_ZIP_ENTRIES: usize = 512;

/// Must match `SOUND_EVENTS` in src/lib/sound/events.ts.
pub const SOUND_EVENTS: &[&str] = &[
    "navigate", "tab", "select", "back", "open", "close", "launch", "error", "notification", "toggleOn", "toggleOff", "achievement", "download",
];
/// Ids the built-in (synthesised) packs and the pack setting use.
const RESERVED_IDS: &[&str] = &["mochi", "chiptune", "glass", "default", "theme", "none", "builtin"];
const EXTENSIONS: &[&str] = &["wav", "ogg", "oga", "mp3"];

static COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SoundPackManifest {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    #[serde(default = "default_version")]
    pub version: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub description: String,
    /// Event name -> relative file path.
    pub sounds: BTreeMap<String, String>,
    /// Overall loudness of the pack, 0.0 - 1.0 (default 1).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub volume: Option<f32>,
}

fn default_version() -> String { "1.0.0".into() }

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SoundPackInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    pub author: String,
    pub description: String,
    pub events: Vec<String>,
    pub volume: f32,
    pub size_bytes: u64,
}

impl SoundPackInfo {
    fn from_manifest(manifest: &SoundPackManifest, size_bytes: u64) -> Self {
        SoundPackInfo {
            id: manifest.id.clone(), name: manifest.name.clone(), version: manifest.version.clone(), author: manifest.author.clone(),
            description: manifest.description.clone(), events: manifest.sounds.keys().cloned().collect(), volume: manifest.volume.unwrap_or(1.0), size_bytes,
        }
    }
}

pub fn valid_pack_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') && !id.starts_with(['-', '_'])
}

/// A relative path inside the pack: no absolute paths, `..`, hidden segments or odd characters.
pub fn safe_relative(path: &str) -> Result<PathBuf, String> {
    if path.is_empty() || path.len() > 160 || path.contains('\\') || path.chars().any(char::is_control) {
        return Err(format!("'{path}' is not a valid file path inside the pack."));
    }
    let candidate = Path::new(path);
    let mut out = PathBuf::new();
    for component in candidate.components() {
        match component {
            Component::Normal(part) => {
                let text = part.to_str().ok_or("Sound file names must be valid text.")?;
                if text.starts_with('.') { return Err(format!("'{path}' is not a valid file path inside the pack.")); }
                out.push(text);
            }
            Component::CurDir => {}
            _ => return Err(format!("'{path}' must be a relative path inside the pack.")),
        }
    }
    if out.components().count() == 0 || out.components().count() > 3 { return Err(format!("'{path}' is not a valid file path inside the pack.")); }
    let extension = out.extension().and_then(|value| value.to_str()).map(str::to_ascii_lowercase).unwrap_or_default();
    if !EXTENSIONS.contains(&extension.as_str()) { return Err(format!("'{path}' must be a .wav, .ogg or .mp3 file.")); }
    Ok(out)
}

pub fn validate_manifest(manifest: &SoundPackManifest) -> Result<(), String> {
    if manifest.schema_version != 1 { return Err(format!("Unsupported sound pack schema version {}. Mochi supports version 1.", manifest.schema_version)); }
    if !valid_pack_id(&manifest.id) { return Err("Sound pack ids may only contain letters, numbers, hyphens and underscores (up to 64).".into()); }
    if RESERVED_IDS.contains(&manifest.id.to_ascii_lowercase().as_str()) { return Err(format!("'{}' is reserved for a built-in pack; choose another id.", manifest.id)); }
    if manifest.name.trim().is_empty() || manifest.name.len() > 80 { return Err("A sound pack needs a name (up to 80 characters).".into()); }
    if manifest.version.len() > 32 || manifest.author.len() > 120 || manifest.description.len() > 600 { return Err("The pack's version, author or description is too long.".into()); }
    if manifest.sounds.is_empty() { return Err("A sound pack must map at least one event to a sound.".into()); }
    if let Some(volume) = manifest.volume { if !(0.0..=1.0).contains(&volume) { return Err("A pack's volume must be between 0 and 1.".into()); } }
    for (event, file) in &manifest.sounds {
        if !SOUND_EVENTS.contains(&event.as_str()) { return Err(format!("Unknown sound event '{event}'. Known events: {}.", SOUND_EVENTS.join(", "))); }
        safe_relative(file)?;
    }
    Ok(())
}

pub fn parse_manifest(bytes: &[u8]) -> Result<SoundPackManifest, String> {
    let manifest = serde_json::from_slice::<SoundPackManifest>(bytes).map_err(|error| format!("manifest.json is invalid: {error}"))?;
    validate_manifest(&manifest)?;
    Ok(manifest)
}

/// True when the bytes start like a WAV (RIFF/WAVE), Ogg or MP3 (ID3 tag or MPEG frame sync) file.
pub fn looks_like_audio(bytes: &[u8]) -> bool {
    (bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WAVE")
        || bytes.starts_with(b"OggS")
        || bytes.starts_with(b"ID3")
        || (bytes.len() >= 2 && bytes[0] == 0xFF && bytes[1] & 0xE0 == 0xE0)
}

pub fn mime_for(path: &Path) -> &'static str {
    match path.extension().and_then(|value| value.to_str()).map(str::to_ascii_lowercase).as_deref() {
        Some("wav") => "audio/wav",
        Some("mp3") => "audio/mpeg",
        _ => "audio/ogg",
    }
}

fn read_capped(reader: impl Read, limit: u64, label: &str) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    reader.take(limit + 1).read_to_end(&mut bytes).map_err(|error| format!("Unable to read {label}: {error}"))?;
    if bytes.len() as u64 > limit { return Err(format!("{label} is larger than the {} KiB limit.", limit / 1024)); }
    Ok(bytes)
}

/// A pack read fully into memory (bounded by the caps) and checked, ready to be written.
#[derive(Debug)]
pub struct StagedPack { pub manifest: SoundPackManifest, pub files: Vec<(PathBuf, Vec<u8>)> }

fn stage(manifest: SoundPackManifest, mut read: impl FnMut(&Path) -> Result<Vec<u8>, String>) -> Result<StagedPack, String> {
    let mut files: Vec<(PathBuf, Vec<u8>)> = Vec::new();
    let mut total = 0u64;
    for file in manifest.sounds.values() {
        let relative = safe_relative(file)?;
        if files.iter().any(|(path, _)| *path == relative) { continue; }
        let bytes = read(&relative)?;
        if !looks_like_audio(&bytes) { return Err(format!("'{file}' is not a WAV, Ogg or MP3 file.")); }
        total += bytes.len() as u64;
        if total > MAX_TOTAL_BYTES { return Err(format!("The pack's sounds add up to more than {} MiB.", MAX_TOTAL_BYTES / 1024 / 1024)); }
        files.push((relative, bytes));
    }
    Ok(StagedPack { manifest, files })
}

/// Reads a pack folder. Symlinks are refused so a pack cannot pull in files from elsewhere.
pub fn stage_folder(folder: &Path) -> Result<StagedPack, String> {
    let open = |path: &Path, limit: u64, label: &str| -> Result<Vec<u8>, String> {
        let meta = fs::symlink_metadata(path).map_err(|_| format!("The pack is missing {label}."))?;
        if !meta.is_file() { return Err(format!("{label} must be a regular file.")); }
        if meta.len() > limit { return Err(format!("{label} is larger than the {} KiB limit.", limit / 1024)); }
        read_capped(fs::File::open(path).map_err(|error| format!("Unable to open {label}: {error}"))?, limit, label)
    };
    let manifest = parse_manifest(&open(&folder.join(MANIFEST), MAX_MANIFEST_BYTES, MANIFEST)?)?;
    stage(manifest, |relative| {
        // Every directory on the way must be real too.
        let mut current = folder.to_path_buf();
        for part in relative.parent().into_iter().flat_map(Path::components) {
            current.push(part);
            if !fs::symlink_metadata(&current).map(|meta| meta.is_dir()).unwrap_or(false) { return Err(format!("The pack is missing '{}'.", relative.display())); }
        }
        open(&folder.join(relative), MAX_FILE_BYTES, &format!("'{}'", relative.display()))
    })
}

/// Reads a pack zip. Only `manifest.json` (at the root or inside one top-level folder) and the files it names are
/// read; entries are looked up by exact name, so traversal names inside the archive are never used as paths.
pub fn stage_zip(path: &Path) -> Result<StagedPack, String> {
    let file = fs::File::open(path).map_err(|error| format!("Unable to open the pack: {error}"))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|error| format!("The pack is not a valid zip file: {error}"))?;
    if archive.len() > MAX_ZIP_ENTRIES { return Err("The pack zip contains too many files.".into()); }
    let prefix = archive.file_names()
        .filter(|name| *name == MANIFEST || (name.ends_with("/manifest.json") && name.matches('/').count() == 1))
        .min_by_key(|name| name.len())
        .map(|name| name.trim_end_matches(MANIFEST).to_string())
        .ok_or("The zip does not contain a manifest.json.")?;
    if prefix.starts_with('.') || prefix.contains("..") || prefix.starts_with('/') { return Err("The zip's folder name is not allowed.".into()); }
    let mut read_entry = |name: &str, limit: u64, label: &str| -> Result<Vec<u8>, String> {
        let entry = archive.by_name(name).map_err(|_| format!("The pack is missing {label}."))?;
        if !entry.is_file() || entry.unix_mode().is_some_and(|mode| mode & 0o170000 == 0o120000) { return Err(format!("{label} must be a regular file.")); }
        if entry.size() > limit { return Err(format!("{label} is larger than the {} KiB limit.", limit / 1024)); }
        read_capped(entry, limit, label)
    };
    let manifest = parse_manifest(&read_entry(&format!("{prefix}{MANIFEST}"), MAX_MANIFEST_BYTES, MANIFEST)?)?;
    stage(manifest, |relative| {
        let name = format!("{prefix}{}", relative.to_string_lossy());
        read_entry(&name, MAX_FILE_BYTES, &format!("'{}'", relative.display()))
    })
}

pub fn stage_source(source: &Path) -> Result<StagedPack, String> {
    let meta = fs::metadata(source).map_err(|_| "The selected sound pack does not exist.".to_string())?;
    if meta.is_dir() { return stage_folder(source); }
    if source.file_name().and_then(|name| name.to_str()) == Some(MANIFEST) {
        return stage_folder(source.parent().ok_or("The manifest has no folder.")?);
    }
    stage_zip(source)
}

/// Writes a staged pack into `packs/<id>` atomically: a hidden staging folder is filled, then renamed into place
/// (replacing an older copy of the same pack).
pub fn install(packs: &Path, staged: &StagedPack) -> Result<SoundPackInfo, String> {
    fs::create_dir_all(packs).map_err(|error| format!("Unable to create the sound pack folder: {error}"))?;
    let unique = format!("{}-{}", std::process::id(), COUNTER.fetch_add(1, Ordering::Relaxed));
    let staging = packs.join(format!(".staging-{unique}"));
    let result = (|| {
        fs::create_dir(&staging).map_err(|error| format!("Unable to install the pack: {error}"))?;
        let manifest = serde_json::to_vec_pretty(&staged.manifest).map_err(|error| error.to_string())?;
        fs::write(staging.join(MANIFEST), manifest).map_err(|error| format!("Unable to install the pack: {error}"))?;
        for (relative, bytes) in &staged.files {
            let target = staging.join(relative);
            if let Some(parent) = target.parent() { fs::create_dir_all(parent).map_err(|error| format!("Unable to install the pack: {error}"))?; }
            fs::write(&target, bytes).map_err(|error| format!("Unable to install the pack: {error}"))?;
        }
        let destination = packs.join(&staged.manifest.id);
        let old = packs.join(format!(".old-{unique}"));
        let replacing = destination.exists();
        if replacing { fs::rename(&destination, &old).map_err(|error| format!("Unable to replace the installed pack: {error}"))?; }
        if let Err(error) = fs::rename(&staging, &destination) {
            if replacing { let _ = fs::rename(&old, &destination); }
            return Err(format!("Unable to install the pack: {error}"));
        }
        if replacing { let _ = fs::remove_dir_all(&old); }
        Ok(())
    })();
    if result.is_err() { let _ = fs::remove_dir_all(&staging); }
    result?;
    let size = staged.files.iter().map(|(_, bytes)| bytes.len() as u64).sum();
    Ok(SoundPackInfo::from_manifest(&staged.manifest, size))
}

fn pack_dir(packs: &Path, id: &str) -> Result<PathBuf, String> {
    if !valid_pack_id(id) { return Err("Invalid sound pack id.".into()); }
    Ok(packs.join(id))
}

pub fn list(packs: &Path) -> Vec<SoundPackInfo> {
    let Ok(entries) = fs::read_dir(packs) else { return Vec::new() };
    let mut out: Vec<SoundPackInfo> = entries.flatten()
        .filter(|entry| entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false))
        .filter_map(|entry| {
            let name = entry.file_name().to_str()?.to_string();
            if !valid_pack_id(&name) { return None; }
            let staged = stage_folder(&entry.path()).ok()?;
            (staged.manifest.id == name).then(|| SoundPackInfo::from_manifest(&staged.manifest, staged.files.iter().map(|(_, bytes)| bytes.len() as u64).sum()))
        })
        .collect();
    out.sort_by_key(|a| a.name.to_lowercase());
    out
}

/// The bytes of one event's sound, re-validated on every read.
pub fn read_event(packs: &Path, id: &str, event: &str) -> Result<(Vec<u8>, &'static str), String> {
    let folder = pack_dir(packs, id)?;
    let staged = stage_folder(&folder)?;
    let file = staged.manifest.sounds.get(event).ok_or_else(|| format!("This pack has no '{event}' sound."))?;
    let relative = safe_relative(file)?;
    let bytes = staged.files.into_iter().find(|(path, _)| *path == relative).map(|(_, bytes)| bytes).ok_or("The sound file is missing.")?;
    Ok((bytes, mime_for(&relative)))
}

pub fn remove(packs: &Path, id: &str) -> Result<(), String> {
    let folder = pack_dir(packs, id)?;
    if !fs::symlink_metadata(&folder).map(|meta| meta.is_dir()).unwrap_or(false) { return Err("That sound pack is not installed.".into()); }
    fs::remove_dir_all(&folder).map_err(|error| format!("Unable to remove the pack: {error}"))
}

/// Writes the pack as a zip (manifest at the root) that `import` accepts back.
pub fn export(packs: &Path, id: &str, destination: &Path) -> Result<(), String> {
    let staged = stage_folder(&pack_dir(packs, id)?)?;
    let parent = destination.parent().filter(|path| path.is_dir()).ok_or("Choose a folder that exists.")?;
    let temp = parent.join(format!(".mochi-pack-{}-{}.tmp", std::process::id(), COUNTER.fetch_add(1, Ordering::Relaxed)));
    let result = (|| {
        let file = fs::File::create(&temp).map_err(|error| format!("Unable to write the zip: {error}"))?;
        let mut zip = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated).unix_permissions(0o644);
        let manifest = serde_json::to_vec_pretty(&staged.manifest).map_err(|error| error.to_string())?;
        zip.start_file(MANIFEST, options).map_err(|error| error.to_string())?;
        zip.write_all(&manifest).map_err(|error| error.to_string())?;
        for (relative, bytes) in &staged.files {
            let name = relative.components().filter_map(|part| part.as_os_str().to_str()).collect::<Vec<_>>().join("/");
            zip.start_file(name, options).map_err(|error| error.to_string())?;
            zip.write_all(bytes).map_err(|error| error.to_string())?;
        }
        zip.finish().map_err(|error| format!("Unable to write the zip: {error}"))?;
        fs::rename(&temp, destination).map_err(|error| format!("Unable to save the zip: {error}"))
    })();
    if result.is_err() { let _ = fs::remove_file(&temp); }
    result
}

fn packs_root(app: &AppHandle) -> Result<PathBuf, String> { Ok(crate::themes::config_dir(app)?.join(PACKS_DIR)) }

#[tauri::command(async)]
pub fn list_sound_packs(app: AppHandle) -> Result<Vec<SoundPackInfo>, String> { Ok(list(&packs_root(&app)?)) }

#[tauri::command(async)]
pub fn import_sound_pack(app: AppHandle, source_path: String) -> Result<SoundPackInfo, String> {
    let staged = stage_source(Path::new(&source_path))?;
    install(&packs_root(&app)?, &staged)
}

#[tauri::command(async)]
pub fn remove_sound_pack(app: AppHandle, id: String) -> Result<(), String> { remove(&packs_root(&app)?, &id) }

#[tauri::command(async)]
pub fn export_sound_pack(app: AppHandle, id: String, destination: String) -> Result<(), String> {
    let mut destination = PathBuf::from(destination);
    if !destination.is_absolute() { return Err("Choose where to save the pack.".into()); }
    if destination.extension().and_then(|value| value.to_str()).map(str::to_ascii_lowercase).as_deref() != Some("zip") { destination.set_extension("zip"); }
    export(&packs_root(&app)?, &id, &destination)
}

/// Raw bytes (an ArrayBuffer on the JS side) so sounds never round-trip through JSON.
#[tauri::command(async)]
pub fn read_sound_pack_file(app: AppHandle, id: String, event: String) -> Result<tauri::ipc::Response, String> {
    let (bytes, _) = read_event(&packs_root(&app)?, &id, &event)?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    static DIRS: AtomicU64 = AtomicU64::new(0);
    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mochi-sounds-{name}-{}-{}", std::process::id(), DIRS.fetch_add(1, Ordering::Relaxed)));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }
    fn wav() -> Vec<u8> { let mut bytes = b"RIFF\x24\0\0\0WAVEfmt ".to_vec(); bytes.extend_from_slice(&[0; 32]); bytes }
    fn manifest(sounds: &[(&str, &str)]) -> String {
        let sounds: BTreeMap<String, String> = sounds.iter().map(|(a, b)| (a.to_string(), b.to_string())).collect();
        serde_json::json!({ "schemaVersion": 1, "id": "soft-clicks", "name": "Soft clicks", "sounds": sounds }).to_string()
    }

    #[test]
    fn validates_manifests() {
        assert!(parse_manifest(manifest(&[("select", "select.wav")]).as_bytes()).is_ok());
        assert!(parse_manifest(manifest(&[("selekt", "a.wav")]).as_bytes()).unwrap_err().contains("Unknown sound event"));
        assert!(parse_manifest(manifest(&[("select", "../a.wav")]).as_bytes()).is_err());
        assert!(parse_manifest(manifest(&[("select", "/etc/a.wav")]).as_bytes()).is_err());
        assert!(parse_manifest(manifest(&[("select", "a.exe")]).as_bytes()).is_err());
        assert!(parse_manifest(manifest(&[("select", ".hidden.wav")]).as_bytes()).is_err());
        assert!(parse_manifest(manifest(&[]).as_bytes()).is_err());
        let reserved = serde_json::json!({ "schemaVersion": 1, "id": "mochi", "name": "x", "sounds": { "select": "a.wav" } }).to_string();
        assert!(parse_manifest(reserved.as_bytes()).unwrap_err().contains("reserved"));
        let loud = serde_json::json!({ "schemaVersion": 1, "id": "a", "name": "x", "volume": 3.0, "sounds": { "select": "a.wav" } }).to_string();
        assert!(parse_manifest(loud.as_bytes()).is_err());
        assert!(parse_manifest(b"{not json").is_err());
        assert_eq!(safe_relative("./sfx/a.OGG").unwrap(), PathBuf::from("sfx/a.OGG"));
    }

    #[test]
    fn recognises_audio_signatures() {
        assert!(looks_like_audio(&wav()));
        assert!(looks_like_audio(b"OggS\0\x02"));
        assert!(looks_like_audio(b"ID3\x04"));
        assert!(looks_like_audio(&[0xFF, 0xFB, 0x90]));
        assert!(!looks_like_audio(b"#!/bin/sh"));
        assert!(!looks_like_audio(b""));
    }

    #[test]
    fn folder_round_trip_install_export_import_remove() {
        let source = temp_dir("src");
        fs::write(source.join(MANIFEST), manifest(&[("select", "select.wav"), ("back", "sfx/back.wav")])).unwrap();
        fs::write(source.join("select.wav"), wav()).unwrap();
        fs::create_dir(source.join("sfx")).unwrap();
        fs::write(source.join("sfx/back.wav"), wav()).unwrap();
        fs::write(source.join("ignored.txt"), b"not copied").unwrap();
        let packs = temp_dir("packs");
        let info = install(&packs, &stage_source(&source).unwrap()).unwrap();
        assert_eq!(info.id, "soft-clicks");
        assert!(!packs.join("soft-clicks/ignored.txt").exists());
        assert_eq!(list(&packs).len(), 1);
        assert_eq!(read_event(&packs, "soft-clicks", "back").unwrap().0, wav());
        assert!(read_event(&packs, "soft-clicks", "launch").is_err());
        assert!(read_event(&packs, "../x", "back").is_err());

        // Installing again replaces the pack in place.
        install(&packs, &stage_source(&source).unwrap()).unwrap();
        assert_eq!(fs::read_dir(&packs).unwrap().count(), 1);

        let out = temp_dir("out").join("pack.zip");
        export(&packs, "soft-clicks", &out).unwrap();
        remove(&packs, "soft-clicks").unwrap();
        assert!(list(&packs).is_empty());
        let again = install(&packs, &stage_source(&out).unwrap()).unwrap();
        assert_eq!(again.events, vec!["back".to_string(), "select".to_string()]);
        assert!(remove(&packs, "missing").is_err());
    }

    #[test]
    fn rejects_bad_folder_packs() {
        let source = temp_dir("bad");
        fs::write(source.join(MANIFEST), manifest(&[("select", "select.wav")])).unwrap();
        fs::write(source.join("select.wav"), b"#!/bin/sh\necho hi").unwrap();
        assert!(stage_source(&source).unwrap_err().contains("not a WAV"));
        fs::write(source.join("select.wav"), vec![0u8; (MAX_FILE_BYTES + 1) as usize]).unwrap();
        assert!(stage_source(&source).unwrap_err().contains("limit"));
        #[cfg(unix)]
        {
            fs::remove_file(source.join("select.wav")).unwrap();
            let outside = temp_dir("outside").join("x.wav");
            fs::write(&outside, wav()).unwrap();
            std::os::unix::fs::symlink(&outside, source.join("select.wav")).unwrap();
            assert!(stage_source(&source).unwrap_err().contains("regular file"));
        }
    }

    #[test]
    fn zip_in_a_folder_and_traversal_names_are_ignored() {
        let dir = temp_dir("zip");
        let path = dir.join("pack.zip");
        let mut zip = zip::ZipWriter::new(fs::File::create(&path).unwrap());
        let options = zip::write::SimpleFileOptions::default();
        zip.start_file("Soft Clicks/manifest.json", options).unwrap();
        zip.write_all(manifest(&[("select", "select.wav")]).as_bytes()).unwrap();
        zip.start_file("Soft Clicks/select.wav", options).unwrap();
        zip.write_all(&wav()).unwrap();
        zip.start_file("../../evil.wav", options).unwrap();
        zip.write_all(&wav()).unwrap();
        zip.finish().unwrap();
        let packs = dir.join("packs");
        install(&packs, &stage_source(&path).unwrap()).unwrap();
        assert!(packs.join("soft-clicks/select.wav").is_file());
        assert!(!dir.join("evil.wav").exists() && !packs.join("evil.wav").exists());

        let missing = dir.join("missing.zip");
        let mut zip = zip::ZipWriter::new(fs::File::create(&missing).unwrap());
        zip.start_file("manifest.json", options).unwrap();
        zip.write_all(manifest(&[("select", "nope.wav")]).as_bytes()).unwrap();
        zip.finish().unwrap();
        assert!(stage_source(&missing).unwrap_err().contains("missing"));
        assert!(stage_source(&dir.join("absent.zip")).is_err());
    }
}
