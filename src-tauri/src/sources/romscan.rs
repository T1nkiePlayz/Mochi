//! Walks ROM folders into importable games: depth-limited, hidden entries skipped, multi-disc sets
//! collapsed (a `.m3u` hides the discs it lists, a `.cue` hides its `.bin` tracks) and region/revision
//! tags removed from the display name only.

use super::{
    emulators::{self, RomFolder, System},
    make, sort_games, ImportedGame,
};
use std::{
    collections::HashSet,
    fs,
    path::{Component, Path, PathBuf},
};

/// Folders below the configured one that are searched.
pub const MAX_DEPTH: usize = 6;
/// Files looked at per scan, so a mis-pointed folder (the home directory) cannot stall the import dialog.
const MAX_FILES: usize = 100_000;
const MAX_PLAYLIST_BYTES: u64 = 1024 * 1024;
const MAX_PLAYLISTS: usize = 5_000;

/// "Legend of Zelda, The (USA) (Rev 1) [!]" -> "The Legend of Zelda". Falls back to the raw name when
/// nothing but tags is left.
pub fn clean_title(stem: &str) -> String {
    let mut out = String::new();
    let mut depth = 0usize;
    for c in stem.chars() {
        match c {
            '(' | '[' | '{' => depth += 1,
            ')' | ']' | '}' => depth = depth.saturating_sub(1),
            c if depth == 0 => out.push(c),
            _ => {}
        }
    }
    if !out.contains(' ') { out = out.replace('_', " "); }
    let mut title = out.split_whitespace().collect::<Vec<_>>().join(" ");
    title = title.trim_matches(|c: char| c == '-' || c == ',' || c.is_whitespace()).to_owned();
    for article in ["The", "A", "An"] {
        if let Some(rest) = title.strip_suffix(&format!(", {article}")) { title = format!("{article} {rest}"); break; }
        // "Legend of Zelda, The - Link's Awakening" keeps the article in front of the first part.
        if let Some((head, tail)) = title.split_once(&format!(", {article} - ")) { title = format!("{article} {head} - {tail}"); break; }
    }
    if title.is_empty() { stem.trim().to_owned() } else { title }
}

fn lexical(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for part in path.components() {
        match part {
            Component::ParentDir => { out.pop(); }
            Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}

fn key(path: &Path) -> String { lexical(path).to_string_lossy().to_lowercase() }

/// Files a playlist or cue sheet names, resolved against its folder. Unreadable or oversized files name nothing.
pub fn referenced_files(path: &Path) -> Vec<PathBuf> {
    use std::io::Read;
    let Some(dir) = path.parent() else { return Vec::new() };
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    let mut bytes = Vec::new();
    if fs::File::open(path).and_then(|file| file.take(MAX_PLAYLIST_BYTES).read_to_end(&mut bytes)).is_err() { return Vec::new(); }
    let text = String::from_utf8_lossy(&bytes);
    let names: Vec<String> = match ext.as_str() {
        "m3u" => text.lines().map(|line| line.trim().trim_start_matches('\u{feff}')).filter(|line| !line.is_empty() && !line.starts_with('#')).map(str::to_owned).collect(),
        // FILE "Game (Track 1).bin" BINARY
        "cue" => text.lines().filter_map(|line| {
            let line = line.trim().trim_start_matches('\u{feff}');
            let rest = line.get(..4).filter(|head| head.eq_ignore_ascii_case("FILE"))?;
            let rest = line[rest.len()..].trim();
            match rest.strip_prefix('"') { Some(quoted) => quoted.split_once('"').map(|(name, _)| name.to_owned()), None => rest.split_whitespace().next().map(str::to_owned) }
        }).collect(),
        _ => Vec::new(),
    };
    names.into_iter().filter(|name| !name.contains('\0')).map(|name| { let name = name.replace('\\', "/"); if Path::new(&name).is_absolute() { PathBuf::from(name) } else { dir.join(name) } }).collect()
}

/// Every candidate file under `root` (hidden files and folders skipped, symlinked folders not followed).
fn walk(root: &Path, files: &mut Vec<PathBuf>) {
    let mut stack = vec![(root.to_path_buf(), 0usize)];
    while let Some((dir, depth)) = stack.pop() {
        let Ok(entries) = fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            if files.len() >= MAX_FILES { return; }
            if entry.file_name().to_string_lossy().starts_with('.') { continue; }
            let path = entry.path();
            let Ok(kind) = entry.file_type() else { continue };
            if kind.is_dir() { if depth < MAX_DEPTH { stack.push((path, depth + 1)); } }
            else if kind.is_file() || (kind.is_symlink() && path.is_file()) { files.push(path); }
        }
    }
}

/// The system for a file in a folder: the folder's own mapping, else (auto) a folder name between the file and
/// the root, else the only system with that extension.
fn system_for(file: &Path, root: &Path, mapped: &str) -> Option<&'static System> {
    let ext = file.extension()?.to_str()?.to_ascii_lowercase();
    if mapped != "auto" { return emulators::system(mapped).filter(|system| system.exts.contains(&ext.as_str())); }
    let relative = file.strip_prefix(root).unwrap_or(file);
    let folders: Vec<&str> = relative.parent().into_iter().flat_map(|dir| dir.components()).filter_map(|c| c.as_os_str().to_str()).collect();
    let named = folders.iter().rev().copied().chain(root.file_name().and_then(|n| n.to_str())).find_map(emulators::system_for_folder_name);
    match named {
        Some(system) if system.exts.contains(&ext.as_str()) => Some(system),
        Some(_) => None,
        None => emulators::system_for_extension(&ext),
    }
}

pub fn scan_folders(folders: &[RomFolder]) -> Vec<ImportedGame> {
    let mut found: Vec<(PathBuf, PathBuf, String)> = Vec::new();
    let mut seen = HashSet::new();
    for folder in folders {
        let root = PathBuf::from(&folder.path);
        let mut files = Vec::new();
        walk(&root, &mut files);
        for file in files { if seen.insert(key(&file)) { found.push((file, root.clone(), folder.system.clone())); } }
    }
    // Discs and tracks that a playlist or cue sheet already covers are not games of their own.
    let mut hidden: HashSet<String> = HashSet::new();
    let playlists = found.iter().filter(|(file, _, _)| matches!(file.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).as_deref(), Some("m3u" | "cue"))).take(MAX_PLAYLISTS);
    for (file, _, _) in playlists {
        let is_m3u = file.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("m3u"));
        for target in referenced_files(file) {
            if is_m3u { for track in referenced_files(&target) { hidden.insert(key(&track)); } }
            hidden.insert(key(&target));
        }
    }
    let games = found.into_iter().filter(|(file, _, _)| !hidden.contains(&key(file))).filter_map(|(file, root, mapped)| {
        let system = system_for(&file, &root, &mapped)?;
        let stem = file.file_stem()?.to_string_lossy().into_owned();
        // MAME takes the set name as a bare argument, so a leading dash would be read as an option.
        if system.id == "arcade" && stem.starts_with('-') { return None; }
        let target = emulators::make_target(system.id, &file);
        Some(make(format!("emulators:{}:{}", system.id, file.to_string_lossy()), clean_title(&stem), "emulators", target, None))
    }).collect();
    sort_games(games)
}

/// The configured ROM folders (the import source's scan).
pub fn scan_configured() -> Vec<ImportedGame> {
    let settings = emulators::settings_path().map(|path| emulators::load_settings(&path)).unwrap_or_default();
    scan_folders(&settings.folders)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sources::testutil::temp_dir;

    fn touch(path: &Path, text: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }

    fn folder(path: &Path, system: &str) -> RomFolder { RomFolder { path: path.to_string_lossy().into_owned(), system: system.into() } }

    fn names(games: &[ImportedGame]) -> Vec<&str> { games.iter().map(|g| g.name.as_str()).collect() }

    #[test]
    fn titles_lose_region_and_revision_tags_only() {
        for (raw, clean) in [
            ("Super Metroid (USA) [!]", "Super Metroid"),
            ("Legend of Zelda, The - A Link to the Past (USA) (Rev 1)", "The Legend of Zelda - A Link to the Past"),
            ("Pokemon - Red Version (USA, Europe) (SGB Enhanced)", "Pokemon - Red Version"),
            ("Final Fantasy VII (USA) (Disc 1)", "Final Fantasy VII"),
            ("Sonic_The_Hedgehog_(W)_[!]", "Sonic The Hedgehog"),
            ("Mario Kart 64 (Europe) (En,Fr,De) [T+Fre1.0]", "Mario Kart 64"),
            ("Legend of Zelda, The (USA)", "The Legend of Zelda"),
            ("sf2", "sf2"),
            ("(Unreleased) [b1]", "(Unreleased) [b1]"),
            ("Half-Life - Blue Shift", "Half-Life - Blue Shift"),
        ] { assert_eq!(clean_title(raw), clean, "{raw}"); }
    }

    #[test]
    fn m3u_hides_its_discs_and_cue_hides_its_tracks() {
        let root = temp_dir("rom-discs");
        let dir = root.join("PSX");
        touch(&dir.join("FF7 (USA).m3u"), "#EXTM3U\nFF7 (USA) (Disc 1).cue\r\nFF7 (USA) (Disc 2).cue\n");
        touch(&dir.join("FF7 (USA) (Disc 1).cue"), "FILE \"FF7 (USA) (Disc 1).bin\" BINARY\n  TRACK 01 MODE2/2352\n");
        touch(&dir.join("FF7 (USA) (Disc 1).bin"), "");
        touch(&dir.join("FF7 (USA) (Disc 2).cue"), "FILE \"FF7 (USA) (Disc 2) (Track 1).bin\" BINARY\nFILE \"FF7 (USA) (Disc 2) (Track 2).bin\" BINARY\n");
        touch(&dir.join("FF7 (USA) (Disc 2) (Track 1).bin"), "");
        touch(&dir.join("FF7 (USA) (Disc 2) (Track 2).bin"), "");
        touch(&dir.join("Crash (USA).cue"), "FILE \"crash (usa).BIN\" BINARY\n");
        touch(&dir.join("Crash (USA).bin"), "");
        touch(&dir.join("Loose.bin"), "");
        touch(&dir.join("Spyro.chd"), "");
        let games = scan_folders(&[folder(&root, "auto")]);
        assert_eq!(names(&games), ["Crash", "FF7", "Loose", "Spyro"]);
        let ff7 = games.iter().find(|g| g.name == "FF7").unwrap();
        assert!(ff7.launch_target.starts_with("mochi-emu://ps1?rom="));
        assert!(ff7.launch_target.contains("FF7%20%28USA%29.m3u"));
        assert!(games.iter().all(|g| g.source == "emulators" && g.id.starts_with("emulators:ps1:")));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn tree_scan_maps_systems_skips_hidden_and_respects_depth() {
        let root = temp_dir("rom-tree");
        touch(&root.join("Mario (USA).nes"), "");
        touch(&root.join("SNES/Metroid.sfc"), "");
        touch(&root.join("SNES/readme.txt"), "");
        touch(&root.join("Sega Genesis/Sonic.md"), "");
        touch(&root.join("GBA/deep/er/Advance.gba"), "");
        touch(&root.join("loose/ambiguous.iso"), "");
        touch(&root.join("loose/ambiguous2.zip"), "");
        touch(&root.join("N64/wrong.sfc"), "");
        touch(&root.join(".hidden/Secret.nes"), "");
        touch(&root.join(".Hidden.nes"), "");
        touch(&root.join("Arcade/-listxml.zip"), "");
        touch(&root.join("Arcade/sf2.zip"), "");
        let mut deep = root.join("far");
        for level in 0..=MAX_DEPTH + 1 { deep = deep.join(format!("d{level}")); }
        touch(&deep.join("TooDeep.nes"), "");
        let games = scan_folders(&[folder(&root, "auto"), folder(&root, "auto")]);
        assert_eq!(names(&games), ["Advance", "Mario", "Metroid", "sf2", "Sonic"]);
        let by = |name: &str| games.iter().find(|g| g.name == name).unwrap().launch_target.clone();
        assert!(by("Advance").starts_with("mochi-emu://gba?"));
        assert!(by("Sonic").starts_with("mochi-emu://genesis?"));
        // A folder mapped to one system takes only that system's extensions, archives included.
        let mapped = scan_folders(&[folder(&root.join("loose"), "arcade"), folder(&root.join("N64"), "n64")]);
        assert_eq!(names(&mapped), ["ambiguous2"]);
        assert!(mapped[0].launch_target.starts_with("mochi-emu://arcade?"));
        assert!(scan_folders(&[folder(&root.join("missing"), "auto")]).is_empty());
        let _ = fs::remove_dir_all(root);
    }
}
