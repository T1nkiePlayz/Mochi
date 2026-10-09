import { convertFileSrc, invoke } from "@tauri-apps/api/core";

const MAX_ENTRIES = 400; // entries are short asset URLs; the webview keeps the decoded images
const values = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();

type ArtworkFile = { path: string; version: number };

/** Short asset-protocol URL for a cached cover; `?v=` (file mtime) makes a replaced cover reload. Data URLs (browser dev mock) pass through. */
const artworkUrl = (file: ArtworkFile | null): string | null => {
  if (!file) return null;
  return file.path.startsWith("data:") ? file.path : `${convertFileSrc(file.path)}?v=${file.version}`;
};

/** The cached cover for a game, if it was already loaded this session (no native call). */
export const peekArtwork = (cacheKey: string): string | undefined => {
  const value = values.get(cacheKey);
  if (value !== undefined) { values.delete(cacheKey); values.set(cacheKey, value); } // most recently used goes last
  return value;
};

/** Loads a game's cached cover once per session; concurrent callers share one native call. Misses are not remembered. */
export function loadArtwork(cacheKey: string): Promise<string | null> {
  const known = peekArtwork(cacheKey);
  if (known !== undefined) return Promise.resolve(known);
  let pending = inflight.get(cacheKey);
  if (!pending) {
    pending = invoke<ArtworkFile | null>("get_cached_game_artwork_path", { cacheKey })
      .then(artworkUrl)
      .then((value) => {
        if (inflight.get(cacheKey) === pending && value) {
          values.set(cacheKey, value);
          if (values.size > MAX_ENTRIES) values.delete(values.keys().next().value as string);
        }
        return value;
      })
      .catch(() => null)
      .finally(() => { if (inflight.get(cacheKey) === pending) inflight.delete(cacheKey); });
    inflight.set(cacheKey, pending);
  }
  return pending;
}

/** Forget a cover after it changed on disk. */
export function invalidateArtwork(cacheKey: string): void {
  values.delete(cacheKey);
  inflight.delete(cacheKey);
}
