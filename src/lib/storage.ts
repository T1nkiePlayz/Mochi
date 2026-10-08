/** Local storage helpers. Every access is guarded: storage can be missing or throw (private windows, quota). */
export const storageKeys = {
  pikos: "mochi:pikos",
  settings: "mochi:settings",
  setupComplete: "mochi:setup-complete",
  importSources: "mochi:import-sources",
  accounts: "mochi:accounts",
  notifications: "mochi:notifications",
  librarySort: "mochi:library-sort",
  libraryFilter: "mochi:library-filter",
  accessibility: "mochi:accessibility",
  collections: "mochi:collections",
} as const;

export const igdbCacheKey = (userId?: string) => `mochi:igdb-cache:${userId || "local"}`;
export const profileStorageKey = (userId: string, key: string) => `mochi:profile:${userId}:${key}`;

export function readJson<T>(key: string, fallback: T): T {
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
