use serde::Serialize;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedImportSource {
    pub id: String,
    pub name: String,
    pub description: String,
    pub detected: bool,
    pub game_count: Option<u32>,
}

#[cfg(target_os = "linux")]
mod linux;

#[cfg(target_os = "macos")]
mod macos;

#[cfg(target_os = "linux")]
pub fn detect_import_sources() -> Vec<DetectedImportSource> {
    linux::detect_import_sources()
}

#[cfg(target_os = "macos")]
pub fn detect_import_sources() -> Vec<DetectedImportSource> {
    macos::detect_import_sources()
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
pub fn detect_import_sources() -> Vec<DetectedImportSource> {
    Vec::new()
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedGame { pub id:String, pub name:String, pub source:String, pub launch_target:String, pub install_path:Option<String> }
#[cfg(target_os="linux")] pub fn scan_import_games(source:&str)->Vec<ImportedGame>{linux::scan_import_games(source)}
#[cfg(target_os="macos")] pub fn scan_import_games(_source:&str)->Vec<ImportedGame>{Vec::new()}
#[cfg(not(any(target_os="linux",target_os="macos")))] pub fn scan_import_games(_source:&str)->Vec<ImportedGame>{Vec::new()}
