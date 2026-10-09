//! Tofus as mod profiles of one game folder.
//!
//! Several Tofus may work directly on the same game folder. Each Tofu's records (`mods.json`) say which files are its mods
//! and whether they are on. Switching Tofu (or launching) enables exactly the active Tofu's enabled mods and disables the
//! other Tofus' mods by renaming `x` <-> `x.disabled`. Files no Tofu owns are never touched, and nothing is ever deleted.
//!
//! The profiles are also written to `<game folder>/.mochi/tofus.json` (versioned, atomic), so re-importing the game, a new
//! install of Mochi or another device that sees the same folder can restore them.
use crate::modinstance::{base_name, content_dir, lock, load_records, merge, save_records, ModRecord, SyncReport, CONTENT_SUBDIRS};
use crate::util::{fsio, now_ms, valid_id};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
};

pub const MANIFEST_DIR: &str = ".mochi";
pub const MANIFEST_FILE: &str = "tofus.json";
pub const MANIFEST_SCHEMA: u32 = 1;
const MAX_MANIFEST_BYTES: u64 = 4 * 1024 * 1024;
const MAX_TOFUS: usize = 64;
const MAX_MODS: usize = 5000;

/// A Tofu of the game as the frontend knows it (names are only needed for the manifest).
#[derive(Debug, Clone, Deserialize, Serialize, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct TofuRef {
    pub id: String,
    pub name: String,
    /// The Tofu's own mod folder; equal to the game folder when it works on it directly.
    pub path: Option<String>,
    pub version: Option<String>,
    pub loader: Option<String>,
}

fn works_on(tofu: &TofuRef, game: &Path) -> bool {
    tofu.path.as_deref().is_some_and(|path| crate::modinstance::same_dir(Path::new(path), game))
}

/// Enables the active Tofu's mods and disables the other Tofus' mods in a shared game folder (and its Minecraft
/// content folders). Only files some Tofu owns are renamed; a name clash is reported, never resolved by deleting.
pub(crate) fn apply_membership(records_root: &Path, game: &Path, content_root: Option<&Path>, active: &str, tofus: &[TofuRef]) -> SyncReport {
    let mut report = SyncReport::default();
    // (subdir, file) -> should it be on?
    let mut wanted: HashMap<(String, String), bool> = HashMap::new();
    for tofu in tofus.iter().take(MAX_TOFUS).filter(|tofu| valid_id(&tofu.id, 120) && works_on(tofu, game)) {
        for record in load_records(records_root, &tofu.id) {
            if record.extracted { continue; }
            let on = tofu.id == active && record.enabled;
            let slot = wanted.entry((record.subdir.clone(), record.file.clone())).or_insert(false);
            *slot |= on;
        }
    }
    for ((subdir, file), on) in wanted {
        if file.is_empty() || file.contains(['/', '\\']) || file.starts_with('.') { continue; }
        let dir = if subdir.is_empty() { game.to_path_buf() } else {
            match content_root.map(|root| content_dir(root, &subdir)) { Some(Ok(dir)) => dir, _ => continue }
        };
        let (plain, disabled) = (dir.join(&file), dir.join(format!("{file}.disabled")));
        let (has_plain, has_disabled) = (fs::symlink_metadata(&plain).is_ok(), fs::symlink_metadata(&disabled).is_ok());
        let (from, to) = match (on, has_plain, has_disabled) {
            (true, false, true) => (&disabled, &plain),
            (false, true, false) => (&plain, &disabled),
            (_, true, true) => { report.conflicts.push(format!("{file} exists both enabled and disabled; Mochi left both alone")); continue; }
            _ => continue,
        };
        match fs::rename(from, to) {
            Ok(()) => if on { report.enabled += 1 } else { report.disabled += 1 },
            Err(error) => report.errors.push(format!("{file}: {error}")),
        }
    }
    report
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

/// One mod of a Tofu in the manifest: what identifies the file and its state, nothing fetched from a site.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct ManifestMod {
    pub file: String,
    pub subdir: String,
    pub enabled: bool,
    pub source: String,
    pub project_id: String,
    pub file_id: String,
    pub version: String,
    pub title: String,
    pub sha1: Option<String>,
    pub file_date: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct ManifestTofu {
    pub id: String,
    pub name: String,
    pub version: Option<String>,
    pub loader: Option<String>,
    /// The Tofu kept its own copy of its mods (in Mochi's data on the device that wrote the file).
    pub separate: bool,
    pub mods: Vec<ManifestMod>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct TofuManifest {
    pub schema: u32,
    pub generator: String,
    pub updated_at: u64,
    pub active_tofu_id: String,
    pub tofus: Vec<ManifestTofu>,
}

fn manifest_path(game: &Path) -> PathBuf { game.join(MANIFEST_DIR).join(MANIFEST_FILE) }

fn to_manifest_mod(record: ModRecord) -> ManifestMod {
    ManifestMod {
        file: record.file, subdir: record.subdir, enabled: record.enabled, source: record.source, project_id: record.project_id, file_id: record.file_id,
        version: record.version, title: record.title, sha1: record.sha1, file_date: record.file_date,
    }
}

pub(crate) fn build_manifest(records_root: &Path, game: &Path, active: &str, tofus: &[TofuRef]) -> TofuManifest {
    let tofus = tofus.iter().filter(|tofu| valid_id(&tofu.id, 120)).take(MAX_TOFUS).map(|tofu| ManifestTofu {
        id: tofu.id.clone(), name: tofu.name.chars().take(60).collect(), version: tofu.version.clone(), loader: tofu.loader.clone(),
        separate: tofu.path.is_some() && !works_on(tofu, game),
        mods: load_records(records_root, &tofu.id).into_iter().filter(|record| !record.extracted).take(MAX_MODS).map(to_manifest_mod).collect(),
    }).collect();
    TofuManifest { schema: MANIFEST_SCHEMA, generator: "Mochi".into(), updated_at: now_ms(), active_tofu_id: active.to_string(), tofus }
}

/// Writes `<game>/.mochi/tofus.json` atomically. Skipped when there is nothing worth keeping (one Tofu without mods),
/// and when the content did not change (only `updatedAt` would differ) so folders are not touched on every launch.
pub(crate) fn write_manifest(records_root: &Path, game: &Path, active: &str, tofus: &[TofuRef]) -> Result<(), String> {
    let manifest = build_manifest(records_root, game, active, tofus);
    if manifest.tofus.len() < 2 && manifest.tofus.iter().all(|tofu| tofu.mods.is_empty()) { return Ok(()); }
    let path = manifest_path(game);
    if let Some(existing) = read_manifest_file(&path) {
        if (TofuManifest { updated_at: manifest.updated_at, ..existing }) == manifest { return Ok(()); }
    }
    if !game.is_dir() { return Ok(()); }
    fs::create_dir_all(path.parent().unwrap_or(game)).map_err(|e| format!("Unable to save the Tofu list in {}: {e}", game.display()))?;
    let bytes = serde_json::to_vec_pretty(&manifest).map_err(|e| e.to_string())?;
    fsio::write_atomic_durable(&path, &bytes).map_err(|e| format!("Unable to save the Tofu list in {}: {e}", game.display()))
}

fn read_manifest_file(path: &Path) -> Option<TofuManifest> {
    let meta = fs::metadata(path).ok()?;
    if !meta.is_file() || meta.len() > MAX_MANIFEST_BYTES { return None; }
    let manifest: TofuManifest = serde_json::from_slice(&fs::read(path).ok()?).ok()?;
    // A newer schema may mean things this version would get wrong; ignore it rather than half-restore.
    if manifest.schema == 0 || manifest.schema > MANIFEST_SCHEMA { return None; }
    Some(sanitize(manifest))
}

fn sanitize(mut manifest: TofuManifest) -> TofuManifest {
    manifest.tofus.retain(|tofu| valid_id(&tofu.id, 120));
    manifest.tofus.truncate(MAX_TOFUS);
    for tofu in &mut manifest.tofus {
        tofu.name = tofu.name.chars().filter(|c| !c.is_control()).take(60).collect();
        tofu.mods.retain(|item| !item.file.is_empty() && !item.file.contains(['/', '\\', '\0']) && !item.file.starts_with('.') && (item.subdir.is_empty() || CONTENT_SUBDIRS.contains(&item.subdir.as_str())));
        tofu.mods.truncate(MAX_MODS);
        for item in &mut tofu.mods {
            item.file = base_name(&item.file).to_string();
            if !matches!(item.source.as_str(), "modrinth" | "curseforge" | "nexus") { item.source = "manual".into(); }
            item.project_id = item.project_id.chars().take(80).collect();
            item.file_id = item.file_id.chars().take(80).collect();
            item.version = item.version.chars().take(120).collect();
            item.title = item.title.chars().take(160).collect();
        }
    }
    manifest
}

/// The Tofu list saved in a game folder, if there is a readable one.
#[tauri::command(async)]
pub fn read_tofu_manifest(game_dir: String) -> Result<Option<TofuManifest>, String> {
    let game = crate::modrinth::validate_path(&game_dir)?;
    Ok(read_manifest_file(&manifest_path(&game)))
}

/// Saves the Tofu list of a game folder now (after downloads, toggles, a scan).
#[tauri::command(async)]
pub fn write_tofu_manifest(request: crate::modinstance::ModSyncRequest) -> Result<(), String> {
    let root = crate::modinstance::instances_root().ok_or("Mochi is still starting.")?;
    let game = crate::modinstance::validate_sync_dir(&request.game_dir)?;
    write_manifest(&root, &game, &request.tofu_id, &request.tofus)
}

pub(crate) fn restore_records_in(root: &Path, tofu_id: &str, mods: Vec<ManifestMod>) -> Result<usize, String> {
    if !valid_id(tofu_id, 120) { return Err("Invalid Tofu id.".into()); }
    let restored: Vec<ModRecord> = sanitize(TofuManifest { schema: 1, tofus: vec![ManifestTofu { id: tofu_id.to_string(), mods, ..Default::default() }], ..Default::default() })
        .tofus.into_iter().flat_map(|tofu| tofu.mods).map(|item| ModRecord {
            file: item.file, subdir: item.subdir, enabled: item.enabled, source: item.source, project_id: item.project_id, file_id: item.file_id,
            version: item.version, title: item.title, sha1: item.sha1, file_date: item.file_date, installed_at: now_ms(), ..ModRecord::default()
        }).collect();
    let _guard = lock();
    let mut records = load_records(root, tofu_id);
    let count = restored.len();
    for record in restored {
        records.retain(|existing| !(existing.subdir == record.subdir && existing.file == record.file));
        records.push(record);
    }
    save_records(root, tofu_id, records)?;
    Ok(count)
}

/// Gives a Tofu the mods a manifest lists for it (merged into what it already has).
#[tauri::command(async)]
pub fn restore_instance_records(tofu_id: String, mods: Vec<ManifestMod>) -> Result<usize, String> {
    let root = crate::modinstance::instances_root().ok_or("Mochi is still starting.")?;
    restore_records_in(&root, &tofu_id, mods)
}

/// Applies the active Tofu's mod set now (the user switched Tofu while the game is not running). Same work as at launch.
#[tauri::command]
pub async fn apply_tofu_mods(request: crate::modinstance::ModSyncRequest) -> Result<SyncReport, String> {
    let id = request.tofu_id.clone();
    crate::util::blocking(move || {
        let mut report = SyncReport::default();
        let outcome = crate::modinstance::run_sync(&request, &|done, total| crate::modinstance::emit("mod-sync-progress", crate::modinstance::SyncProgress { tofu_id: id.clone(), done, total }))?;
        merge(&mut report, outcome);
        Ok(report)
    }).await?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modinstance::{run_sync_in, upsert_record_in, ModSyncRequest, RecordInput};

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mochi-profiles-{name}-{}-{}", std::process::id(), now_ms()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn own(data: &Path, tofu: &str, file: &str, subdir: &str, enabled: bool) {
        let mut record = RecordInput { source: "modrinth".into(), project_id: format!("p-{file}"), title: file.into(), ..Default::default() }.into_record(file, subdir, None);
        record.enabled = enabled;
        upsert_record_in(data, tofu, record).unwrap();
    }

    fn tofu(id: &str, path: &Path) -> TofuRef { TofuRef { id: id.into(), name: id.to_uppercase(), path: Some(path.to_string_lossy().into()), ..Default::default() } }

    fn switch_to(data: &Path, game: &Path, active: &str, tofus: &[TofuRef], content_root: Option<&Path>) -> SyncReport {
        let store = tofus.iter().find(|t| t.id == active).and_then(|t| t.path.clone()).unwrap();
        let request = ModSyncRequest { tofu_id: active.into(), store_dir: store, game_dir: game.to_string_lossy().into(), content_root: content_root.map(|p| p.to_string_lossy().into()), adopt_unmanaged: false, tofus: tofus.to_vec() };
        run_sync_in(Some(data), &request, &|_, _| {}).unwrap()
    }

    fn names(dir: &Path) -> Vec<String> {
        let mut out: Vec<String> = fs::read_dir(dir).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).filter(|n| !n.starts_with('.')).collect();
        out.sort();
        out
    }

    /// BepInEx: plugins are .dll files in `BepInEx/plugins`, shared by two Tofus; one plugin the user dropped in by hand.
    #[test]
    fn bepinex_switch_enables_exactly_the_active_tofu() {
        let base = temp("bepinex");
        let (data, game) = (base.join("data"), base.join("Valheim/BepInEx/plugins"));
        fs::create_dir_all(&game).unwrap();
        for file in ["ValheimPlus.dll", "BetterUI.dll", "Shared.dll", "Manual.dll"] { fs::write(game.join(file), file).unwrap(); }
        own(&data, "vanilla-plus", "ValheimPlus.dll", "", true);
        own(&data, "vanilla-plus", "Shared.dll", "", true);
        own(&data, "ui-pack", "BetterUI.dll", "", true);
        own(&data, "ui-pack", "Shared.dll", "", true);
        let tofus = [tofu("vanilla-plus", &game), tofu("ui-pack", &game)];

        let report = switch_to(&data, &game, "vanilla-plus", &tofus, None);
        assert_eq!((report.enabled, report.disabled), (0, 1));
        assert_eq!(names(&game), ["BetterUI.dll.disabled", "Manual.dll", "Shared.dll", "ValheimPlus.dll"]);

        let report = switch_to(&data, &game, "ui-pack", &tofus, None);
        assert_eq!((report.enabled, report.disabled), (1, 1));
        assert_eq!(names(&game), ["BetterUI.dll", "Manual.dll", "Shared.dll", "ValheimPlus.dll.disabled"]);
        // Applying again is a no-op, and nothing was ever deleted.
        let again = switch_to(&data, &game, "ui-pack", &tofus, None);
        assert_eq!((again.enabled, again.disabled), (0, 0));
        assert_eq!(fs::read(game.join("Manual.dll")).unwrap(), b"Manual.dll");

        // The manifest describes both Tofus and the active one.
        let manifest = read_manifest_file(&manifest_path(&game)).unwrap();
        assert_eq!(manifest.active_tofu_id, "ui-pack");
        assert_eq!(manifest.tofus.len(), 2);
        assert_eq!(manifest.tofus[0].mods.len(), 2);
        let _ = fs::remove_dir_all(&base);
    }

    /// A mod the active Tofu keeps disabled stays disabled; a new empty Tofu turns every owned mod off.
    #[test]
    fn disabled_mods_and_empty_tofus() {
        let base = temp("empty");
        let (data, game) = (base.join("data"), base.join("game/Mods"));
        fs::create_dir_all(&game).unwrap();
        for file in ["a.zip", "b.zip"] { fs::write(game.join(file), file).unwrap(); }
        own(&data, "main", "a.zip", "", true);
        own(&data, "main", "b.zip", "", false);
        let tofus = [tofu("main", &game), tofu("fresh", &game)];
        switch_to(&data, &game, "main", &tofus, None);
        assert_eq!(names(&game), ["a.zip", "b.zip.disabled"]);
        switch_to(&data, &game, "fresh", &tofus, None);
        assert_eq!(names(&game), ["a.zip.disabled", "b.zip.disabled"]);
        switch_to(&data, &game, "main", &tofus, None);
        assert_eq!(names(&game), ["a.zip", "b.zip.disabled"]);
        let _ = fs::remove_dir_all(&base);
    }

    /// Minecraft: mods plus resource packs in the instance's content root.
    #[test]
    fn minecraft_mods_and_resource_packs_follow_the_tofu() {
        let base = temp("minecraft");
        let (data, root) = (base.join("data"), base.join("instances/Fabric/.minecraft"));
        let mods = root.join("mods");
        fs::create_dir_all(&mods).unwrap();
        fs::create_dir_all(root.join("resourcepacks")).unwrap();
        fs::write(mods.join("sodium.jar"), b"s").unwrap();
        fs::write(mods.join("iris.jar"), b"i").unwrap();
        fs::write(root.join("resourcepacks/faithful.zip"), b"f").unwrap();
        own(&data, "perf", "sodium.jar", "", true);
        own(&data, "shaders", "sodium.jar", "", true);
        own(&data, "shaders", "iris.jar", "", true);
        own(&data, "shaders", "faithful.zip", "resourcepacks", true);
        let tofus = [tofu("perf", &mods), tofu("shaders", &mods)];
        switch_to(&data, &mods, "perf", &tofus, Some(&root));
        assert_eq!(names(&mods), ["iris.jar.disabled", "sodium.jar"]);
        assert_eq!(names(&root.join("resourcepacks")), ["faithful.zip.disabled"]);
        switch_to(&data, &mods, "shaders", &tofus, Some(&root));
        assert_eq!(names(&mods), ["iris.jar", "sodium.jar"]);
        assert_eq!(names(&root.join("resourcepacks")), ["faithful.zip"]);
        let _ = fs::remove_dir_all(&base);
    }

    /// tModLoader: `.tmod` files in `ModLoader/Mods`; a separate-store Tofu and a shared one on the same folder.
    #[test]
    fn tmodloader_shared_and_separate_tofus_swap_cleanly() {
        let base = temp("tmod");
        let (data, game, store) = (base.join("data"), base.join("Terraria/ModLoader/Mods"), base.join("store"));
        fs::create_dir_all(&game).unwrap();
        fs::create_dir_all(&store).unwrap();
        fs::write(game.join("CalamityMod.tmod"), b"c").unwrap();
        fs::write(game.join("enabled.json"), b"[]").unwrap();
        fs::write(store.join("ThoriumMod.tmod"), b"t").unwrap();
        own(&data, "calamity", "CalamityMod.tmod", "", true);
        let tofus = [tofu("calamity", &game), tofu("thorium", &store)];

        // The separate Tofu: the shared Tofu's mod is switched off and the store's mod is placed.
        let report = switch_to(&data, &game, "thorium", &tofus, None);
        assert_eq!((report.disabled, report.added), (1, 1));
        assert_eq!(names(&game), ["CalamityMod.tmod.disabled", "ThoriumMod.tmod", "enabled.json"]);
        // Back to the shared Tofu: its mod comes back on and the placed file is taken out again.
        let report = switch_to(&data, &game, "calamity", &tofus, None);
        assert_eq!((report.enabled, report.removed), (1, 1));
        assert_eq!(names(&game), ["CalamityMod.tmod", "enabled.json"]);
        assert!(store.join("ThoriumMod.tmod").exists());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn clashing_names_are_reported_not_resolved() {
        let base = temp("clash");
        let (data, game) = (base.join("data"), base.join("mods"));
        fs::create_dir_all(&game).unwrap();
        fs::write(game.join("x.jar"), b"1").unwrap();
        fs::write(game.join("x.jar.disabled"), b"2").unwrap();
        own(&data, "a", "x.jar", "", false);
        let report = switch_to(&data, &game, "a", &[tofu("a", &game), tofu("b", &game)], None);
        assert_eq!(report.conflicts.len(), 1);
        assert!(game.join("x.jar").exists() && game.join("x.jar.disabled").exists());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn manifest_round_trips_and_rejects_bad_content() {
        let base = temp("manifest");
        let (data, game) = (base.join("data"), base.join("mods"));
        fs::create_dir_all(&game).unwrap();
        own(&data, "a", "one.jar", "", true);
        write_manifest(&data, &game, "a", &[tofu("a", &game)]).unwrap();
        let manifest = read_manifest_file(&manifest_path(&game)).unwrap();
        assert_eq!(manifest.schema, MANIFEST_SCHEMA);
        assert_eq!(manifest.tofus[0].mods[0].file, "one.jar");
        assert!(!manifest.tofus[0].separate);
        // Unchanged content is not rewritten.
        let before = fs::metadata(manifest_path(&game)).unwrap().modified().unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        write_manifest(&data, &game, "a", &[tofu("a", &game)]).unwrap();
        assert_eq!(fs::metadata(manifest_path(&game)).unwrap().modified().unwrap(), before);

        // Restore into a new Tofu id, sanitising paths and sources.
        let mods = vec![
            ManifestMod { file: "ok.jar".into(), enabled: true, source: "curseforge".into(), project_id: "1".into(), ..Default::default() },
            ManifestMod { file: "../evil.jar".into(), ..Default::default() },
            ManifestMod { file: "x.jar".into(), subdir: "saves".into(), ..Default::default() },
            ManifestMod { file: "y.jar.disabled".into(), source: "weird".into(), ..Default::default() },
        ];
        assert_eq!(restore_records_in(&data, "b", mods).unwrap(), 2);
        let restored = load_records(&data, "b");
        assert_eq!(restored.iter().map(|r| (r.file.as_str(), r.source.as_str())).collect::<Vec<_>>(), [("ok.jar", "curseforge"), ("y.jar", "manual")]);
        assert!(restore_records_in(&data, "../x", Vec::new()).is_err());

        // A newer schema and junk are ignored.
        fs::write(manifest_path(&game), br#"{"schema": 99, "tofus": []}"#).unwrap();
        assert!(read_manifest_file(&manifest_path(&game)).is_none());
        fs::write(manifest_path(&game), b"not json").unwrap();
        assert!(read_manifest_file(&manifest_path(&game)).is_none());
        // One Tofu without mods leaves no file behind.
        let empty = base.join("empty");
        fs::create_dir_all(&empty).unwrap();
        write_manifest(&data, &empty, "zzz", &[tofu("zzz", &empty)]).unwrap();
        assert!(!manifest_path(&empty).exists());
        let _ = fs::remove_dir_all(&base);
    }
}
