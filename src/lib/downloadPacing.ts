import { invoke } from "@tauri-apps/api/core";
import { readJson, writeJson } from "./storage";

export type DownloadWindow = { enabled: boolean; start: string; end: string };
export type DownloadPrefs = { paused: boolean; limitKiB: number; window: DownloadWindow };

export const downloadPrefsKey = "mochi:download-prefs";
export const speedLimits: Array<{ kib: number; label: string }> = [
  { kib: 0, label: "No limit" }, { kib: 512, label: "0.5 MB/s" }, { kib: 1024, label: "1 MB/s" }, { kib: 2048, label: "2 MB/s" }, { kib: 5120, label: "5 MB/s" }, { kib: 10240, label: "10 MB/s" },
];

export const defaultDownloadPrefs: DownloadPrefs = { paused: false, limitKiB: 0, window: { enabled: false, start: "01:00", end: "07:00" } };

const time = (value: unknown, fallback: string) => (typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : fallback);

export function sanitizeDownloadPrefs(value: unknown): DownloadPrefs {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const window = (raw.window && typeof raw.window === "object" ? raw.window : {}) as Record<string, unknown>;
  const limit = typeof raw.limitKiB === "number" && Number.isFinite(raw.limitKiB) ? Math.max(0, Math.min(1_000_000, Math.round(raw.limitKiB))) : 0;
  return {
    paused: raw.paused === true, limitKiB: limit,
    window: { enabled: window.enabled === true, start: time(window.start, defaultDownloadPrefs.window.start), end: time(window.end, defaultDownloadPrefs.window.end) },
  };
}

const minutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));

/** Whether `now` falls inside the allowed window; a window that ends before it starts runs over midnight. */
export function inDownloadWindow(window: DownloadWindow, now: Date): boolean {
  if (!window.enabled) return true;
  const at = now.getHours() * 60 + now.getMinutes();
  const start = minutes(window.start), end = minutes(window.end);
  if (start === end) return true;
  return start < end ? at >= start && at < end : at >= start || at < end;
}

/** Downloads are held back when paused by hand or outside the allowed window. */
export const downloadsHeld = (prefs: DownloadPrefs, now: Date) => prefs.paused || !inDownloadWindow(prefs.window, now);

export const readDownloadPrefs = (): DownloadPrefs => sanitizeDownloadPrefs(readJson<unknown>(downloadPrefsKey, null));
export const writeDownloadPrefs = (prefs: DownloadPrefs) => { writeJson(downloadPrefsKey, prefs); };

/** Sends the effective pause state and speed cap to the native downloader. */
export async function applyDownloadPrefs(prefs: DownloadPrefs, now = new Date()) {
  await invoke("set_download_limit", { kibPerSecond: prefs.limitKiB });
  await invoke("set_downloads_paused", { paused: downloadsHeld(prefs, now) });
}
