use base64::{engine::general_purpose::STANDARD, Engine as _};
use crate::util::{fsio, http, valid_id};
use std::{fs, path::{Path, PathBuf}};
use image::{imageops::FilterType, metadata::Orientation, DynamicImage, ImageDecoder, ImageFormat, ImageReader, Limits};
use serde::{Deserialize, Serialize};
use std::io::Cursor;
use tauri::{AppHandle, Manager};

const MAX_IMAGE_BYTES: usize = 15 * 1024 * 1024;
const CACHE_EXTENSIONS: [&str; 3] = ["jpg", "png", "webp"];
const ARTWORK_HOSTS: [&str; 7] = [
    "images.igdb.com", "cdn2.steamgriddb.com", "cdn.steamgriddb.com", "shared.akamai.steamstatic.com",
    "cdn.akamai.steamstatic.com", "shared.cloudflare.steamstatic.com", "cdn.cloudflare.steamstatic.com",
];

fn allowed_artwork_url(url: &reqwest::Url) -> bool {
    let Some(host) = url.host_str() else { return false };
    url.scheme() == "https" && url.port().is_none() && url.username().is_empty() && url.password().is_none()
        && ARTWORK_HOSTS.contains(&host) && (host != "images.igdb.com" || url.path().starts_with("/igdb/image/upload/"))
}

fn valid_cache_key(key: &str) -> bool {
    valid_id(key, 120)
}

/// The key is used verbatim (no trimming): every lookup below compares against the same exact string.
pub(crate) fn cache_path(app: &AppHandle, key: &str) -> Result<PathBuf, String> {
    if !valid_cache_key(key) {
        return Err("Invalid game artwork cache key.".into());
    }
    Ok(crate::themes::game_artwork_cache_dir(app)?.join(key))
}

fn mime_for_path(path: &Path) -> &'static str {
    match path.extension().and_then(|value| value.to_str()).unwrap_or("") {
        "png" => "image/png",
        "webp" => "image/webp",
        _ => "image/jpeg",
    }
}

pub(crate) fn data_url(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|error| format!("Unable to read cached artwork: {error}"))?;
    Ok(format!("data:{};base64,{}", mime_for_path(path), STANDARD.encode(bytes)))
}

/// The cached file for `base` (the extension-less path), probing the few extensions Mochi writes.
pub(crate) fn find_cached(base: &Path) -> Option<PathBuf> {
    CACHE_EXTENSIONS.iter().map(|extension| base.with_extension(extension)).find(|candidate| candidate.is_file())
}

/// Drops any cached file for `base` (whatever its extension) so a changed artwork source is fetched afresh.
pub(crate) fn remove_cached(base: &Path) {
    for extension in CACHE_EXTENSIONS { let _ = fs::remove_file(base.with_extension(extension)); }
}

/// Image type from the file's magic bytes. The server's Content-Type is not trusted on its own.
fn sniff_image_extension(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0xff, 0xd8, 0xff]) { Some("jpg") }
    else if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]) { Some("png") }
    else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" { Some("webp") }
    else { None }
}

pub(crate) fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    fsio::write_atomic(path, bytes).map_err(|error| format!("Unable to save artwork in Mochi's config folder: {error}"))
}

#[tauri::command]
pub async fn cache_game_artwork(app: AppHandle, url: String, cache_key: String, force: Option<bool>) -> Result<String, String> {
    let base = cache_path(&app, &cache_key)?;
    // Probing the cache and base64-encoding an image is disk/CPU work: off the async workers.
    let hit = {
        let base = base.clone();
        crate::util::blocking(move || {
            if force == Some(true) { remove_cached(&base); }
            find_cached(&base).map(|existing| data_url(&existing)).transpose()
        }).await??
    };
    if let Some(cached) = hit { return Ok(cached); }
    let bytes = download_allowed_artwork(&url).await?;
    let extension = sniff_image_extension(&bytes).ok_or("The artwork server returned an unsupported artwork format.")?;
    crate::util::blocking(move || {
        // Another request for the same key may have finished first; keep whichever file is already there.
        if let Some(existing) = find_cached(&base) { return data_url(&existing); }
        let path = base.with_extension(extension);
        write_atomic(&path, &bytes)?;
        data_url(&path)
    }).await?
}

/// Downloads an image from an allow-listed artwork host (IGDB, SteamGridDB, Steam CDN), capped at 15 MiB.
pub(crate) async fn download_allowed_artwork(url: &str) -> Result<Vec<u8>, String> {
    let parsed = reqwest::Url::parse(url).map_err(|_| "Invalid artwork URL.".to_string())?;
    if !allowed_artwork_url(&parsed) { return Err("Only IGDB, SteamGridDB and Steam artwork URLs can be cached.".into()); }
    static CLIENT: http::SharedClient = http::SharedClient::new();
    let client = CLIENT.get(|| http::builder().connect_timeout(std::time::Duration::from_secs(10)).timeout(std::time::Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() < 3 && allowed_artwork_url(attempt.url()) { attempt.follow() } else { attempt.stop() }
        }))
        .build(), "Unable to prepare artwork request")?;
    let mut response = client.get(parsed).send().await.map_err(|error| format!("Unable to download game artwork: {error}"))?;
    if !response.status().is_success() { return Err(format!("Artwork server returned HTTP {}.", response.status())); }
    let bytes = http::read_capped(&mut response, MAX_IMAGE_BYTES).await.map_err(|error| match error {
        http::BodyError::TooLarge => "Artwork is larger than the 15 MiB cache limit.".to_string(),
        http::BodyError::Network(error) => format!("Unable to read downloaded artwork: {error}"),
    })?;
    if bytes.is_empty() { return Err("Artwork has an invalid size.".into()); }
    Ok(bytes)
}

#[tauri::command(async)]
pub fn get_cached_game_artwork(app: AppHandle, cache_key: String) -> Result<Option<String>, String> {
    let base = cache_path(&app, &cache_key)?;
    find_cached(&base).map(|path| data_url(&path)).transpose()
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtworkFile {
    pub path: String,
    /// Modification time in milliseconds, used by the frontend as a cache-busting query.
    pub version: u64,
}

/// Resolves the cached cover for `base` to a canonical path that is verified to live inside `cache_dir`.
fn cached_file_in(cache_dir: &Path, base: &Path) -> Result<Option<(PathBuf, u64)>, String> {
    let Some(found) = find_cached(base) else { return Ok(None) };
    let root = cache_dir.canonicalize().map_err(|error| format!("Unable to resolve the artwork cache: {error}"))?;
    let path = found.canonicalize().map_err(|error| format!("Unable to resolve cached artwork: {error}"))?;
    if !path.starts_with(&root) { return Err("Cached artwork is outside the artwork cache.".into()); }
    let version = fs::metadata(&path).and_then(|meta| meta.modified()).ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok()).map_or(0, |age| age.as_millis() as u64);
    Ok(Some((path, version)))
}

/// Like `get_cached_game_artwork`, but returns the file path so the webview can load it through the asset protocol
/// instead of receiving the bytes base64-encoded over IPC.
#[tauri::command(async)]
pub fn get_cached_game_artwork_path(app: AppHandle, cache_key: String) -> Result<Option<ArtworkFile>, String> {
    let base = cache_path(&app, &cache_key)?;
    let dir = crate::themes::game_artwork_cache_dir(&app)?;
    let Some((path, version)) = cached_file_in(&dir, &base)? else { return Ok(None) };
    // The artwork folder can be relocated with the config folder, so the static scope in tauri.conf.json may not cover it.
    // Allow exactly this folder (nothing else) before handing out a path in it.
    if let Ok(root) = dir.canonicalize() { let _ = app.asset_protocol_scope().allow_directory(root, true); }
    Ok(Some(ArtworkFile { path: path.to_string_lossy().into_owned(), version }))
}

#[tauri::command(async)]
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
const MAX_SOURCE_PIXELS: u64 = 100_000_000;
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
    limits.max_alloc = Some(768 * 1024 * 1024);
    reader.limits(limits);
    match reader.format() {
        Some(ImageFormat::Png | ImageFormat::Jpeg | ImageFormat::WebP | ImageFormat::Gif) => Ok(reader),
        _ => Err("Use a PNG, JPEG, WebP or GIF image.".into()),
    }
}

pub(crate) fn decode_image(bytes: &[u8]) -> Result<DynamicImage, String> {
    if bytes.is_empty() || bytes.len() as u64 > MAX_SOURCE_BYTES { return Err("The image is empty or larger than 100 MB.".into()); }
    let (width, height) = image_reader(bytes)?.into_dimensions().map_err(|error| format!("Unable to read this image: {error}"))?;
    check_dimensions(width, height)?;
    let mut decoder = image_reader(bytes)?.into_decoder().map_err(|error| format!("Unable to read this image: {error}"))?;
    // Phone photos are often stored sideways with an EXIF rotation; honour it so the crop matches what the user sees elsewhere.
    let orientation = decoder.orientation().unwrap_or(Orientation::NoTransforms);
    let mut image = DynamicImage::from_decoder(decoder).map_err(|error| format!("Unable to read this image: {error}"))?;
    image.apply_orientation(orientation);
    Ok(image)
}

pub(crate) fn encode_jpeg(image: &DynamicImage) -> Result<Vec<u8>, String> {
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

fn is_blocked_ipv4(ip: std::net::Ipv4Addr) -> bool {
    let [a, b, c, _] = ip.octets();
    ip.is_loopback() || ip.is_private() || ip.is_link_local() || ip.is_unspecified() || ip.is_broadcast() || ip.is_multicast()
        || a == 0                                   // 0.0.0.0/8 "this network"
        || (a == 100 && (64..128).contains(&b))     // 100.64.0.0/10 carrier-grade NAT
        || (a == 192 && b == 0 && c == 0)           // 192.0.0.0/24 IETF protocol assignments
        || (a == 198 && (b == 18 || b == 19))       // 198.18.0.0/15 benchmarking
        || a >= 240                                 // reserved
}

fn is_blocked_ip(ip: std::net::IpAddr) -> bool {
    match ip {
        std::net::IpAddr::V4(v4) => is_blocked_ipv4(v4),
        std::net::IpAddr::V6(v6) => {
            let segments = v6.segments();
            // ::ffff:a.b.c.d (mapped), ::a.b.c.d (compatible) and 64:ff9b::a.b.c.d (NAT64) all carry an IPv4 address.
            let embedded = v6.to_ipv4_mapped().or_else(|| {
                let [s0, s1, s2, s3, s4, s5, hi, lo] = segments;
                let tail = std::net::Ipv4Addr::new((hi >> 8) as u8, hi as u8, (lo >> 8) as u8, lo as u8);
                ((s0, s1, s2, s3, s4, s5) == (0, 0, 0, 0, 0, 0) || (s0, s1, s2, s3, s4, s5) == (0x64, 0xff9b, 0, 0, 0, 0)).then_some(tail)
            });
            if let Some(v4) = embedded { return is_blocked_ipv4(v4); }
            v6.is_loopback() || v6.is_unspecified() || v6.is_multicast() || (segments[0] & 0xfe00) == 0xfc00 || (segments[0] & 0xffc0) == 0xfe80
        }
    }
}

fn is_blocked_host(host: &str) -> bool {
    let host = host.trim_matches(|c| c == '[' || c == ']').trim_end_matches('.').to_ascii_lowercase();
    if host.is_empty() || host == "localhost" { return true; }
    if [".localhost", ".local", ".internal", ".lan", ".localdomain", ".home.arpa"].iter().any(|suffix| host.ends_with(suffix)) { return true; }
    host.parse::<std::net::IpAddr>().is_ok_and(is_blocked_ip)
}

/// Resolves names itself and drops private/loopback answers, so a public-looking hostname (or DNS rebinding)
/// cannot reach services on the user's machine or LAN. Literal IPs never hit the resolver; `is_blocked_host` covers those.
struct PublicOnlyResolver;

impl reqwest::dns::Resolve for PublicOnlyResolver {
    fn resolve(&self, name: reqwest::dns::Name) -> reqwest::dns::Resolving {
        let host = name.as_str().to_owned();
        Box::pin(async move {
            let found = tauri::async_runtime::spawn_blocking(move || std::net::ToSocketAddrs::to_socket_addrs(&(host.as_str(), 0)).map(Iterator::collect::<Vec<_>>)).await
                .map_err(|error| Box::new(error) as Box<dyn std::error::Error + Send + Sync>)?
                .map_err(|error| Box::new(error) as Box<dyn std::error::Error + Send + Sync>)?;
            let public: Vec<std::net::SocketAddr> = found.into_iter().filter(|address| !is_blocked_ip(address.ip())).collect();
            if public.is_empty() { return Err("That host resolves to a private address.".into()); }
            Ok(Box::new(public.into_iter()) as reqwest::dns::Addrs)
        })
    }
}

async fn download_image(url: &str) -> Result<Vec<u8>, String> {
    let parsed = reqwest::Url::parse(url).map_err(|_| "That is not a valid image URL.".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none_or(is_blocked_host) {
        return Err("Only public http(s) image URLs are supported.".into());
    }
    static CLIENT: http::SharedClient = http::SharedClient::new();
    let client = CLIENT.get(|| http::builder().connect_timeout(std::time::Duration::from_secs(10)).timeout(std::time::Duration::from_secs(60))
        .dns_resolver(std::sync::Arc::new(PublicOnlyResolver))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            let allowed = attempt.previous().len() < 4 && matches!(attempt.url().scheme(), "http" | "https") && attempt.url().host_str().is_some_and(|host| !is_blocked_host(host));
            if allowed { attempt.follow() } else { attempt.stop() }
        }))
        .build(), "Unable to prepare the download")?;
    let mut response = client.get(parsed).send().await.map_err(|error| format!("Unable to download the image: {error}"))?;
    if !response.status().is_success() { return Err(format!("The image server returned HTTP {}.", response.status())); }
    http::read_capped(&mut response, MAX_SOURCE_BYTES as usize).await.map_err(|error| match error {
        http::BodyError::TooLarge => "The image is larger than 100 MB.".to_string(),
        http::BodyError::Network(error) => format!("The download was interrupted: {error}"),
    })
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
    let source = source.to_owned();
    // Up to 100 MB of disk I/O: keep it off the async workers.
    tauri::async_runtime::spawn_blocking(move || {
        let path = fs::canonicalize(&source).map_err(|_| "That image file could not be found.".to_string())?;
        let meta = fs::metadata(&path).map_err(|error| format!("Unable to read the image file: {error}"))?;
        if !meta.is_file() { return Err("Choose an image file, not a folder.".into()); }
        if meta.len() > MAX_SOURCE_BYTES { return Err("The image is larger than 100 MB.".into()); }
        let mut bytes = Vec::new();
        std::io::Read::read_to_end(&mut std::io::Read::take(fs::File::open(&path).map_err(|error| format!("Unable to read the image file: {error}"))?, MAX_SOURCE_BYTES + 1), &mut bytes)
            .map_err(|error| format!("Unable to read the image file: {error}"))?;
        if bytes.len() as u64 > MAX_SOURCE_BYTES { return Err("The image is larger than 100 MB.".into()); }
        Ok(bytes)
    }).await.map_err(|error| error.to_string())?
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
    crate::util::blocking(move || build_preview(&bytes)).await?
}

/// Crops `source` to a 600x800 cover, stores it under `cache_key` in the artwork cache and returns it as a data URL.
#[tauri::command]
pub async fn save_custom_artwork(app: AppHandle, cache_key: String, source: String, crop: CropRect) -> Result<String, String> {
    let base = cache_path(&app, &cache_key)?;
    let target = base.with_extension("jpg");
    let bytes = load_source(&source).await?;
    let cover = crate::util::blocking(move || render_cover(&bytes, crop)).await??;
    // Write first (atomically), then drop the other-extension leftovers, so a failed save never loses the old artwork.
    crate::util::blocking(move || -> Result<String, String> {
        write_atomic(&target, &cover)?;
        for extension in ["png", "webp"] { let _ = fs::remove_file(base.with_extension(extension)); }
        data_url(&target)
    }).await?
}

/// Deletes the cached image for a key (used by "Remove artwork").
#[tauri::command(async)]
pub fn delete_game_artwork(app: AppHandle, cache_key: String) -> Result<(), String> {
    remove_cached(&cache_path(&app, &cache_key)?);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    trait Pair { fn dimensions_pair(&self) -> (u32, u32); }
    impl Pair for DynamicImage { fn dimensions_pair(&self) -> (u32, u32) { (self.width(), self.height()) } }

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
        for host in [
            "localhost", "127.0.0.1", "10.0.0.5", "192.168.1.1", "169.254.1.1", "[::1]", "printer.local", "localhost.", "LOCALHOST", "a.localhost",
            "0.0.0.0", "0.1.2.3", "100.64.0.1", "198.18.0.1", "224.0.0.1", "255.255.255.255", "240.0.0.1", "[::ffff:127.0.0.1]", "[::ffff:7f00:1]",
            "[::ffff:10.0.0.1]", "[64:ff9b::7f00:1]", "[fd00::1]", "[fe80::1]", "[ff02::1]", "[::]", "nas.lan", "", "172.16.0.1", "[::127.0.0.1]",
        ] { assert!(is_blocked_host(host), "{host}"); }
        for host in ["example.com", "93.184.216.34", "[2606:2800:220:1:248:1893:25c8:1946]", "100.63.0.1", "8.8.8.8", "[::ffff:8.8.8.8]"] { assert!(!is_blocked_host(host), "{host}"); }
    }

    #[test]
    fn hostnames_resolving_to_localhost_are_refused() {
        let blocked = std::net::ToSocketAddrs::to_socket_addrs(&("localhost", 0)).map(|it| it.map(|a| a.ip()).all(is_blocked_ip));
        assert_eq!(blocked.ok(), Some(true));
    }

    #[test]
    fn artwork_urls_are_strictly_allow_listed() {
        let ok = |u: &str| allowed_artwork_url(&reqwest::Url::parse(u).unwrap());
        assert!(ok("https://images.igdb.com/igdb/image/upload/t_cover_big/a.jpg"));
        assert!(ok("https://cdn2.steamgriddb.com/grid/a.png"));
        assert!(!ok("https://images.igdb.com/other/a.jpg"));
        assert!(!ok("http://cdn2.steamgriddb.com/a.png"));
        assert!(!ok("https://cdn2.steamgriddb.com:8443/a.png"));
        assert!(!ok("https://user@cdn2.steamgriddb.com/a.png"));
        assert!(!ok("https://cdn2.steamgriddb.com.evil.example/a.png"));
        assert!(!ok("file:///etc/passwd"));
    }

    #[test]
    fn cache_keys_are_exact() {
        for bad in ["", " a", "a ", "a/b", "../a", "a.b", "a\0", "é", &"a".repeat(121)] { assert!(!valid_cache_key(bad), "{bad:?}"); }
        assert!(valid_cache_key("steam-220_x"));
    }

    #[test]
    fn image_types_are_sniffed_from_bytes() {
        assert_eq!(sniff_image_extension(&[0xff, 0xd8, 0xff, 0xe0]), Some("jpg"));
        assert_eq!(sniff_image_extension(b"\x89PNG\r\n\x1a\nrest"), Some("png"));
        assert_eq!(sniff_image_extension(b"RIFF\0\0\0\0WEBPVP8 "), Some("webp"));
        assert_eq!(sniff_image_extension(b"<html>"), None);
        assert_eq!(sniff_image_extension(b""), None);
        assert_eq!(sniff_image_extension(b"RIFF"), None);
    }

    #[test]
    fn cached_files_are_found_replaced_and_removed_by_exact_key() {
        let dir = std::env::temp_dir().join(format!("mochi-art-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let base = dir.join("game1");
        assert!(find_cached(&base).is_none());
        write_atomic(&base.with_extension("png"), b"x").unwrap();
        write_atomic(&dir.join("game10.jpg"), b"y").unwrap();
        assert_eq!(find_cached(&base), Some(base.with_extension("png")));
        remove_cached(&base);
        assert!(find_cached(&base).is_none() && dir.join("game10.jpg").exists());
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1, "no temp files");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn exif_orientation_is_applied() {
        let mut jpeg = Vec::new();
        DynamicImage::ImageRgb8(image::RgbImage::from_pixel(40, 20, image::Rgb([10, 200, 30]))).write_to(&mut Cursor::new(&mut jpeg), ImageFormat::Jpeg).unwrap();
        assert_eq!(decode_image(&jpeg).unwrap().dimensions_pair(), (40, 20));
        // Insert an APP1/Exif segment with Orientation = 6 (rotate 90) right after SOI.
        let tiff: Vec<u8> = [&b"II*\0"[..], &8u32.to_le_bytes(), &1u16.to_le_bytes(), &0x0112u16.to_le_bytes(), &3u16.to_le_bytes(), &1u32.to_le_bytes(), &[6, 0, 0, 0], &0u32.to_le_bytes()].concat();
        let mut app1 = b"Exif\0\0".to_vec();
        app1.extend(tiff);
        let mut rotated = vec![0xff, 0xd8, 0xff, 0xe1];
        rotated.extend(((app1.len() + 2) as u16).to_be_bytes());
        rotated.extend(app1);
        rotated.extend(&jpeg[2..]);
        assert_eq!(decode_image(&rotated).unwrap().dimensions_pair(), (20, 40));
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

#[cfg(test)]
mod asset_path_tests {
    use super::*;

    #[test]
    fn resolves_files_inside_the_cache_and_rejects_escapes() {
        let root = std::env::temp_dir().join(format!("mochi-art-path-{}", std::process::id()));
        let cache = root.join("cache");
        fs::create_dir_all(&cache).unwrap();
        fs::write(cache.join("a.png"), b"x").unwrap();
        let (path, _) = cached_file_in(&cache, &cache.join("a")).unwrap().unwrap();
        assert!(path.starts_with(cache.canonicalize().unwrap()));
        assert!(cached_file_in(&cache, &cache.join("missing")).unwrap().is_none());
        #[cfg(unix)]
        {
            fs::write(root.join("secret.png"), b"x").unwrap();
            std::os::unix::fs::symlink(root.join("secret.png"), cache.join("b.png")).unwrap();
            assert!(cached_file_in(&cache, &cache.join("b")).is_err());
        }
        let _ = fs::remove_dir_all(&root);
    }
}
