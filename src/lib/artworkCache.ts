import { invoke } from "@tauri-apps/api/core";

const MAX_ENTRIES = 150; // each entry is a ~100 kB data URL
const values = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();

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
    pending = invoke<string | null>("get_cached_game_artwork", { cacheKey })
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
