/** Local storage helpers. Every access is guarded: storage can be missing or throw (private windows, quota). */
export const storageKeys = {
  pikos: "mochi:pikos",
  settings: "mochi:settings",
  /** Device-wide copy of the "open in Big Picture on startup" choice; read before any profile is loaded. */
  bigPictureStartup: "mochi:bigpicture-startup",
  setupComplete: "mochi:setup-complete",
  importSources: "mochi:import-sources",
  accounts: "mochi:accounts",
  notifications: "mochi:notifications",
  librarySort: "mochi:library-sort",
  libraryFilter: "mochi:library-filter",
  accessibility: "mochi:accessibility",
  collections: "mochi:collections",
  /** Games the user wants but does not own (`src/lib/wishlist.ts`). */
  wishlist: "mochi:wishlist",
  /** Deal alerts: store toggles and the alert/check bookkeeping (`src/lib/deals.ts`). */
  dealsStores: "mochi:deals-stores",
  dealsState: "mochi:deals-state",
  /** User corrections of game/launcher detection, keyed by import id. */
  launcherOverrides: "mochi:launcher-overrides",
  /** Pairs of games the user said are not the same game (`src/lib/duplicates.ts`). */
  duplicateDismissed: "mochi:duplicate-dismissed",
} as const;

export const igdbCacheKey = (userId?: string) => `mochi:igdb-cache:${userId || "local"}`;
export const profileStorageKey = (userId: string, key: string) => `mochi:profile:${userId}:${key}`;

// Debounced writes: large values (the library) change in bursts, so only the latest one per key is serialised.
const pendingWrites = new Map<string, unknown>();
let pendingTimer: ReturnType<typeof setTimeout> | undefined;
let flushHooked = false;

/** Writes every pending debounced value now. Also runs when the window is hidden or closed. */
export function flushPendingWrites(): void {
  if (pendingTimer !== undefined) { clearTimeout(pendingTimer); pendingTimer = undefined; }
  const entries = [...pendingWrites];
  pendingWrites.clear();
  for (const [key, value] of entries) writeJsonNow(key, value);
}

/** Drops pending debounced writes (used before wiping local data so they cannot resurrect it). */
export function discardPendingWrites(): void {
  if (pendingTimer !== undefined) { clearTimeout(pendingTimer); pendingTimer = undefined; }
  pendingWrites.clear();
}

/** Like `writeJson`, but coalesces rapid updates into one write after `delayMs`. Reads and direct writes of the same key stay consistent. */
export function writeJsonDebounced(key: string, value: unknown, delayMs = 400): void {
  if (!flushHooked && typeof window !== "undefined") {
    flushHooked = true;
    window.addEventListener("pagehide", flushPendingWrites);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushPendingWrites(); });
  }
  pendingWrites.set(key, value);
  if (pendingTimer !== undefined) clearTimeout(pendingTimer);
  pendingTimer = setTimeout(flushPendingWrites, delayMs);
}

export function readJson<T>(key: string, fallback: T): T {
  if (pendingWrites.has(key)) flushPendingWrites();
  try {
    const value = window.localStorage.getItem(key);
    if (!value) return fallback;
    const parsed = JSON.parse(value) as T | null;
    // A stored literal `null` must behave like "missing", not crash callers that expect an object or array.
    return parsed === null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

/** Returns false when the value could not be saved (storage full, unavailable, or not serialisable). */
export function writeJson(key: string, value: unknown): boolean {
  pendingWrites.delete(key); // an older debounced value must not overwrite this one later
  return writeJsonNow(key, value);
}

function writeJsonNow(key: string, value: unknown): boolean {
  try { window.localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

export function readString(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}

export function writeString(key: string, value: string): void {
  try { window.localStorage.setItem(key, value); } catch { /* storage unavailable or full */ }
}

export function removeKey(key: string): void {
  try { window.localStorage.removeItem(key); } catch { /* storage unavailable */ }
}
