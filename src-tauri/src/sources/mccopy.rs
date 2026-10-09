//! Copies a Minecraft launcher instance next to the original so Mochi can manage its mods without touching the
//! launcher's own instance. The copy lands in the same instances folder under a new folder name, so the launcher
//! finds it on its next start and `--launch <new id>` keeps working. The original is only ever read.

use super::prism::{ini_value, instance_target, instances_dir, parse_instance_target, read_instance, InstanceLauncher};
use super::read;
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

const MAX_FILES: usize = 500_000;
const MAX_DEPTH: usize = 40;
const MAX_COPY_NAMES: u32 = 999;

#[derive(Clone, Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CopiedInstance {
    pub launch_target: String,
    pub game_dir: String,
    pub install_path: String,
    pub name: String,
}

#[derive(Clone, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CopyProgress {
    pub target: String,
    pub copied_bytes: u64,
    pub total_bytes: u64,
    pub file: String,
}

enum Entry { Dir(PathBuf), File(PathBuf, u64) }

/// The folder of the instance a launch target names, found only inside a known launcher's instances folder.
pub(super) fn resolve(roots: &[(PathBuf, &'static InstanceLauncher)], target: &str) -> Result<(PathBuf, PathBuf, &'static InstanceLauncher, String), String> {
    let (launcher, id) = parse_instance_target(target).ok_or("That is not a Minecraft instance.")?;
    for (root, candidate) in roots.iter().filter(|(_, candidate)| candidate.id == launcher.id) {
        let parent = instances_dir(root, candidate);
        let dir = parent.join(&id);
        // A symlinked instance folder could lead anywhere: only real folders are copied.
        let Ok(meta) = fs::symlink_metadata(&dir) else { continue };
        if !meta.is_dir() || !dir.join("instance.cfg").is_file() { continue; }
        let inside = match (fs::canonicalize(&dir), fs::canonicalize(&parent)) { (Ok(dir), Ok(parent)) => dir.parent() == Some(parent.as_path()), _ => false };
        if !inside { return Err("That instance is not inside its launcher's instances folder.".into()); }
        return Ok((root.clone(), dir, candidate, id));
    }
    Err("Mochi could not find that instance in its launcher's instances folder.".into())
}

/// Every folder and file below `dir` (parents first) with sizes. Symlinks and special files are refused, never skipped.
fn plan(dir: &Path) -> Result<(Vec<Entry>, u64), String> {
    let mut entries = Vec::new();
    let mut total = 0u64;
    let mut stack = vec![(dir.to_path_buf(), 0usize)];
    while let Some((current, depth)) = stack.pop() {
        if depth > MAX_DEPTH { return Err(format!("{} is nested too deeply to copy.", current.display())); }
        for item in fs::read_dir(&current).map_err(|e| format!("Could not read {}: {e}", current.display()))? {
            let item = item.map_err(|e| format!("Could not read {}: {e}", current.display()))?;
            let path = item.path();
            let kind = item.file_type().map_err(|e| format!("Could not inspect {}: {e}", path.display()))?;
            if kind.is_symlink() { return Err(format!("{} is a symbolic link, which Mochi will not copy.", path.display())); }
            if kind.is_dir() { entries.push(Entry::Dir(path.clone())); stack.push((path, depth + 1)); }
            else if kind.is_file() {
                let size = item.metadata().map_err(|e| format!("Could not inspect {}: {e}", path.display()))?.len();
                total += size;
                entries.push(Entry::File(path, size));
            } else { return Err(format!("{} is not a regular file.", path.display())); }
            if entries.len() > MAX_FILES { return Err("This instance has too many files to copy.".into()); }
        }
    }
    Ok((entries, total))
}

/// Creates the first free `<base> (Mochi)`, `<base> (Mochi 2)`... folder next to the originals. Returns it and its suffix.
fn reserve(parent: &Path, base: &str) -> Result<(PathBuf, String), String> {
    for n in 1..=MAX_COPY_NAMES {
        let suffix = if n == 1 { "(Mochi)".to_owned() } else { format!("(Mochi {n})") };
        let path = parent.join(format!("{base} {suffix}"));
        match fs::create_dir(&path) {
            Ok(()) => return Ok((path, suffix)),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(format!("Could not create {}: {e}", path.display())),
        }
    }
    Err("Too many copies of this instance already exist.".into())
}

/// `instance.cfg` text with `name=` replaced (or added), leaving every other line as it was.
fn renamed_config(text: &str, name: &str) -> String {
    let mut done = false;
    let mut lines: Vec<String> = text.lines().map(|line| match line.split_once('=') {
        Some((key, _)) if !done && key.trim() == "name" => { done = true; format!("name={name}") }
        _ => line.to_owned(),
    }).collect();
    if !done { match lines.iter().position(|line| line.trim() == "[General]") { Some(at) => lines.insert(at + 1, format!("name={name}")), None => lines.insert(0, format!("name={name}")) } }
    lines.join("\n") + "\n"
}

fn copy_tree(source: &Path, dest: &Path, entries: &[Entry], total: u64, report: &mut dyn FnMut(u64, u64, &str)) -> Result<(), String> {
    let relative = |path: &Path| path.strip_prefix(source).map(Path::to_path_buf).map_err(|_| "A file was outside the instance.".to_owned());
    let mut copied = 0u64;
    let mut last = Instant::now();
    for entry in entries {
        match entry {
            Entry::Dir(path) => {
                let to = dest.join(relative(path)?);
                fs::create_dir_all(&to).map_err(|e| format!("Could not create {}: {e}", to.display()))?;
            }
            Entry::File(path, size) => {
                let rel = relative(path)?;
                // `instance.cfg` goes last, so a half-finished copy is never mistaken for an instance.
                if rel == Path::new("instance.cfg") { copied += size; continue; }
                let to = dest.join(&rel);
                // `fs::copy` streams the file and keeps its permissions.
                fs::copy(path, &to).map_err(|e| format!("Could not copy {}: {e}", path.display()))?;
                copied += size;
                if last.elapsed() >= Duration::from_millis(200) { last = Instant::now(); report(copied, total, &rel.to_string_lossy()); }
            }
        }
    }
    report(copied, total, "");
    Ok(())
}

pub fn copy_instance_in(roots: &[(PathBuf, &'static InstanceLauncher)], target: &str, report: &mut dyn FnMut(u64, u64, &str)) -> Result<CopiedInstance, String> {
    let (root, source, launcher, id) = resolve(roots, target)?;
    let parent = source.parent().ok_or("That instance has no parent folder.")?.to_path_buf();
    let (entries, total) = plan(&source)?;
    let config = read(&source.join("instance.cfg")).ok_or("Could not read the instance's settings.")?;
    let (dest, suffix) = reserve(&parent, &id)?;
    let result = (|| {
        copy_tree(&source, &dest, &entries, total, report)?;
        let name = format!("{} {suffix}", ini_value(&config, "name").unwrap_or_else(|| id.clone()));
        fs::copy(source.join("instance.cfg"), dest.join("instance.cfg")).map_err(|e| format!("Could not copy instance.cfg: {e}"))?;
        // Rewrite the copy's config (never the original's): a new name, same permissions as copied above.
        let text = read_whole(&dest.join("instance.cfg"))?;
        fs::write(dest.join("instance.cfg"), renamed_config(&text, &name)).map_err(|e| format!("Could not write instance.cfg: {e}"))?;
        let game = read_instance(&root, &dest, launcher).ok_or("The copy could not be read back as an instance.")?;
        let info = game.minecraft.ok_or("The copy has no game folder.")?;
        Ok(CopiedInstance { launch_target: instance_target(launcher.id, dest.file_name().and_then(|n| n.to_str()).unwrap_or_default()), game_dir: info.game_dir, install_path: dest.to_string_lossy().into_owned(), name: game.name })
    })();
    if result.is_err() { let _ = fs::remove_dir_all(&dest); }
    result
}

/// The scanned instance behind a launch target (version, loader, pack facts), for instances that were imported earlier.
pub fn read_target(home: &Path, target: &str) -> Result<super::ImportedGame, String> {
    let roots = super::instance_roots(home);
    let (root, dir, launcher, _) = resolve(&roots, target)?;
    read_instance(&root, &dir, launcher).ok_or_else(|| "That folder is not an instance.".to_string())
}

fn read_whole(path: &Path) -> Result<String, String> { fs::read_to_string(path).map_err(|e| format!("Could not read {}: {e}", path.display())) }

/// Copies the instance behind `launch_target`; blocking, so callers run it off the main thread.
pub fn copy_instance(home: &Path, target: &str, report: &mut dyn FnMut(u64, u64, &str)) -> Result<CopiedInstance, String> {
    copy_instance_in(&super::instance_roots(home), target, report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sources::prism::launcher;
    use crate::sources::testutil::temp_dir;
    use std::time::SystemTime;

    fn write(path: &Path, text: &str) { fs::create_dir_all(path.parent().unwrap()).unwrap(); fs::write(path, text).unwrap(); }

    fn tree(dir: &Path) -> Vec<(String, u64, Option<SystemTime>)> {
        let mut out = Vec::new();
        let mut stack = vec![dir.to_path_buf()];
        while let Some(current) = stack.pop() {
            for item in fs::read_dir(&current).unwrap().flatten() {
                let meta = item.metadata().unwrap();
                out.push((item.path().strip_prefix(dir).unwrap().to_string_lossy().into_owned(), meta.len(), meta.modified().ok()));
                if meta.is_dir() { stack.push(item.path()); }
            }
        }
        out.sort_by(|a, b| a.0.cmp(&b.0));
        out
    }

    fn fixture() -> (PathBuf, Vec<(PathBuf, &'static InstanceLauncher)>) {
        let root = temp_dir("mccopy");
        write(&root.join("instances/Pack/instance.cfg"), "[General]\nInstanceType=OneSix\nname=My Pack\n");
        write(&root.join("instances/Pack/mmc-pack.json"), r#"{"components":[{"uid":"net.minecraft","version":"1.21.1"}]}"#);
        write(&root.join("instances/Pack/minecraft/mods/a.jar"), "jar-bytes");
        write(&root.join("instances/Pack/minecraft/options.txt"), "fov:70");
        let roots = vec![(root.clone(), launcher("prism").unwrap())];
        (root, roots)
    }

    #[test]
    fn copies_beside_the_original_and_leaves_it_untouched() {
        let (root, roots) = fixture();
        let before = tree(&root.join("instances/Pack"));
        let mut last = (0, 0);
        let copy = copy_instance_in(&roots, "mc-instance://prism/Pack", &mut |done, total, _| last = (done, total)).unwrap();
        assert_eq!(copy.launch_target, "mc-instance://prism/Pack%20%28Mochi%29");
        assert_eq!(copy.name, "My Pack (Mochi)");
        assert!(copy.install_path.ends_with("instances/Pack (Mochi)"));
        assert!(copy.game_dir.ends_with("Pack (Mochi)/minecraft"));
        assert_eq!(fs::read_to_string(root.join("instances/Pack (Mochi)/minecraft/mods/a.jar")).unwrap(), "jar-bytes");
        assert!(fs::read_to_string(root.join("instances/Pack (Mochi)/instance.cfg")).unwrap().contains("name=My Pack (Mochi)"));
        assert!(last.0 > 0 && last.0 == last.1, "{last:?}");
        assert_eq!(tree(&root.join("instances/Pack")), before);
        assert!(fs::read_to_string(root.join("instances/Pack/instance.cfg")).unwrap().contains("name=My Pack\n"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn colliding_names_get_a_counter() {
        let (root, roots) = fixture();
        let names: Vec<_> = (0..3).map(|_| copy_instance_in(&roots, "mc-instance://prism/Pack", &mut |_, _, _| {}).unwrap().name).collect();
        assert_eq!(names, ["My Pack (Mochi)", "My Pack (Mochi 2)", "My Pack (Mochi 3)"]);
        assert!(root.join("instances/Pack (Mochi 3)/instance.cfg").is_file());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn unknown_traversing_and_symlinked_instances_are_refused() {
        let (root, roots) = fixture();
        for bad in ["mc-instance://prism/..", "mc-instance://prism/a%2F..%2Fb", "mc-instance://prism/Missing", "mc-instance://evil/Pack", "steam://1"] {
            assert!(copy_instance_in(&roots, bad, &mut |_, _, _| {}).is_err(), "{bad}");
        }
        let outside = temp_dir("mccopy-outside");
        write(&outside.join("instance.cfg"), "name=Outside\n");
        std::os::unix::fs::symlink(&outside, root.join("instances/Linked")).unwrap();
        assert!(copy_instance_in(&roots, "mc-instance://prism/Linked", &mut |_, _, _| {}).is_err());
        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(outside);
    }

    #[test]
    fn a_symlink_inside_an_instance_aborts_and_cleans_up() {
        let (root, roots) = fixture();
        std::os::unix::fs::symlink("/etc", root.join("instances/Pack/minecraft/saves")).unwrap();
        let error = copy_instance_in(&roots, "mc-instance://prism/Pack", &mut |_, _, _| {}).unwrap_err();
        assert!(error.contains("symbolic link"), "{error}");
        assert!(!root.join("instances/Pack (Mochi)").exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn a_failing_copy_removes_the_partial_folder() {
        use std::os::unix::fs::PermissionsExt;
        let (root, roots) = fixture();
        let secret = root.join("instances/Pack/minecraft/options.txt");
        fs::set_permissions(&secret, fs::Permissions::from_mode(0o000)).unwrap();
        // Root can read anything, so only assert the failure path when the read is really denied.
        if fs::File::open(&secret).is_err() {
            assert!(copy_instance_in(&roots, "mc-instance://prism/Pack", &mut |_, _, _| {}).is_err());
            assert!(!root.join("instances/Pack (Mochi)").exists());
            assert_eq!(fs::read_dir(root.join("instances")).unwrap().count(), 1);
        }
        fs::set_permissions(&secret, fs::Permissions::from_mode(0o644)).unwrap();
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn config_name_is_replaced_or_added() {
        assert_eq!(renamed_config("[General]\nname=A\nx=1\n", "B"), "[General]\nname=B\nx=1\n");
        assert_eq!(renamed_config("[General]\nx=1\n", "B"), "[General]\nname=B\nx=1\n");
        assert_eq!(renamed_config("x=1\n", "B"), "name=B\nx=1\n");
    }

    #[test]
    fn copied_files_keep_their_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let (root, roots) = fixture();
        let script = root.join("instances/Pack/minecraft/run.sh");
        write(&script, "#!/bin/sh");
        fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).unwrap();
        copy_instance_in(&roots, "mc-instance://prism/Pack", &mut |_, _, _| {}).unwrap();
        assert_eq!(fs::metadata(root.join("instances/Pack (Mochi)/minecraft/run.sh")).unwrap().permissions().mode() & 0o777, 0o755);
        let _ = fs::remove_dir_all(root);
    }
}
