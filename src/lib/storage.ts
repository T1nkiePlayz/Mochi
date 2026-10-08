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
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): void {
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable or full */ }
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
