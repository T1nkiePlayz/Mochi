//! Plugins (experimental): small folders under `<app data>/plugins/<id>/` with a `plugin.json` and an optional `main.js`.
//! This module only reads them; the window runs `main.js` in a restricted worker (see `src/lib/plugins`).
use serde::Serialize;
use std::{fs, path::{Path, PathBuf}};
use tauri::{AppHandle, Manager};

const MAX_PLUGINS: usize = 50;
const MAX_MANIFEST: u64 = 32 * 1024;
const MAX_SCRIPT: u64 = 256 * 1024;

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PluginFiles {
    pub dir: String,
    pub manifest: String,
    pub script: Option<String>,
}

fn valid_dir_name(name: &str) -> bool {
    !name.is_empty() && name.len() <= 40 && name.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_')
}

/// Reads a regular file (never a symlink) up to `limit` bytes as text.
fn read_text(path: &Path, limit: u64) -> Option<String> {
    let meta = fs::symlink_metadata(path).ok()?;
    if !meta.is_file() || meta.len() > limit { return None; }
    fs::read_to_string(path).ok()
}

pub fn read_plugins(root: &Path) -> Vec<PluginFiles> {
    let mut found = Vec::new();
    let mut entries: Vec<_> = fs::read_dir(root).into_iter().flatten().flatten().collect();
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let dir = entry.file_name().to_string_lossy().into_owned();
        let path = entry.path();
        if !valid_dir_name(&dir) || !fs::symlink_metadata(&path).is_ok_and(|meta| meta.is_dir()) { continue; }
        let Some(manifest) = read_text(&path.join("plugin.json"), MAX_MANIFEST) else { continue };
        found.push(PluginFiles { dir, manifest, script: read_text(&path.join("main.js"), MAX_SCRIPT) });
        if found.len() >= MAX_PLUGINS { break; }
    }
    found
}

fn plugins_root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|error| error.to_string())?.join("plugins");
    fs::create_dir_all(&dir).map_err(|error| format!("Unable to create the plugins folder: {error}"))?;
    Ok(dir)
}

#[tauri::command(async)]
pub fn list_plugins(app: AppHandle) -> Result<Vec<PluginFiles>, String> { Ok(read_plugins(&plugins_root(&app)?)) }

/// The plugins folder (created when missing) so the window can open it in the file manager.
#[tauri::command(async)]
pub fn plugins_folder(app: AppHandle) -> Result<String, String> { Ok(plugins_root(&app)?.to_string_lossy().into_owned()) }

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_valid_plugin_folders_only() {
        let root = std::env::temp_dir().join(format!("mochi-plugins-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("good")).unwrap();
        fs::create_dir_all(root.join("Bad Name")).unwrap();
        fs::create_dir_all(root.join("nomanifest")).unwrap();
        fs::write(root.join("good/plugin.json"), "{}").unwrap();
        fs::write(root.join("good/main.js"), "1").unwrap();
        fs::write(root.join("Bad Name/plugin.json"), "{}").unwrap();
        let found = read_plugins(&root);
        assert_eq!(found, [PluginFiles { dir: "good".into(), manifest: "{}".into(), script: Some("1".into()) }]);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn oversized_files_are_skipped() {
        let root = std::env::temp_dir().join(format!("mochi-plugins-big-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("p")).unwrap();
        fs::write(root.join("p/plugin.json"), vec![b'x'; (MAX_MANIFEST + 1) as usize]).unwrap();
        assert!(read_plugins(&root).is_empty());
        let _ = fs::remove_dir_all(&root);
    }
}
