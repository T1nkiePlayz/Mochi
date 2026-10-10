//! Writes the PNG produced by the stats "Share card" (experimental) to a path the user chose in a save dialog.

use base64::{engine::general_purpose::STANDARD, Engine};
use std::{fs, path::{Path, PathBuf}};

const MAX_BYTES: usize = 16 * 1024 * 1024;
const PNG_SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];

fn write_png(destination: &Path, data_base64: &str) -> Result<PathBuf, String> {
    if !destination.is_absolute() { return Err("Choose where to save the image.".into()); }
    if data_base64.len() > MAX_BYTES * 4 / 3 + 8 { return Err("The image is too large.".into()); }
    let bytes = STANDARD.decode(data_base64).map_err(|_| "The image data is invalid.".to_string())?;
    if bytes.len() > MAX_BYTES || !bytes.starts_with(&PNG_SIGNATURE) { return Err("The image data is not a PNG.".into()); }
    let mut target = destination.to_path_buf();
    if target.extension().and_then(|value| value.to_str()).map(str::to_ascii_lowercase).as_deref() != Some("png") { target.set_extension("png"); }
    fs::write(&target, bytes).map_err(|error| format!("Could not save the image: {error}"))?;
    Ok(target)
}

#[tauri::command(async)]
pub fn write_share_card(destination: String, data_base64: String) -> Result<(), String> { write_png(Path::new(&destination), &data_base64).map(|_| ()) }

#[cfg(test)]
mod tests {
    use super::*;

    fn png_b64() -> String { STANDARD.encode([&PNG_SIGNATURE[..], &[1, 2, 3]].concat()) }
    fn dir(name: &str) -> PathBuf { let path = std::env::temp_dir().join(format!("mochi-sharecard-{name}-{}", std::process::id())); fs::create_dir_all(&path).unwrap(); path }

    #[test]
    fn writes_png_and_forces_extension() {
        let root = dir("ok");
        let written = write_png(&root.join("card"), &png_b64()).unwrap();
        assert_eq!(written, root.join("card.png"));
        assert!(fs::read(&written).unwrap().starts_with(&PNG_SIGNATURE));
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn rejects_relative_paths_and_non_png_data() {
        assert!(write_png(Path::new("card.png"), &png_b64()).is_err());
        let root = dir("bad");
        assert!(write_png(&root.join("a.png"), &STANDARD.encode(b"<svg/>")).is_err());
        assert!(write_png(&root.join("a.png"), "!!!").is_err());
        assert!(!root.join("a.png").exists());
        fs::remove_dir_all(root).ok();
    }
}
