//! Portable settings export: a zip with `manifest.json`, one JSON file per settings section and an optional
//! `themes/` folder. Reading is strict: bounded entry count and size, only expected file names, no traversal.
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::{
    collections::BTreeMap,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};
use tauri::AppHandle;
use crate::themes::{parse_manifest, safe_relative_path, themes_dir, valid_id, MAX_MANIFEST_BYTES, MAX_THEME_ASSETS, MAX_THEME_ASSET_BYTES};

const FORMAT: &str = "mochi-settings";
const VERSION: u64 = 1;
const MANIFEST: &str = "manifest.json";
const THEMES_PREFIX: &str = "themes/";
const MAX_ENTRIES: usize = 2_000;
const MAX_TOTAL_BYTES: u64 = 50 * 1024 * 1024;
const MAX_SECTION_BYTES: u64 = 8 * 1024 * 1024;
/// The only sections an archive may hold (a file named anything else is rejected, so nothing unexpected is ever read).
const SECTIONS: &[&str] = &["behavior", "appearance", "sound", "controller", "accessibility", "collections", "wishlist", "launcherOverrides", "games"];
static COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeEntry { pub id: String, pub name: String, pub version: String, pub standalone: bool }

#[derive(Debug, Serialize)]
pub struct SettingsArchive { pub manifest: Value, pub sections: Map<String, Value>, pub themes: Vec<ThemeEntry> }

#[derive(Debug, Serialize)]
pub struct ThemeInstallResult { pub installed: Vec<String>, pub skipped: Vec<String> }

fn iso_utc(secs: u64) -> String {
    let (days, rem) = (secs / 86_400, secs % 86_400);
    let z = days as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!("{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z", rem / 3_600, rem % 3_600 / 60, rem % 60)
}

fn read_capped(reader: impl Read, limit: u64, label: &str) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    reader.take(limit + 1).read_to_end(&mut bytes).map_err(|error| format!("Unable to read {label}: {error}"))?;
    if bytes.len() as u64 > limit { return Err(format!("{label} is larger than the {} KiB limit.", limit / 1024)); }
    Ok(bytes)
}

/// Files of every valid, installed user theme as (zip name, bytes). Symlinks and oversized sets are skipped or refused.
fn collect_theme_files(root: &Path) -> Result<Vec<(String, Vec<u8>)>, String> {
    let mut out = Vec::new();
    let mut total = 0u64;
    let Ok(entries) = fs::read_dir(root) else { return Ok(out) };
    let mut push = |name: String, bytes: Vec<u8>| -> Result<(), String> {
        total += bytes.len() as u64;
        if total > MAX_TOTAL_BYTES / 2 || out.len() >= MAX_ENTRIES / 2 { return Err("Your installed themes are too large to export. Turn off \"Installed themes\" and export again.".into()); }
        out.push((name, bytes));
        Ok(())
    };
    let mut paths: Vec<PathBuf> = entries.flatten().map(|entry| entry.path()).collect();
    paths.sort();
    for path in paths {
        let Ok(meta) = fs::symlink_metadata(&path) else { continue };
        let stem = path.file_stem().and_then(|name| name.to_str()).unwrap_or_default().to_owned();
        if meta.is_dir() {
            let Some(id) = path.file_name().and_then(|name| name.to_str()).map(str::to_owned) else { continue };
            let Ok(manifest_bytes) = fs::read(path.join("theme.json")).and_then(|b| if b.len() as u64 > MAX_MANIFEST_BYTES { Err(std::io::ErrorKind::InvalidData.into()) } else { Ok(b) }) else { continue };
            if !valid_id(&id) || parse_manifest(&manifest_bytes, &id).map(|m| m.id != id).unwrap_or(true) { continue; }
            collect_dir(&path, &format!("{THEMES_PREFIX}{id}"), 0, &mut push)?;
        } else if meta.is_file() && path.extension().and_then(|ext| ext.to_str()) == Some("json") && valid_id(&stem) {
            let Ok(bytes) = read_capped(fs::File::open(&path).map_err(|e| e.to_string())?, MAX_MANIFEST_BYTES, "a theme manifest") else { continue };
            if parse_manifest(&bytes, &stem).map(|m| m.id == stem).unwrap_or(false) { push(format!("{THEMES_PREFIX}{stem}.json"), bytes)?; }
        }
    }
    Ok(out)
}

fn collect_dir(dir: &Path, prefix: &str, depth: usize, push: &mut impl FnMut(String, Vec<u8>) -> Result<(), String>) -> Result<(), String> {
    if depth > 8 { return Ok(()); }
    let mut children: Vec<_> = fs::read_dir(dir).map_err(|error| format!("Unable to read a theme folder: {error}"))?.flatten().collect();
    children.sort_by_key(|entry| entry.file_name());
    for entry in children {
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else { continue };
        let Ok(kind) = entry.file_type() else { continue };
        if kind.is_symlink() { continue; }
        let zip_name = format!("{prefix}/{name}");
        if kind.is_dir() { collect_dir(&entry.path(), &zip_name, depth + 1, push)?; }
        else if kind.is_file() {
            let bytes = read_capped(fs::File::open(entry.path()).map_err(|e| e.to_string())?, MAX_THEME_ASSET_BYTES as u64, &format!("theme file '{name}'"))?;
            push(zip_name, bytes)?;
        }
    }
    Ok(())
}

/// Writes the archive atomically (temp file, then rename). `sections` maps allowlisted section names to JSON.
pub fn write_archive(path: &Path, sections: &Map<String, Value>, themes: &[(String, Vec<u8>)], app_version: &str, now: u64) -> Result<(), String> {
    for name in sections.keys() { if !SECTIONS.contains(&name.as_str()) { return Err(format!("Unknown settings section '{name}'.")); } }
    let parent = path.parent().filter(|dir| dir.is_dir()).ok_or("Choose a folder that exists.")?;
    let temp = parent.join(format!(".mochi-settings-{}-{}.tmp", std::process::id(), COUNTER.fetch_add(1, Ordering::Relaxed)));
    let result = (|| {
        let file = fs::File::create(&temp).map_err(|error| format!("Unable to write the zip: {error}"))?;
        let mut zip = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated).unix_permissions(0o644);
        let mut listed: Vec<String> = sections.keys().cloned().collect();
        if !themes.is_empty() { listed.push("themes".into()); }
        let manifest = json!({ "format": FORMAT, "version": VERSION, "createdAt": iso_utc(now), "appVersion": app_version, "sections": listed });
        let mut write = |name: &str, bytes: &[u8]| -> Result<(), String> {
            zip.start_file(name, options).map_err(|error| error.to_string())?;
            zip.write_all(bytes).map_err(|error| error.to_string())
        };
        write(MANIFEST, &serde_json::to_vec_pretty(&manifest).map_err(|e| e.to_string())?)?;
        for (name, value) in sections { write(&format!("{name}.json"), &serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?)?; }
        for (name, bytes) in themes { write(name, bytes)?; }
        zip.finish().map_err(|error| format!("Unable to write the zip: {error}"))?;
        fs::rename(&temp, path).map_err(|error| format!("Unable to save the zip: {error}"))
    })();
    if result.is_err() { let _ = fs::remove_file(&temp); }
    result
}

/// Zip-slip safe entry name: relative, no `..`, no backslash, no empty or dot segments.
fn safe_entry_name(raw: &str) -> Option<&str> {
    let name = raw.trim_end_matches('/');
    if name.is_empty() || raw.starts_with('/') || name.contains('\\') || name.contains('\0') || name.len() > 300 { return None; }
    if name.split('/').any(|part| part.is_empty() || part == "." || part == ".." || part.contains(':')) { return None; }
    Some(name)
}

enum Kind<'a> { Manifest, Section(&'a str), ThemeFile { id: &'a str, rel: &'a str }, ThemeStandalone(&'a str) }

fn classify(name: &str) -> Option<Kind<'_>> {
    if name == MANIFEST { return Some(Kind::Manifest); }
    if let Some(section) = name.strip_suffix(".json").filter(|s| SECTIONS.contains(s)) { return Some(Kind::Section(section)); }
    let rest = name.strip_prefix(THEMES_PREFIX)?;
    match rest.split_once('/') {
        None => rest.strip_suffix(".json").filter(|id| valid_id(id)).map(Kind::ThemeStandalone),
        Some((id, rel)) if valid_id(id) && safe_relative_path(rel).is_ok() => Some(Kind::ThemeFile { id, rel }),
        _ => None,
    }
}

/// Opens the archive and checks every entry against the limits before anything is parsed.
fn open_archive(path: &Path) -> Result<zip::ZipArchive<fs::File>, String> {
    let file = fs::File::open(path).map_err(|error| format!("Unable to open the file: {error}"))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|error| format!("This is not a valid zip file: {error}"))?;
    if archive.len() > MAX_ENTRIES { return Err("The file contains too many entries to be a Mochi settings export.".into()); }
    let mut total = 0u64;
    for index in 0..archive.len() {
        let entry = archive.by_index(index).map_err(|error| format!("The zip is damaged: {error}"))?;
        let raw = entry.name().to_owned();
        let name = safe_entry_name(&raw).ok_or_else(|| format!("The zip contains an unsafe path ('{raw}')."))?;
        if entry.is_dir() { continue; }
        if entry.unix_mode().is_some_and(|mode| mode & 0o170000 == 0o120000) { return Err(format!("'{name}' is a link, which is not allowed.")); }
        if classify(name).is_none() { return Err(format!("The zip contains an unexpected file ('{name}'). This is not a Mochi settings export.")); }
        total = total.saturating_add(entry.size());
        if total > MAX_TOTAL_BYTES { return Err("The zip is larger than the 50 MB limit once unpacked.".into()); }
    }
    Ok(archive)
}

pub fn read_archive(path: &Path) -> Result<SettingsArchive, String> {
    let mut archive = open_archive(path)?;
    let manifest_bytes = {
        let entry = archive.by_name(MANIFEST).map_err(|_| "This zip has no manifest.json, so it is not a Mochi settings export.".to_string())?;
        read_capped(entry, 64 * 1024, MANIFEST)?
    };
    let manifest: Value = serde_json::from_slice(&manifest_bytes).map_err(|_| "manifest.json is not valid JSON.".to_string())?;
    if manifest.get("format").and_then(Value::as_str) != Some(FORMAT) { return Err("This zip is not a Mochi settings export.".into()); }
    match manifest.get("version").and_then(Value::as_u64) {
        Some(version) if version == VERSION => {}
        Some(version) if version > VERSION => return Err("This export was made by a newer version of Mochi. Update Mochi to import it.".into()),
        _ => return Err("This export has an unsupported version.".into()),
    }
    let mut sections = Map::new();
    let mut found: BTreeMap<String, (bool, Option<Vec<u8>>)> = BTreeMap::new();
    let mut total = 0u64;
    for index in 0..archive.len() {
        let entry = archive.by_index(index).map_err(|error| format!("The zip is damaged: {error}"))?;
        if entry.is_dir() { continue; }
        let raw = entry.name().to_owned();
        let Some(name) = safe_entry_name(&raw) else { continue };
        match classify(name) {
            Some(Kind::Section(section)) => {
                let bytes = read_capped(entry, MAX_SECTION_BYTES, &format!("{section}.json"))?;
                total += bytes.len() as u64;
                let value: Value = serde_json::from_slice(&bytes).map_err(|_| format!("{section}.json is not valid JSON."))?;
                sections.insert(section.to_owned(), value);
            }
            Some(Kind::ThemeFile { id, rel: "theme.json" }) => {
                let bytes = read_capped(entry, MAX_MANIFEST_BYTES, "a theme manifest")?;
                found.insert(id.to_owned(), (false, Some(bytes)));
            }
            Some(Kind::ThemeStandalone(id)) => {
                let bytes = read_capped(entry, MAX_MANIFEST_BYTES, "a theme manifest")?;
                found.insert(id.to_owned(), (true, Some(bytes)));
            }
            _ => {}
        }
        if total > MAX_TOTAL_BYTES { return Err("The zip is larger than the 50 MB limit once unpacked.".into()); }
    }
    let mut themes = Vec::new();
    for (id, (standalone, bytes)) in found {
        // A theme that fails the normal theme validation is simply not offered.
        if let Ok(parsed) = parse_manifest(&bytes.unwrap_or_default(), &id) {
            if parsed.id == id { themes.push(ThemeEntry { id, name: parsed.name, version: parsed.version, standalone }); }
        }
    }
    Ok(SettingsArchive { manifest, sections, themes })
}

/// Installs the requested themes into `root`. Themes already installed are left alone (reported as skipped).
pub fn install_themes(path: &Path, root: &Path, ids: &[String]) -> Result<ThemeInstallResult, String> {
    let mut archive = open_archive(path)?;
    let available = read_archive(path)?.themes;
    let mut result = ThemeInstallResult { installed: Vec::new(), skipped: Vec::new() };
    fs::create_dir_all(root).map_err(|error| format!("Unable to create the themes folder: {error}"))?;
    for id in ids {
        let Some(theme) = available.iter().find(|theme| &theme.id == id) else { result.skipped.push(id.clone()); continue };
        let destination = if theme.standalone { root.join(format!("{id}.json")) } else { root.join(id) };
        if destination.exists() { result.skipped.push(id.clone()); continue; }
        let unique = format!("{}-{}", std::process::id(), COUNTER.fetch_add(1, Ordering::Relaxed));
        let staging = root.join(format!(".import-{unique}"));
        let outcome = (|| -> Result<(), String> {
            fs::create_dir(&staging).map_err(|error| format!("Unable to install theme '{id}': {error}"))?;
            let mut files = 0usize;
            let wanted: Vec<String> = (0..archive.len()).filter_map(|i| archive.by_index(i).ok().filter(|e| !e.is_dir()).map(|e| e.name().to_owned())).collect();
            for raw in wanted {
                let Some(name) = safe_entry_name(&raw) else { continue };
                let rel = match classify(name) {
                    Some(Kind::ThemeFile { id: owner, rel }) if owner == id => rel.to_owned(),
                    Some(Kind::ThemeStandalone(owner)) if owner == id => format!("{id}.json"),
                    _ => continue,
                };
                files += 1;
                if files > MAX_THEME_ASSETS + 8 { return Err(format!("Theme '{id}' contains too many files.")); }
                let entry = archive.by_name(&raw).map_err(|error| error.to_string())?;
                let bytes = read_capped(entry, MAX_THEME_ASSET_BYTES as u64, &format!("'{rel}'"))?;
                let target = staging.join(safe_relative_path(&rel)?);
                if let Some(parent) = target.parent() { fs::create_dir_all(parent).map_err(|error| error.to_string())?; }
                fs::write(&target, bytes).map_err(|error| format!("Unable to install theme '{id}': {error}"))?;
            }
            let source = if theme.standalone { staging.join(format!("{id}.json")) } else { staging.clone() };
            if !theme.standalone && !staging.join("theme.json").is_file() { return Err(format!("Theme '{id}' has no theme.json.")); }
            // rename (not copy) so a half-written theme never appears; fails if the destination appeared meanwhile.
            fs::rename(&source, &destination).map_err(|error| format!("Unable to install theme '{id}': {error}"))
        })();
        let _ = fs::remove_dir_all(&staging);
        outcome?;
        result.installed.push(id.clone());
    }
    Ok(result)
}

#[tauri::command]
pub async fn export_settings_zip(app: AppHandle, path: String, sections_json: String, include_themes: bool) -> Result<(), String> {
    let target = PathBuf::from(path);
    if !target.is_absolute() { return Err("Choose where to save the export.".into()); }
    let themes_root = if include_themes { Some(themes_dir(&app)?) } else { None };
    crate::util::blocking(move || {
        let sections: Map<String, Value> = match serde_json::from_str(&sections_json) { Ok(Value::Object(map)) => map, _ => return Err("The settings to export are not valid.".into()) };
        let themes = match &themes_root { Some(root) => collect_theme_files(root)?, None => Vec::new() };
        write_archive(&target, &sections, &themes, env!("CARGO_PKG_VERSION"), crate::util::now_secs())
    }).await?
}

#[tauri::command]
pub async fn read_settings_zip(path: String) -> Result<SettingsArchive, String> {
    crate::util::blocking(move || read_archive(Path::new(&path))).await?
}

#[tauri::command]
pub async fn install_themes_from_settings_zip(app: AppHandle, path: String, theme_ids: Vec<String>) -> Result<ThemeInstallResult, String> {
    let root = themes_dir(&app)?;
    crate::util::blocking(move || install_themes(Path::new(&path), &root, &theme_ids)).await?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mochi-settingszip-{name}-{}-{}", std::process::id(), COUNTER.fetch_add(1, Ordering::Relaxed)));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }
    fn theme_json(id: &str) -> Vec<u8> { format!(r#"{{"schemaVersion":1,"id":"{id}","name":"Theme {id}","version":"1"}}"#).into_bytes() }
    fn sections() -> Map<String, Value> {
        let mut map = Map::new();
        map.insert("behavior".into(), json!({ "keepOpen": false }));
        map.insert("wishlist".into(), json!([{ "id": "w1", "name": "Hades" }]));
        map
    }
    /// Builds an arbitrary zip for the hostile-input tests.
    fn raw_zip(path: &Path, entries: &[(&str, &[u8])]) {
        let mut zip = zip::ZipWriter::new(fs::File::create(path).unwrap());
        let options = zip::write::SimpleFileOptions::default();
        for (name, bytes) in entries { zip.start_file(*name, options).unwrap(); zip.write_all(bytes).unwrap(); }
        zip.finish().unwrap();
    }
    const GOOD_MANIFEST: &[u8] = br#"{"format":"mochi-settings","version":1}"#;

    #[test]
    fn iso_dates_are_formatted() {
        assert_eq!(iso_utc(0), "1970-01-01T00:00:00Z");
        assert_eq!(iso_utc(1_709_164_800 + 3_661), "2024-02-29T01:01:01Z");
    }

    #[test]
    fn round_trips_sections_and_themes() {
        let dir = temp_dir("roundtrip");
        let themes_src = dir.join("src-themes");
        fs::create_dir_all(themes_src.join("folder-theme/assets")).unwrap();
        fs::write(themes_src.join("folder-theme/theme.json"), theme_json("folder-theme")).unwrap();
        fs::write(themes_src.join("folder-theme/theme.css"), "body{}").unwrap();
        fs::write(themes_src.join("folder-theme/assets/a.png"), [1u8, 2, 3]).unwrap();
        fs::write(themes_src.join("solo.json"), theme_json("solo")).unwrap();
        fs::write(themes_src.join("broken.json"), "{nope").unwrap();
        let files = collect_theme_files(&themes_src).unwrap();
        let names: Vec<&str> = files.iter().map(|(n, _)| n.as_str()).collect();
        assert_eq!(names, ["themes/folder-theme/assets/a.png", "themes/folder-theme/theme.css", "themes/folder-theme/theme.json", "themes/solo.json"]);
        let zip_path = dir.join("out.zip");
        write_archive(&zip_path, &sections(), &files, "9.9.9", 0).unwrap();
        let read = read_archive(&zip_path).unwrap();
        assert_eq!(read.manifest["format"], "mochi-settings");
        assert_eq!(read.manifest["appVersion"], "9.9.9");
        assert_eq!(read.manifest["sections"], json!(["behavior", "wishlist", "themes"]));
        assert_eq!(read.sections["behavior"], json!({ "keepOpen": false }));
        assert_eq!(read.themes.len(), 2);
        let target = dir.join("installed");
        let result = install_themes(&zip_path, &target, &["folder-theme".into(), "solo".into(), "ghost".into()]).unwrap();
        assert_eq!(result.installed, ["folder-theme", "solo"]);
        assert_eq!(result.skipped, ["ghost"]);
        assert_eq!(fs::read(target.join("folder-theme/assets/a.png")).unwrap(), [1, 2, 3]);
        assert!(target.join("solo.json").is_file());
        // Installing again never overwrites.
        assert_eq!(install_themes(&zip_path, &target, &["solo".into()]).unwrap().skipped, ["solo"]);
        assert_eq!(fs::read_dir(&target).unwrap().count(), 2, "no staging leftovers");
    }

    #[test]
    fn rejects_traversal_and_unexpected_names() {
        let dir = temp_dir("slip");
        for bad in ["../evil.json", "themes/../../evil.json", "/abs.json", "themes\\x.json", "themes/a/../../b/theme.json"] {
            let path = dir.join("bad.zip");
            raw_zip(&path, &[(MANIFEST, GOOD_MANIFEST), (bad, b"{}")]);
            assert!(read_archive(&path).is_err(), "{bad}");
        }
        for odd in ["notes.txt", "tokens.json", "themes/x/../y.json", "themes/bad id/theme.json", "themes/a/b/../c"] {
            let path = dir.join("odd.zip");
            raw_zip(&path, &[(MANIFEST, GOOD_MANIFEST), (odd, b"{}")]);
            assert!(read_archive(&path).is_err(), "{odd}");
        }
        assert!(!dir.join("evil.json").exists());
    }

    #[test]
    fn enforces_manifest_format_and_version() {
        let dir = temp_dir("manifest");
        let cases: [(&[u8], &str); 4] = [
            (br#"{"format":"other","version":1}"#, "not a Mochi"),
            (br#"{"format":"mochi-settings","version":2}"#, "newer"),
            (br#"{"format":"mochi-settings","version":0}"#, "unsupported"),
            (b"garbage", "valid JSON"),
        ];
        for (manifest, expect) in cases {
            let path = dir.join("m.zip");
            raw_zip(&path, &[(MANIFEST, manifest)]);
            assert!(read_archive(&path).unwrap_err().contains(expect), "{expect}");
        }
        let path = dir.join("none.zip");
        raw_zip(&path, &[("behavior.json", b"{}")]);
        assert!(read_archive(&path).unwrap_err().contains("manifest"));
        assert!(read_archive(&dir.join("missing.zip")).is_err());
    }

    #[test]
    fn enforces_size_and_count_limits() {
        let dir = temp_dir("limits");
        let path = dir.join("big.zip");
        let huge = vec![b' '; (MAX_SECTION_BYTES + 1) as usize];
        raw_zip(&path, &[(MANIFEST, GOOD_MANIFEST), ("behavior.json", &huge)]);
        assert!(read_archive(&path).unwrap_err().contains("limit"));
        // Total uncompressed size across entries.
        let chunk = vec![0u8; 6 * 1024 * 1024];
        let names: Vec<String> = (0..10).map(|i| format!("themes/t{i}/theme.css")).collect();
        let mut entries: Vec<(&str, &[u8])> = vec![(MANIFEST, GOOD_MANIFEST)];
        for name in &names { entries.push((name, &chunk)); }
        raw_zip(&path, &entries);
        assert!(read_archive(&path).unwrap_err().contains("50 MB"));
        // Entry count.
        let many: Vec<String> = (0..MAX_ENTRIES + 1).map(|i| format!("themes/t/{i}")).collect();
        let mut entries: Vec<(&str, &[u8])> = vec![(MANIFEST, GOOD_MANIFEST)];
        for name in &many { entries.push((name, b"x")); }
        raw_zip(&path, &entries);
        assert!(read_archive(&path).unwrap_err().contains("too many"));
    }

    #[test]
    fn unknown_sections_are_not_written() {
        let dir = temp_dir("unknown");
        let mut map = sections();
        map.insert("tokens".into(), json!({}));
        assert!(write_archive(&dir.join("x.zip"), &map, &[], "1", 0).is_err());
        assert!(write_archive(&dir.join("missing-dir/x.zip"), &sections(), &[], "1", 0).is_err());
        assert!(!dir.join("x.zip").exists());
    }

    #[test]
    fn invalid_themes_are_not_offered_or_installed() {
        let dir = temp_dir("badtheme");
        let path = dir.join("t.zip");
        raw_zip(&path, &[(MANIFEST, GOOD_MANIFEST), ("themes/a/theme.json", &theme_json("other")), ("themes/b.json", br#"{"schemaVersion":9,"id":"b","name":"B","version":"1"}"#), ("themes/c/theme.json", &theme_json("c"))]);
        let read = read_archive(&path).unwrap();
        assert_eq!(read.themes.iter().map(|t| t.id.as_str()).collect::<Vec<_>>(), ["c"]);
        let root = dir.join("themes");
        let result = install_themes(&path, &root, &["a".into(), "b".into(), "c".into()]).unwrap();
        assert_eq!((result.installed, result.skipped), (vec!["c".to_string()], vec!["a".to_string(), "b".to_string()]));
    }

    #[test]
    fn macos_style_paths_work() {
        // The themes folder lives under "Application Support" on macOS: spaces must not matter.
        let dir = temp_dir("mac").join("Library").join("Application Support").join("Mochi");
        fs::create_dir_all(&dir).unwrap();
        let zip_path = dir.join("Mochi settings.zip");
        write_archive(&zip_path, &sections(), &[("themes/m.json".into(), theme_json("m"))], "1", 5).unwrap();
        let installed = install_themes(&zip_path, &dir.join("themes"), &["m".into()]).unwrap();
        assert_eq!(installed.installed, ["m"]);
    }
}
