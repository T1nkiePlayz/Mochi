import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

/** Normalised crop rectangle: fractions (0..1) of the source image. */
export type CropRect = { x: number; y: number; width: number; height: number };
export type ArtworkPreview = { dataUrl: string; width: number; height: number };

/** Event fired after a game's cached artwork changed on disk, so mounted covers reload. */
export const ARTWORK_CHANGED_EVENT = "mochi-artwork-changed";
export const notifyArtworkChanged = (cacheKey: string) => window.dispatchEvent(new CustomEvent(ARTWORK_CHANGED_EVENT, { detail: cacheKey }));

/** Decodes an image (local path, http(s) URL or data URL) natively with size limits and returns a downscaled preview. */
export const prepareArtworkPreview = (source: string) => invoke<ArtworkPreview>("prepare_artwork_preview", { source });
export const deleteGameArtwork = async (cacheKey: string) => { await invoke("delete_game_artwork", { cacheKey }); notifyArtworkChanged(cacheKey); };

/** Crops `source` to a 600x800 cover and stores it as the game's cached artwork. */
export async function saveCustomArtwork(cacheKey: string, source: string, crop: CropRect): Promise<string> {
  const url = await invoke<string>("save_custom_artwork", { cacheKey, source, crop });
  notifyArtworkChanged(cacheKey);
  return url;
}

export async function chooseImageFile(): Promise<string | null> {
  const selected = await open({ multiple: false, directory: false, title: "Choose cover image", filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }] });
  return typeof selected === "string" ? selected : null;
}

const imageName = /\.(png|jpe?g|webp|gif)$/i;
export const isImagePath = (path: string) => imageName.test(path);

/** Reads a browser File/Blob (pasted or dropped) into a data URL the native side can decode. */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read that image."));
    reader.readAsDataURL(blob);
  });
}

/** Whether the text looks like an http(s) URL the user could have pasted. */
export const looksLikeImageUrl = (text: string) => /^https?:\/\/\S+$/i.test(text.trim());

/** Largest rectangle of aspect `ratio` (w/h) that fits an image, centred, as a normalised crop. */
export function defaultCrop(imageWidth: number, imageHeight: number, ratio: number): CropRect {
  if (!(imageWidth > 0 && imageHeight > 0 && ratio > 0)) return { x: 0, y: 0, width: 1, height: 1 };
  const imageRatio = imageWidth / imageHeight;
  if (imageRatio > ratio) { const width = ratio / imageRatio; return { x: (1 - width) / 2, y: 0, width, height: 1 }; }
  const height = imageRatio / ratio;
  return { x: 0, y: (1 - height) / 2, width: 1, height };
}

/** Crop for a given zoom (>=1) and centre (normalised image coordinates), kept inside the image. */
export function cropFromView(imageWidth: number, imageHeight: number, ratio: number, zoom: number, centerX: number, centerY: number): CropRect {
  const base = defaultCrop(imageWidth, imageHeight, ratio);
  const width = base.width / Math.max(1, zoom);
  const height = base.height / Math.max(1, zoom);
  return {
    x: Math.min(1 - width, Math.max(0, centerX - width / 2)),
    y: Math.min(1 - height, Math.max(0, centerY - height / 2)),
    width, height,
  };
}
