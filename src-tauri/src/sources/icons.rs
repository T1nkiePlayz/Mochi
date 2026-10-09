//! Finds the icon a desktop entry or app bundle names, so imported games without metadata
//! can still show their own picture. Pure path logic, unit-tested with fixture folders.

use std::path::{Path, PathBuf};

/// Icons larger than this are not used (real icons are a few hundred kB at most).
pub const MAX_ICON_BYTES: u64 = 4 * 1024 * 1024;
/// Formats Mochi can turn into a cover (XPM is not supported by the decoder and is skipped).
const ICON_EXTENSIONS: [&str; 6] = ["png", "svg", "jpg", "jpeg", "webp", "icns"];
/// Raster sizes tried first (big enough for a cover), then scalable, then smaller ones.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
const LARGE_SIZES: [&str; 2] = ["512x512", "256x256"];
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
const SMALL_SIZES: [&str; 7] = ["192x192", "128x128", "96x96", "72x72", "64x64", "48x48", "32x32"];
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
const MAX_THEMES: usize = 24;

fn extension(path: &Path) -> Option<String> { path.extension().and_then(|ext| ext.to_str()).map(str::to_ascii_lowercase) }

/// A readable icon file of a supported type and size.
pub fn usable_icon(path: &Path) -> bool {
    extension(path).is_some_and(|ext| ICON_EXTENSIONS.contains(&ext.as_str()))
        && path.metadata().is_ok_and(|meta| meta.is_file() && meta.len() > 0 && meta.len() <= MAX_ICON_BYTES)
}

/// `$XDG_DATA_HOME`, `$XDG_DATA_DIRS` (or its default) and the Flatpak/Snap export folders, in lookup order.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub fn data_dirs(home: &Path) -> Vec<PathBuf> {
    let mut dirs = vec![std::env::var_os("XDG_DATA_HOME").map(PathBuf::from).filter(|dir| dir.is_absolute()).unwrap_or_else(|| home.join(".local/share"))];
    dirs.push(home.join(".local/share/flatpak/exports/share"));
    match std::env::var_os("XDG_DATA_DIRS").filter(|value| !value.is_empty()) {
        Some(value) => dirs.extend(std::env::split_paths(&value).filter(|dir| dir.is_absolute())),
        None => dirs.extend([PathBuf::from("/usr/local/share"), PathBuf::from("/usr/share")]),
    }
    dirs.extend([PathBuf::from("/var/lib/flatpak/exports/share"), PathBuf::from("/var/lib/snapd/desktop")]);
    let mut seen = std::collections::HashSet::new();
    dirs.retain(|dir| seen.insert(dir.clone()));
    dirs
}

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn in_theme(theme: &Path, name: &str, sizes: &[&str], out: &mut Vec<PathBuf>) {
    for size in sizes {
        for ext in ["png", "svg"] {
            out.push(theme.join(size).join("apps").join(format!("{name}.{ext}")));
            // Breeze-style layout: apps/<size>/name.
            out.push(theme.join("apps").join(size.split('x').next().unwrap_or(size)).join(format!("{name}.{ext}")));
        }
    }
}

/// Resolves a desktop entry's `Icon=` value: an absolute path, or an icon name looked up in
/// hicolor (big PNG, then scalable SVG, then smaller PNGs), other installed themes, then pixmaps.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub fn resolve_icon(value: &str, dirs: &[PathBuf]) -> Option<PathBuf> {
    let value = value.trim();
    if value.is_empty() { return None; }
    if value.starts_with('/') {
        let path = PathBuf::from(value);
        return usable_icon(&path).then_some(path);
    }
    if value.contains('/') || value.contains("..") { return None; }
    let name = ["png", "svg", "xpm"].iter().find_map(|ext| value.strip_suffix(&format!(".{ext}"))).unwrap_or(value);
    let first = |candidates: Vec<PathBuf>| candidates.into_iter().find(|path| usable_icon(path));

    let hicolor: Vec<PathBuf> = dirs.iter().map(|dir| dir.join("icons/hicolor")).filter(|dir| dir.is_dir()).collect();
    let mut large = Vec::new();
    hicolor.iter().for_each(|theme| in_theme(theme, name, &LARGE_SIZES, &mut large));
    hicolor.iter().for_each(|theme| large.push(theme.join("scalable/apps").join(format!("{name}.svg"))));
    if let Some(found) = first(large) { return Some(found); }
    let mut small = Vec::new();
    hicolor.iter().for_each(|theme| in_theme(theme, name, &SMALL_SIZES, &mut small));
    if let Some(found) = first(small) { return Some(found); }

    // Other themes (Papirus, Adwaita, breeze...) only when hicolor has nothing.
    let mut others = Vec::new();
    for dir in dirs {
        let Ok(entries) = std::fs::read_dir(dir.join("icons")) else { continue };
        for theme in entries.flatten().map(|entry| entry.path()).filter(|path| path.is_dir() && !path.ends_with("hicolor")).take(MAX_THEMES) {
            in_theme(&theme, name, &LARGE_SIZES, &mut others);
            others.push(theme.join("scalable/apps").join(format!("{name}.svg")));
            others.push(theme.join("apps/scalable").join(format!("{name}.svg")));
            in_theme(&theme, name, &SMALL_SIZES, &mut others);
        }
    }
    if let Some(found) = first(others) { return Some(found); }

    let mut pixmaps = Vec::new();
    for dir in dirs { for ext in ["png", "svg"] { pixmaps.push(dir.join("pixmaps").join(format!("{name}.{ext}"))); } }
    first(pixmaps)
}

/// The largest PNG image inside an Apple `.icns` file (modern icon sizes are stored as PNG).
pub fn icns_largest_png(bytes: &[u8]) -> Option<&[u8]> {
    if bytes.len() < 8 || &bytes[..4] != b"icns" { return None; }
    let total = (u32::from_be_bytes(bytes[4..8].try_into().ok()?) as usize).min(bytes.len());
    let mut offset = 8;
    let mut best: Option<&[u8]> = None;
    while offset + 8 <= total {
        let length = u32::from_be_bytes(bytes[offset + 4..offset + 8].try_into().ok()?) as usize;
        if length < 8 || offset + length > total { break; }
        let data = &bytes[offset + 8..offset + length];
        if data.starts_with(&[0x89, b'P', b'N', b'G']) && best.is_none_or(|current| data.len() > current.len()) { best = Some(data); }
        offset += length;
    }
    best
}

/// The icon file a macOS bundle declares (`CFBundleIconFile`, with or without its `.icns` extension).
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn bundle_icon(bundle: &Path, icon_file: Option<&str>) -> Option<PathBuf> {
    let name = icon_file?.trim();
    if name.is_empty() || name.contains('/') || name.contains("..") { return None; }
    let resources = bundle.join("Contents/Resources");
    let path = if Path::new(name).extension().is_some() { resources.join(name) } else { resources.join(format!("{name}.icns")) };
    usable_icon(&path).then_some(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sources::testutil::temp_dir;
    use std::fs;

    fn touch(path: &Path) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, b"\x89PNG data").unwrap();
    }

    #[test]
    fn names_resolve_to_the_best_hicolor_size_across_data_dirs() {
        let user = temp_dir("icons-user");
        let system = temp_dir("icons-system");
        touch(&user.join("icons/hicolor/48x48/apps/supertux.png"));
        touch(&system.join("icons/hicolor/256x256/apps/supertux.png"));
        touch(&system.join("icons/hicolor/scalable/apps/xonotic.svg"));
        touch(&system.join("icons/hicolor/32x32/apps/xonotic.png"));
        touch(&system.join("icons/hicolor/64x64/apps/tiny.png"));
        let dirs = [user.clone(), system.clone()];
        assert_eq!(resolve_icon("supertux", &dirs), Some(system.join("icons/hicolor/256x256/apps/supertux.png")));
        assert_eq!(resolve_icon("xonotic.svg", &dirs), Some(system.join("icons/hicolor/scalable/apps/xonotic.svg")));
        assert_eq!(resolve_icon("tiny", &dirs), Some(system.join("icons/hicolor/64x64/apps/tiny.png")));
        for dir in [user, system] { let _ = fs::remove_dir_all(dir); }
    }

    #[test]
    fn other_themes_pixmaps_and_absolute_paths_are_used() {
        let root = temp_dir("icons-other");
        touch(&root.join("icons/Papirus/64x64/apps/game-a.svg"));
        touch(&root.join("icons/Papirus/apps/48/game-b.png"));
        touch(&root.join("icons/breeze/apps/scalable/game-c.svg"));
        touch(&root.join("pixmaps/game-d.png"));
        touch(&root.join("pixmaps/game-e.xpm"));
        touch(&root.join("abs/My Game.png"));
        let dirs = [root.clone()];
        assert_eq!(resolve_icon("game-a", &dirs), Some(root.join("icons/Papirus/64x64/apps/game-a.svg")));
        assert_eq!(resolve_icon("game-b", &dirs), Some(root.join("icons/Papirus/apps/48/game-b.png")));
        assert_eq!(resolve_icon("game-c", &dirs), Some(root.join("icons/breeze/apps/scalable/game-c.svg")));
        assert_eq!(resolve_icon("game-d", &dirs), Some(root.join("pixmaps/game-d.png")));
        assert_eq!(resolve_icon("game-e", &dirs), None, "xpm is not supported");
        let absolute = root.join("abs/My Game.png");
        assert_eq!(resolve_icon(absolute.to_str().unwrap(), &dirs), Some(absolute));
        assert_eq!(resolve_icon("../etc/passwd", &dirs), None);
        assert_eq!(resolve_icon("sub/dir", &dirs), None);
        assert_eq!(resolve_icon("  ", &dirs), None);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn oversized_and_empty_icons_are_skipped() {
        let root = temp_dir("icons-size");
        let big = root.join("icons/hicolor/256x256/apps/big.png");
        touch(&big);
        fs::File::create(&big).unwrap().set_len(MAX_ICON_BYTES + 1).unwrap();
        fs::create_dir_all(root.join("icons/hicolor/48x48/apps")).unwrap();
        fs::write(root.join("icons/hicolor/48x48/apps/big.png"), b"").unwrap();
        assert_eq!(resolve_icon("big", std::slice::from_ref(&root)), None);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn icns_containers_yield_their_largest_png() {
        let entry = |kind: &[u8], data: &[u8]| { let mut out = kind.to_vec(); out.extend(((data.len() + 8) as u32).to_be_bytes()); out.extend(data); out };
        let small = [&[0x89, b'P', b'N', b'G'][..], b"small"].concat();
        let large = [&[0x89, b'P', b'N', b'G'][..], b"much larger image"].concat();
        let body = [entry(b"ic07", &small), entry(b"is32", b"rawbits-not-png"), entry(b"ic10", &large)].concat();
        let mut file = b"icns".to_vec();
        file.extend(((body.len() + 8) as u32).to_be_bytes());
        file.extend(&body);
        assert_eq!(icns_largest_png(&file), Some(&large[..]));
        assert_eq!(icns_largest_png(b"nope"), None);
        // A truncated entry stops the walk instead of reading past the end.
        let mut broken = file.clone();
        broken.truncate(30);
        assert!(icns_largest_png(&broken).is_none_or(|png| png == &small[..]));
    }

    #[test]
    fn bundle_icons_are_found_with_or_without_extension() {
        let bundle = temp_dir("icons-bundle").join("Game.app");
        touch(&bundle.join("Contents/Resources/AppIcon.icns"));
        assert_eq!(bundle_icon(&bundle, Some("AppIcon")), Some(bundle.join("Contents/Resources/AppIcon.icns")));
        assert_eq!(bundle_icon(&bundle, Some("AppIcon.icns")), Some(bundle.join("Contents/Resources/AppIcon.icns")));
        assert_eq!(bundle_icon(&bundle, Some("../x")), None);
        assert_eq!(bundle_icon(&bundle, None), None);
        let _ = fs::remove_dir_all(bundle.parent().unwrap());
    }
}
