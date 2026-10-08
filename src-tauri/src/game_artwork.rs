use base64::{engine::general_purpose::STANDARD, Engine as _};
use std::{fs, path::PathBuf};
use image::{imageops::FilterType, DynamicImage, ImageFormat, ImageReader, Limits};
use serde::{Deserialize, Serialize};
use std::io::Cursor;
use tauri::AppHandle;

const MAX_IMAGE_BYTES: usize = 15 * 1024 * 1024;

fn cache_path(app: &AppHandle, key: &str) -> Result<PathBuf, String> {
    let key = key.trim();
    if key.is_empty() || key.len() > 120 || !key.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err("Invalid game artwork cache key.".into());
    }
    Ok(crate::themes::game_artwork_cache_dir(app)?.join(key))
}

fn mime_for_path(path: &std::path::Path) -> &'static str {
    match path.extension().and_then(|value| value.to_str()).unwrap_or("") {
        "png" => "image/png",
        "webp" => "image/webp",
        _ => "image/jpeg",
    }
}

fn data_url(path: &std::path::Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|error| format!("Unable to read cached artwork: {error}"))?;
    Ok(format!("data:{};base64,{}", mime_for_path(path), STANDARD.encode(bytes)))
}

#[tauri::command]
pub async fn cache_game_artwork(app: AppHandle, url: String, cache_key: String) -> Result<String, String> {
    let path = cache_path(&app, &cache_key)?;
    if let Some(existing) = fs::read_dir(path.parent().unwrap_or_else(|| std::path::Path::new("."))).ok().and_then(|entries| entries.flatten().find(|entry| entry.path().file_stem().and_then(|v| v.to_str()) == Some(cache_key.as_str())).map(|entry| entry.path())) {
        return data_url(&existing);
    }

    let parsed = reqwest::Url::parse(&url).map_err(|_| "Invalid artwork URL.".to_string())?;
    if parsed.scheme() != "https" || parsed.host_str() != Some("images.igdb.com") || !parsed.path().starts_with("/igdb/image/upload/") {
        return Err("Only IGDB artwork URLs can be cached.".into());
    }
    let response = reqwest::Client::builder().timeout(std::time::Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() < 3 && attempt.url().scheme() == "https" && attempt.url().host_str() == Some("images.igdb.com") { attempt.follow() } else { attempt.stop() }
        }))
        .build()
        .map_err(|error| format!("Unable to prepare artwork request: {error}"))?
        .get(parsed).send().await.map_err(|error| format!("Unable to download game artwork: {error}"))?;
    if !response.status().is_success() { return Err(format!("IGDB artwork returned HTTP {}.", response.status())); }
    if response.content_length().is_some_and(|length| length as usize > MAX_IMAGE_BYTES) { return Err("IGDB artwork is larger than the 15 MiB cache limit.".into()); }
    let mime = response.headers().get(reqwest::header::CONTENT_TYPE).and_then(|value| value.to_str().ok()).unwrap_or("").split(';').next().unwrap_or("");
    let extension = match mime {
        "image/jpeg" => "jpg",
        "image/png" => "png",
        "image/webp" => "webp",
        _ => return Err("IGDB returned an unsupported artwork format.".into()),
    };
    let bytes = response.bytes().await.map_err(|error| format!("Unable to read downloaded artwork: {error}"))?;
    if bytes.is_empty() || bytes.len() > MAX_IMAGE_BYTES { return Err("IGDB artwork has an invalid size.".into()); }
    let path = path.with_extension(extension);
    fs::write(&path, &bytes).map_err(|error| format!("Unable to save artwork in Mochi's config folder: {error}"))?;
    data_url(&path)
}

#[tauri::command]
pub fn get_cached_game_artwork(app: AppHandle, cache_key: String) -> Result<Option<String>, String> {
    let base = cache_path(&app, &cache_key)?;
    let Some(path) = fs::read_dir(base.parent().unwrap_or_else(|| std::path::Path::new("."))).ok()
        .and_then(|entries| entries.flatten().find(|entry| entry.path().file_stem().and_then(|v| v.to_str()) == Some(cache_key.as_str())).map(|entry| entry.path())) else { return Ok(None) };
    data_url(&path).map(Some)
}

#[tauri::command]
pub fn clear_game_artwork_cache(app: AppHandle) -> Result<(), String> {
    let path = crate::themes::game_artwork_cache_dir(&app)?;
    if path.exists() { fs::remove_dir_all(&path).map_err(|error| format!("Unable to clear cached game artwork: {error}"))?; }
    Ok(())
}

// ---------------------------------------------------------------------------
// Custom artwork: the user picks any image, Mochi crops it to a 3:4 cover.
// ---------------------------------------------------------------------------

const MAX_SOURCE_BYTES: u64 = 100 * 1024 * 1024;
const MAX_SOURCE_DIMENSION: u32 = 20_000;
const MAX_SOURCE_PIXELS: u64 = 150_000_000;
const PREVIEW_MAX_EDGE: u32 = 1600;
const COVER_WIDTH: u32 = 600;
const COVER_HEIGHT: u32 = 800;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtworkPreview {
    pub data_url: String,
    /// Dimensions of the original image (the preview itself may be smaller).
    pub width: u32,
    pub height: u32,
}

/// A crop rectangle in fractions (0..1) of the source image.
#[derive(Debug, Deserialize, Clone, Copy)]
pub struct CropRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Converts a normalised crop into a pixel rectangle `(x, y, w, h)` that always lies inside the image.
fn crop_pixels(src_w: u32, src_h: u32, crop: CropRect) -> Result<(u32, u32, u32, u32), String> {
    let values = [crop.x, crop.y, crop.width, crop.height];
    if values.iter().any(|value| !value.is_finite()) { return Err("The crop area is invalid.".into()); }
    if crop.width <= 0.0 || crop.height <= 0.0 || crop.x < -0.001 || crop.y < -0.001 || crop.x + crop.width > 1.001 || crop.y + crop.height > 1.001 {
        return Err("The crop area is outside the image.".into());
    }
    let x = ((crop.x.max(0.0) * src_w as f64).round() as u32).min(src_w.saturating_sub(1));
    let y = ((crop.y.max(0.0) * src_h as f64).round() as u32).min(src_h.saturating_sub(1));
    let w = ((crop.width * src_w as f64).round() as u32).clamp(1, src_w - x);
    let h = ((crop.height * src_h as f64).round() as u32).clamp(1, src_h - y);
    Ok((x, y, w, h))
}

fn check_dimensions(width: u32, height: u32) -> Result<(), String> {
    if width == 0 || height == 0 { return Err("The image is empty.".into()); }
    if width > MAX_SOURCE_DIMENSION || height > MAX_SOURCE_DIMENSION || (width as u64) * (height as u64) > MAX_SOURCE_PIXELS {
        return Err(format!("The image is too large ({width}x{height}). Use one up to {MAX_SOURCE_DIMENSION}px on a side."));
    }
    Ok(())
}

fn image_reader(bytes: &[u8]) -> Result<ImageReader<Cursor<&[u8]>>, String> {
    let mut reader = ImageReader::new(Cursor::new(bytes)).with_guessed_format().map_err(|_| "Unrecognised image file.".to_string())?;
    let mut limits = Limits::default();
    limits.max_image_width = Some(MAX_SOURCE_DIMENSION);
    limits.max_image_height = Some(MAX_SOURCE_DIMENSION);
    limits.max_alloc = Some(1024 * 1024 * 1024);
    reader.limits(limits);
    match reader.format() {
        Some(ImageFormat::Png | ImageFormat::Jpeg | ImageFormat::WebP | ImageFormat::Gif) => Ok(reader),
        _ => Err("Use a PNG, JPEG, WebP or GIF image.".into()),
    }
}

fn decode_image(bytes: &[u8]) -> Result<DynamicImage, String> {
    if bytes.is_empty() || bytes.len() as u64 > MAX_SOURCE_BYTES { return Err("The image is empty or larger than 100 MB.".into()); }
    let (width, height) = image_reader(bytes)?.into_dimensions().map_err(|error| format!("Unable to read this image: {error}"))?;
    check_dimensions(width, height)?;
    image_reader(bytes)?.decode().map_err(|error| format!("Unable to read this image: {error}"))
}

fn encode_jpeg(image: &DynamicImage) -> Result<Vec<u8>, String> {
    // JPEG has no alpha: flatten onto a dark neutral so transparent PNGs stay legible.
    let rgba = image.to_rgba8();
    let mut rgb = image::RgbImage::new(rgba.width(), rgba.height());
    for (target, pixel) in rgb.pixels_mut().zip(rgba.pixels()) {
        let alpha = pixel[3] as u32;
        let blend = |channel: u8| ((channel as u32 * alpha + 20 * (255 - alpha)) / 255) as u8;
        *target = image::Rgb([blend(pixel[0]), blend(pixel[1]), blend(pixel[2])]);
    }
    let mut out = Vec::new();
    let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 88);
    DynamicImage::ImageRgb8(rgb).write_with_encoder(encoder).map_err(|error| format!("Unable to encode artwork: {error}"))?;
    Ok(out)
}

fn is_blocked_host(host: &str) -> bool {
    let host = host.trim_matches(|c| c == '[' || c == ']').to_ascii_lowercase();
    if host == "localhost" || host.ends_with(".localhost") || host.ends_with(".local") || host.ends_with(".internal") { return true; }
    match host.parse::<std::net::IpAddr>() {
        Ok(std::net::IpAddr::V4(ip)) => ip.is_loopback() || ip.is_private() || ip.is_link_local() || ip.is_unspecified() || ip.is_broadcast(),
        Ok(std::net::IpAddr::V6(ip)) => ip.is_loopback() || ip.is_unspecified() || (ip.segments()[0] & 0xfe00) == 0xfc00 || (ip.segments()[0] & 0xffc0) == 0xfe80,
        Err(_) => false,
    }
}

async fn download_image(url: &str) -> Result<Vec<u8>, String> {
    let parsed = reqwest::Url::parse(url).map_err(|_| "That is not a valid image URL.".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none_or(is_blocked_host) {
        return Err("Only public http(s) image URLs are supported.".into());
    }
    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            let allowed = attempt.previous().len() < 4 && matches!(attempt.url().scheme(), "http" | "https") && attempt.url().host_str().is_some_and(|host| !is_blocked_host(host));
            if allowed { attempt.follow() } else { attempt.stop() }
        }))
        .build().map_err(|error| format!("Unable to prepare the download: {error}"))?;
    let mut response = client.get(parsed).send().await.map_err(|error| format!("Unable to download the image: {error}"))?;
    if !response.status().is_success() { return Err(format!("The image server returned HTTP {}.", response.status())); }
    if response.content_length().is_some_and(|length| length > MAX_SOURCE_BYTES) { return Err("The image is larger than 100 MB.".into()); }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|error| format!("The download was interrupted: {error}"))? {
        if bytes.len() as u64 + chunk.len() as u64 > MAX_SOURCE_BYTES { return Err("The image is larger than 100 MB.".into()); }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

fn decode_data_url(source: &str) -> Result<Vec<u8>, String> {
    let (header, payload) = source.split_once(',').ok_or("Invalid image data.")?;
    if !header.starts_with("data:image/") || !header.ends_with(";base64") { return Err("Invalid image data.".into()); }
    if payload.len() as u64 > MAX_SOURCE_BYTES * 4 / 3 + 16 { return Err("The image is larger than 100 MB.".into()); }
    STANDARD.decode(payload.trim()).map_err(|_| "Invalid image data.".to_string())
}

/// Reads an image from a local file, an http(s) URL or a base64 data URL (pasted/dropped images).
async fn load_source(source: &str) -> Result<Vec<u8>, String> {
    let source = source.trim();
    if source.starts_with("data:") { return decode_data_url(source); }
    if source.starts_with("http://") || source.starts_with("https://") { return download_image(source).await; }
    let path = fs::canonicalize(source).map_err(|_| "That image file could not be found.".to_string())?;
    let meta = fs::metadata(&path).map_err(|error| format!("Unable to read the image file: {error}"))?;
    if !meta.is_file() { return Err("Choose an image file, not a folder.".into()); }
    if meta.len() > MAX_SOURCE_BYTES { return Err("The image is larger than 100 MB.".into()); }
    fs::read(&path).map_err(|error| format!("Unable to read the image file: {error}"))
}

fn build_preview(bytes: &[u8]) -> Result<ArtworkPreview, String> {
    let image = decode_image(bytes)?;
    let (width, height) = (image.width(), image.height());
    let scaled = if width.max(height) > PREVIEW_MAX_EDGE { image.resize(PREVIEW_MAX_EDGE, PREVIEW_MAX_EDGE, FilterType::Triangle) } else { image };
    let (mime, encoded) = if scaled.color().has_alpha() {
        let mut out = Vec::new();
        scaled.write_to(&mut Cursor::new(&mut out), ImageFormat::Png).map_err(|error| format!("Unable to prepare preview: {error}"))?;
        ("image/png", out)
    } else { ("image/jpeg", encode_jpeg(&scaled)?) };
    Ok(ArtworkPreview { data_url: format!("data:{mime};base64,{}", STANDARD.encode(encoded)), width, height })
}

fn render_cover(bytes: &[u8], crop: CropRect) -> Result<Vec<u8>, String> {
    let image = decode_image(bytes)?;
    let (x, y, w, h) = crop_pixels(image.width(), image.height(), crop)?;
    let cropped = image.crop_imm(x, y, w, h).resize_exact(COVER_WIDTH, COVER_HEIGHT, FilterType::Lanczos3);
    encode_jpeg(&cropped)
}

/// Decodes an image (path, URL or data URL) within safe limits and returns a downscaled preview for the cropper.
#[tauri::command]
pub async fn prepare_artwork_preview(source: String) -> Result<ArtworkPreview, String> {
    let bytes = load_source(&source).await?;
    tauri::async_runtime::spawn_blocking(move || build_preview(&bytes)).await.map_err(|error| error.to_string())?
}

/// Crops `source` to a 600x800 cover, stores it under `cache_key` in the artwork cache and returns it as a data URL.
#[tauri::command]
pub async fn save_custom_artwork(app: AppHandle, cache_key: String, source: String, crop: CropRect) -> Result<String, String> {
    let target = cache_path(&app, &cache_key)?.with_extension("jpg");
    let bytes = load_source(&source).await?;
    let cover = tauri::async_runtime::spawn_blocking(move || render_cover(&bytes, crop)).await.map_err(|error| error.to_string())??;
    let dir = target.parent().ok_or("Invalid artwork folder.")?;
    // Replace whatever was cached for this key (any extension) so the custom image wins.
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            if entry.path().file_stem().and_then(|value| value.to_str()) == Some(cache_key.as_str()) { let _ = fs::remove_file(entry.path()); }
        }
    }
    let temp = dir.join(format!("{cache_key}.jpg.tmp"));
    fs::write(&temp, &cover).map_err(|error| format!("Unable to save artwork: {error}"))?;
    fs::rename(&temp, &target).map_err(|error| format!("Unable to save artwork: {error}"))?;
    data_url(&target)
}

/// Deletes the cached image for a key (used by "Remove artwork").
#[tauri::command]
pub fn delete_game_artwork(app: AppHandle, cache_key: String) -> Result<(), String> {
    let base = cache_path(&app, &cache_key)?;
    if let Ok(entries) = fs::read_dir(base.parent().unwrap_or_else(|| std::path::Path::new("."))) {
        for entry in entries.flatten() {
            if entry.path().file_stem().and_then(|value| value.to_str()) == Some(cache_key.as_str()) { let _ = fs::remove_file(entry.path()); }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn crop(x: f64, y: f64, width: f64, height: f64) -> CropRect { CropRect { x, y, width, height } }

    #[test]
    fn crop_maps_fractions_to_pixels() {
        assert_eq!(crop_pixels(1000, 800, crop(0.25, 0.0, 0.5, 1.0)).unwrap(), (250, 0, 500, 800));
        assert_eq!(crop_pixels(1000, 800, crop(0.0, 0.0, 1.0, 1.0)).unwrap(), (0, 0, 1000, 800));
    }

    #[test]
    fn crop_is_clamped_inside_the_image() {
        let (x, y, w, h) = crop_pixels(100, 100, crop(0.9999, 0.9999, 0.0001, 0.0001)).unwrap();
        assert!(x + w <= 100 && y + h <= 100 && w >= 1 && h >= 1);
    }

    #[test]
    fn invalid_crops_are_rejected() {
        assert!(crop_pixels(100, 100, crop(f64::NAN, 0.0, 1.0, 1.0)).is_err());
        assert!(crop_pixels(100, 100, crop(0.0, 0.0, 0.0, 1.0)).is_err());
        assert!(crop_pixels(100, 100, crop(0.5, 0.0, 0.8, 1.0)).is_err());
        assert!(crop_pixels(100, 100, crop(-0.5, 0.0, 0.5, 1.0)).is_err());
    }

    #[test]
    fn dimension_limits() {
        assert!(check_dimensions(600, 800).is_ok());
        assert!(check_dimensions(0, 10).is_err());
        assert!(check_dimensions(20_001, 10).is_err());
        assert!(check_dimensions(15_000, 15_000).is_err());
    }

    #[test]
    fn blocks_private_hosts() {
        for host in ["localhost", "127.0.0.1", "10.0.0.5", "192.168.1.1", "169.254.1.1", "[::1]", "printer.local"] { assert!(is_blocked_host(host), "{host}"); }
        for host in ["example.com", "93.184.216.34"] { assert!(!is_blocked_host(host), "{host}"); }
    }

    #[test]
    fn data_url_validation() {
        assert!(decode_data_url("data:text/html;base64,AAAA").is_err());
        assert!(decode_data_url("nonsense").is_err());
        assert_eq!(decode_data_url("data:image/png;base64,AQID").unwrap(), vec![1, 2, 3]);
    }

    #[test]
    fn renders_a_cover_and_previews() {
        let source = DynamicImage::ImageRgb8(image::RgbImage::from_pixel(1200, 900, image::Rgb([200, 40, 40])));
        let mut png = Vec::new();
        source.write_to(&mut Cursor::new(&mut png), ImageFormat::Png).unwrap();
        let cover = render_cover(&png, crop(0.25, 0.0, 0.5625, 1.0)).unwrap();
        let decoded = image::load_from_memory(&cover).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (COVER_WIDTH, COVER_HEIGHT));
        let preview = build_preview(&png).unwrap();
        assert_eq!((preview.width, preview.height), (1200, 900));
        assert!(preview.data_url.starts_with("data:image/jpeg;base64,"));
    }

    #[test]
    fn rejects_garbage_bytes() {
        assert!(decode_image(b"not an image").is_err());
        assert!(decode_image(&[]).is_err());
    }
}
