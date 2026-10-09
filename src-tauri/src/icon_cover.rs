//! Turns a small picture (a desktop entry's icon, an app bundle's `.icns`, a launcher company's
//! logo) into a 600x800 cover in the artwork cache, for games and launchers without real artwork.

use crate::game_artwork::{cache_path, data_url, decode_image, download_allowed_artwork, encode_jpeg, find_cached, write_atomic};
use crate::sources::icons::{icns_largest_png, MAX_ICON_BYTES};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use image::{imageops::FilterType, DynamicImage, GenericImageView, Rgba, RgbaImage};
use serde::Serialize;
use std::{fs, io::Read, path::Path};
use tauri::AppHandle;

const COVER_WIDTH: u32 = 600;
const COVER_HEIGHT: u32 = 800;
/// Largest edge of the picture on the cover.
const MARK_EDGE: u32 = 300;

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct IconCover {
    /// The cached cover as a data URL.
    pub cover: Option<String>,
    /// An SVG icon's markup: the web view rasterises it and calls again with a PNG data URL.
    pub svg: Option<String>,
}

/// Average colour of the visible pixels (alpha-weighted) as 0-255 RGB.
fn average_colour(image: &RgbaImage) -> [f32; 3] {
    let (mut sum, mut weight) = ([0f64; 3], 0f64);
    for pixel in image.pixels() {
        let alpha = f64::from(pixel[3]) / 255.0;
        for (channel, total) in sum.iter_mut().enumerate() { *total += f64::from(pixel[channel]) * alpha; }
        weight += alpha;
    }
    if weight < 1.0 { return [90.0, 90.0, 110.0]; }
    sum.map(|value| (value / weight) as f32)
}

fn luminance([r, g, b]: [f32; 3]) -> f32 { (0.299 * r + 0.587 * g + 0.114 * b) / 255.0 }

fn mix(colour: [f32; 3], toward: f32, amount: f32) -> [f32; 3] { colour.map(|value| value + (toward - value) * amount) }

/// Draws `mark` centred on a vertical gradient taken from its own colour. Dark marks (black
/// wordmarks) get a light background and light marks a dark one, so the picture stays legible.
pub fn compose_cover(mark: &DynamicImage) -> RgbaImage {
    let small = mark.resize(64, 64, FilterType::Triangle).to_rgba8();
    let average = average_colour(&small);
    let light_mark = luminance(average) >= 0.35;
    let (top, bottom) = if light_mark { (mix(average, 0.0, 0.45), mix(average, 0.0, 0.82)) } else { (mix(average, 255.0, 0.82), mix(average, 255.0, 0.55)) };
    let mut cover = RgbaImage::from_fn(COVER_WIDTH, COVER_HEIGHT, |_, y| {
        let t = y as f32 / (COVER_HEIGHT - 1) as f32;
        let [r, g, b] = [0, 1, 2].map(|i| (top[i] + (bottom[i] - top[i]) * t).round().clamp(0.0, 255.0) as u8);
        Rgba([r, g, b, 255])
    });
    let (width, height) = mark.dimensions();
    // Small icons are scaled up at most 4x (and crisply), big ones down to the mark size.
    let edge = MARK_EDGE.min(width.max(height).saturating_mul(4)).max(1);
    let filter = if width.max(height) * 2 <= edge { FilterType::Nearest } else { FilterType::Lanczos3 };
    let scaled = mark.resize(edge, edge, filter).to_rgba8();
    let x = (COVER_WIDTH - scaled.width()) / 2;
    let y = (COVER_HEIGHT - scaled.height()) / 2 - 30;
    image::imageops::overlay(&mut cover, &scaled, i64::from(x), i64::from(y));
    cover
}

fn read_capped(path: &Path) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    fs::File::open(path).map_err(|_| "The icon file could not be opened.".to_string())?
        .take(MAX_ICON_BYTES + 1).read_to_end(&mut bytes).map_err(|_| "The icon file could not be read.".to_string())?;
    if bytes.is_empty() || bytes.len() as u64 > MAX_ICON_BYTES { return Err("The icon file is empty or too large.".into()); }
    Ok(bytes)
}

/// What a source holds: raster bytes to compose, or SVG markup for the web view to rasterise.
#[derive(Debug, PartialEq)]
enum Loaded { Raster(Vec<u8>), Svg(String) }

fn load_local(source: &str) -> Result<Loaded, String> {
    let path = fs::canonicalize(source).map_err(|_| "The icon file could not be found.".to_string())?;
    let extension = path.extension().and_then(|ext| ext.to_str()).map(str::to_ascii_lowercase).unwrap_or_default();
    let bytes = read_capped(&path)?;
    match extension.as_str() {
        "svg" => {
            let text = String::from_utf8(bytes).map_err(|_| "The SVG icon is not valid text.".to_string())?;
            if !text.contains("<svg") { return Err("The SVG icon is not an SVG image.".into()); }
            Ok(Loaded::Svg(text))
        }
        "icns" => icns_largest_png(&bytes).map(|png| Loaded::Raster(png.to_vec())).ok_or_else(|| "The .icns file has no PNG image.".to_string()),
        "png" | "jpg" | "jpeg" | "webp" => Ok(Loaded::Raster(bytes)),
        _ => Err("Only PNG, JPEG, WebP, SVG and .icns icons can be used.".into()),
    }
}

fn decode_png_data_url(source: &str) -> Result<Vec<u8>, String> {
    let payload = source.strip_prefix("data:image/png;base64,").ok_or("Only PNG data can be used.")?;
    if payload.len() as u64 > MAX_ICON_BYTES * 4 / 3 + 16 { return Err("The icon is too large.".into()); }
    STANDARD.decode(payload.trim()).map_err(|_| "Invalid icon data.".to_string())
}

/// Builds and caches a cover from `source`: a local icon path, a `data:image/png;base64,` URL
/// (a rasterised SVG) or an allow-listed artwork URL (IGDB company logos). Unless `replace`
/// is set, an existing cached cover is kept and returned, so a game's real artwork is never
/// replaced by its icon.
#[tauri::command]
pub async fn cache_icon_cover(app: AppHandle, cache_key: String, source: String, replace: Option<bool>) -> Result<IconCover, String> {
    let base = cache_path(&app, &cache_key)?;
    if replace != Some(true) {
        let probe = base.clone();
        if let Some(existing) = crate::util::blocking(move || find_cached(&probe).map(|path| data_url(&path)).transpose()).await?? {
            return Ok(IconCover { cover: Some(existing), svg: None });
        }
    }
    let source = source.trim().to_owned();
    let loaded = if source.starts_with("https://") {
        Loaded::Raster(download_allowed_artwork(&source).await?)
    } else if source.starts_with("data:") {
        Loaded::Raster(decode_png_data_url(&source)?)
    } else if source.starts_with('/') {
        let path = source.clone();
        crate::util::blocking(move || load_local(&path)).await??
    } else {
        return Err("Unsupported icon source.".into());
    };
    let bytes = match loaded {
        Loaded::Svg(svg) => return Ok(IconCover { cover: None, svg: Some(svg) }),
        Loaded::Raster(bytes) => bytes,
    };
    crate::util::blocking(move || {
        let cover = encode_jpeg(&DynamicImage::ImageRgba8(compose_cover(&decode_image(&bytes)?)))?;
        let target = base.with_extension("jpg");
        write_atomic(&target, &cover)?;
        for extension in ["png", "webp"] { let _ = fs::remove_file(base.with_extension(extension)); }
        Ok(IconCover { cover: Some(data_url(&target)?), svg: None })
    }).await?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sources::testutil::temp_dir;

    fn square(size: u32, colour: [u8; 4]) -> DynamicImage {
        DynamicImage::ImageRgba8(RgbaImage::from_pixel(size, size, Rgba(colour)))
    }

    #[test]
    fn covers_are_portrait_with_the_mark_centred() {
        let cover = compose_cover(&square(256, [240, 200, 40, 255]));
        assert_eq!(cover.dimensions(), (COVER_WIDTH, COVER_HEIGHT));
        assert_eq!(cover.get_pixel(300, 370).0[..3], [240, 200, 40]);
        // The background is a darker shade of the icon colour.
        let corner = cover.get_pixel(5, 5);
        assert!(corner[0] < 200 && corner[0] > corner[2]);
    }

    #[test]
    fn dark_marks_get_a_light_background_and_tiny_icons_are_scaled_up() {
        let cover = compose_cover(&square(32, [10, 10, 10, 255]));
        assert!(luminance([cover.get_pixel(5, 5)[0] as f32, cover.get_pixel(5, 5)[1] as f32, cover.get_pixel(5, 5)[2] as f32]) > 0.6);
        // 32px is drawn at 4x (128px), centred.
        assert_eq!(cover.get_pixel(300 - 60, 370).0[..3], [10, 10, 10]);
        assert_ne!(cover.get_pixel(300 - 70, 370).0[..3], [10, 10, 10]);
        // A fully transparent picture still produces a cover.
        assert_eq!(compose_cover(&square(16, [0, 0, 0, 0])).dimensions(), (COVER_WIDTH, COVER_HEIGHT));
    }

    #[test]
    fn local_sources_are_typed_and_capped() {
        let dir = temp_dir("icon-cover");
        fs::write(dir.join("a.svg"), "<?xml version=\"1.0\"?><svg xmlns=\"http://www.w3.org/2000/svg\"/>").unwrap();
        fs::write(dir.join("b.svg"), "not svg").unwrap();
        fs::write(dir.join("c.png"), [0x89, b'P', b'N', b'G']).unwrap();
        fs::write(dir.join("d.txt"), "x").unwrap();
        let path = |name: &str| dir.join(name).to_string_lossy().into_owned();
        assert!(matches!(load_local(&path("a.svg")), Ok(Loaded::Svg(_))));
        assert!(load_local(&path("b.svg")).is_err());
        assert!(matches!(load_local(&path("c.png")), Ok(Loaded::Raster(_))));
        assert!(load_local(&path("d.txt")).is_err());
        assert!(load_local(&path("missing.png")).is_err());
        let big = dir.join("big.png");
        fs::File::create(&big).unwrap().set_len(MAX_ICON_BYTES + 1).unwrap();
        assert!(load_local(&big.to_string_lossy()).is_err());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn only_png_data_urls_are_accepted() {
        assert_eq!(decode_png_data_url("data:image/png;base64,iVBORw==").unwrap(), [0x89, b'P', b'N', b'G']);
        assert!(decode_png_data_url("data:image/svg+xml;base64,PHN2Zz4=").is_err());
        assert!(decode_png_data_url("data:image/png;base64,!!!").is_err());
    }
}
