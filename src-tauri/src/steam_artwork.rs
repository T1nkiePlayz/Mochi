//! Steam's own artwork on disk, imported into Mochi's artwork cache when the network copy cannot
//! be fetched (offline, rate limits, art the CDN does not serve). Steam keeps every store asset it
//! downloads under `<steam install>/appcache/librarycache` in two client generations of layouts,
//! and both are checked: current clients use one folder per app (`<appid>/library_600x900.jpg`),
//! older ones flat files named with the appid (`<appid>_library_600x900.jpg`). Files are only
//! read, never moved or deleted, and nothing here touches the network.

use crate::game_artwork::{cache_path, find_cached, sniff_image_extension, write_atomic};
use crate::steam_store::CDN;
use std::io::Read;
use std::{fs, path::{Path, PathBuf}};
use tauri::AppHandle;

/// Art names Steam writes, best first: the portrait library cover, then the header the store CDN
/// itself falls back to, then the remaining store art, so a game that only has a hero or logo in
/// its local cache still gets a real picture instead of a blank card.
const ART_NAMES: [&str; 6] = ["library_600x900", "header", "library_capsule", "library_header", "library_hero", "logo"];
/// Steam writes `.jpg` for most art and `.png` for logos; the cached file's type comes from the bytes.
const ART_EXTENSIONS: [&str; 2] = ["jpg", "png"];
/// Store art is a few hundred kB (heroes a couple of MB); anything larger is not a cover.
const MAX_ART_BYTES: u64 = 8 * 1024 * 1024;

/// An existing, non-empty art file within the size Mochi will read.
fn art_file(path: &Path) -> Option<PathBuf> {
    path.is_file().then(|| path.to_path_buf())
        .filter(|path| fs::metadata(path).is_ok_and(|meta| 0 < meta.len() && meta.len() <= MAX_ART_BYTES))
}

/// The best local art for `appid` inside one Steam install's `appcache/librarycache`, with the art
/// name it was found under (`None` when this install has nothing usable for the game).
fn art_in_cache(cache: &Path, appid: u32) -> Option<(PathBuf, &'static str)> {
    let folder = cache.join(appid.to_string());
    for name in ART_NAMES {
        for extension in ART_EXTENSIONS {
            // Current clients: one folder per app, plain names inside.
            if let Some(path) = art_file(&folder.join(format!("{name}.{extension}"))) { return Some((path, name)); }
            // Older clients: the same names prefixed with the appid, flat in the cache folder.
            if let Some(path) = art_file(&cache.join(format!("{appid}_{name}.{extension}"))) { return Some((path, name)); }
        }
    }
    None
}

/// The local art file for `appid` across every Steam install found (first install with art wins).
pub(crate) fn find_local_art(roots: &[PathBuf], appid: u32) -> Option<(PathBuf, &'static str)> {
    if appid == 0 { return None; }
    roots.iter().filter_map(|root| art_in_cache(&root.join("appcache").join("librarycache"), appid)).next()
}

/// The keyless store URL of the same art (`steam_store.rs` builds these for downloaded covers),
/// kept as the game's artwork URL so an online refresh finds the identical file.
fn steam_art_url(appid: u32, name: &str, source: &Path) -> String {
    let extension = source.extension().and_then(|ext| ext.to_str()).unwrap_or("jpg");
    format!("{CDN}/{appid}/{name}.{extension}")
}

/// Copies Steam's local art for `appid` into the artwork cache under `base` (the extension-less
/// cache path) and returns its store URL. Never overwrites a cover that is already cached, and
/// resolves to `None` when there is nothing to import. Pure disk work: no requests.
pub(crate) fn import_local_art(base: &Path, roots: &[PathBuf], appid: u32) -> Result<Option<String>, String> {
    if find_cached(base).is_some() { return Ok(None); }
    let Some((source, name)) = find_local_art(roots, appid) else { return Ok(None); };
    let mut bytes = Vec::new();
    fs::File::open(&source).map_err(|error| format!("Unable to read Steam's artwork file: {error}"))?
        .take(MAX_ART_BYTES + 1).read_to_end(&mut bytes).map_err(|error| format!("Unable to read Steam's artwork file: {error}"))?;
    if bytes.is_empty() || bytes.len() as u64 > MAX_ART_BYTES { return Ok(None); }
    // The bytes decide the cached type: Steam has been seen writing PNG data into `.jpg` names.
    let extension = sniff_image_extension(&bytes).ok_or("Steam's artwork file is not a supported image.")?;
    let target = base.with_extension(extension);
    write_atomic(&target, &bytes)?;
    for stale in ["jpg", "png", "webp"] { if stale != extension { let _ = fs::remove_file(base.with_extension(stale)); } }
    Ok(Some(steam_art_url(appid, name, &source)))
}

/// Copies the game's own artwork from the local Steam cache into Mochi's artwork cache.
/// Returns the store URL of the imported art, or `null` when nothing was imported (Steam has no
/// local art for this appid, or the game's cover is already cached). Offline by design.
#[tauri::command(async)]
pub async fn import_steam_artwork(app: AppHandle, appid: u32, cache_key: String) -> Result<Option<String>, String> {
    // The key is validated before any folder work, exactly as `cache_path` checks it.
    let base = cache_path(&app, &cache_key)?;
    let roots = crate::platform::home_dir().map(|home| crate::sources::steam_install_roots(&home)).unwrap_or_default();
    // Reading Steam's cache and writing the cover is disk work: off the async workers.
    crate::util::blocking(move || import_local_art(&base, &roots, appid)).await?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sources::testutil::temp_dir;

    fn write(path: &Path, bytes: &[u8]) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, bytes).unwrap();
    }

    const JPG: [u8; 5] = [0xff, 0xd8, 0xff, 0xe0, 0];
    const PNG: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];

    #[test]
    fn finds_art_in_the_per_app_folder_and_falls_back_through_art_types() {
        let root = temp_dir("steam-art-new");
        let cache = root.join("appcache/librarycache");
        write(&cache.join("620/library_600x900.jpg"), &JPG);
        write(&cache.join("620/header.jpg"), &JPG);
        write(&cache.join("621/header.jpg"), &JPG);
        write(&cache.join("622/logo.png"), &PNG);
        // Not usable art: an unrelated file and a folder Steam only fills with hashed thumbnails.
        write(&cache.join("623/markers.svg"), b"<svg/>");
        write(&cache.join("624/0ccf0dc0a8c4ec078db7ab99ddc820b2fa884441.jpg"), &JPG);
        let roots = [root.clone()];
        assert_eq!(find_local_art(&roots, 620).map(|(path, name)| (path.file_name().unwrap().to_owned(), name)),
            Some((std::ffi::OsString::from("library_600x900.jpg"), "library_600x900")));
        assert_eq!(find_local_art(&roots, 621).map(|(_, name)| name), Some("header"));
        assert_eq!(find_local_art(&roots, 622).map(|(_, name)| name), Some("logo"));
        assert!(find_local_art(&roots, 623).is_none());
        assert!(find_local_art(&roots, 624).is_none());
        assert!(find_local_art(&roots, 999).is_none());
        assert!(find_local_art(&roots, 0).is_none());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn finds_art_in_the_old_flat_layout() {
        let root = temp_dir("steam-art-flat");
        let cache = root.join("appcache/librarycache");
        write(&cache.join("440_header.jpg"), &JPG);
        write(&cache.join("441_library_600x900.jpg"), &JPG);
        write(&cache.join("441_header.jpg"), &JPG);
        write(&cache.join("442_logo.png"), &PNG);
        let roots = [root.clone()];
        assert_eq!(find_local_art(&roots, 440).map(|(_, name)| name), Some("header"));
        assert_eq!(find_local_art(&roots, 441).map(|(_, name)| name), Some("library_600x900"), "the cover wins over the header");
        assert_eq!(find_local_art(&roots, 442).map(|(_, name)| name), Some("logo"));
        assert!(find_local_art(&roots, 443).is_none());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn imports_local_art_once_and_reports_the_steam_url() {
        let root = temp_dir("steam-art-import");
        let cache = temp_dir("steam-art-cache");
        write(&root.join("appcache/librarycache/620/library_600x900.jpg"), &JPG);
        write(&root.join("appcache/librarycache/620/header.jpg"), &JPG);
        write(&root.join("appcache/librarycache/621/logo.png"), &PNG);
        let roots = [root.clone()];
        let base = cache.join("game1");
        assert_eq!(import_local_art(&base, &roots, 620).unwrap().as_deref(), Some(&format!("{CDN}/620/library_600x900.jpg")[..]));
        assert!(base.with_extension("jpg").is_file());
        // PNG bytes land in the cache as PNG, whatever the file on disk is called.
        assert_eq!(import_local_art(&cache.join("game2"), &roots, 621).unwrap().as_deref(), Some(&format!("{CDN}/621/logo.png")[..]));
        assert!(cache.join("game2.png").is_file() && !cache.join("game2.jpg").exists());
        assert!(cache.join("game1.jpg").is_file() && !cache.join("game1.png").exists());
        // The cover already in the cache is kept: a later import never replaces it.
        write(&root.join("appcache/librarycache/620/library_600x900.jpg"), &[0xff, 0xd8, 0xff, 0xe0, 9]);
        assert_eq!(import_local_art(&base, &roots, 620).unwrap(), None);
        assert_eq!(fs::read(base.with_extension("jpg")).unwrap()[4], 0);
        // Nothing to import for a game Steam has no art for.
        assert_eq!(import_local_art(&cache.join("game3"), &roots, 999).unwrap(), None);
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&cache);
    }
}
