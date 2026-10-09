import { invoke } from "@tauri-apps/api/core";
import type { Piko } from "../models";

/** Settings > Storage: types, the pure breakdown maths and the native calls (see src-tauri/src/storage.rs). */
export type StorageCategory = "games" | "mods" | "rollback" | "downloads" | "artwork" | "themes" | "sound" | "logs" | "snapshots" | "backups" | "data";
export type ClearKind = "artworkCache" | "downloadTemp" | "rollbackCopies" | "snapshots" | "logs";

export type StorageLocation = { key: string; name: string; category: StorageCategory; path: string | null; clear: ClearKind | null; inside: StorageCategory | null };
export type StorageProgress = { job: number; key: string; bytes: number; files: number; truncated: boolean; done: boolean; error: string | null };
export type StorageScanRequest = { games: Array<{ id: string; name: string; path: string }>; tofus: Array<{ id: string; name: string; folders: string[] }> };

export const categoryLabels: Record<StorageCategory, string> = {
  games: "Game installs", mods: "Mods & content", rollback: "Rollback copies", downloads: "Unfinished downloads", artwork: "Artwork cache", themes: "Themes & fonts",
  sound: "Sound packs", logs: "Game logs", snapshots: "Snapshots", backups: "Save backups", data: "Mochi data",
};
/** Legend and stacked bar order. */
export const categoryOrder = Object.keys(categoryLabels) as StorageCategory[];

export type Measurement = { bytes: number; files: number; truncated: boolean; done: boolean; error: string | null };
export type StorageRow = StorageLocation & { measurement: Measurement | null };
export type SortKey = "name" | "category" | "bytes";
export type SortState = { key: SortKey; dir: "asc" | "desc" };

export const scanStorage = (request: StorageScanRequest) => invoke<{ job: number; locations: StorageLocation[] }>("scan_storage", { request });
export const cancelStorageScan = (job: number) => invoke<void>("cancel_storage_scan", { job });
export const clearStorageLocation = (kind: ClearKind, olderThanDays?: number) => invoke<{ files: number; bytes: number }>("clear_storage_location", { kind, olderThanDays: olderThanDays ?? null });
export const openFolder = (path: string) => invoke<void>("open_path_in_file_manager", { path });

/** What to measure: every game with an install folder and every Tofu with a folder of its own. */
export function scanRequestFor(library: Piko[]): StorageScanRequest {
  const games: StorageScanRequest["games"] = [];
  const tofus: StorageScanRequest["tofus"] = [];
  for (const piko of library) {
    if (piko.installPath?.trim()) games.push({ id: piko.id, name: piko.name, path: piko.installPath.trim() });
    for (const tofu of piko.tofus) {
      const folders = [...new Set([tofu.path, tofu.contentRoot].map((folder) => folder?.trim() ?? "").filter(Boolean))];
      if (folders.length) tofus.push({ id: `${piko.id}:${tofu.id}`, name: `${tofu.name} (${piko.name})`, folders });
    }
  }
  return { games, tofus };
}

export function applyProgress(current: Record<string, Measurement>, event: StorageProgress): Record<string, Measurement> {
  return { ...current, [event.key]: { bytes: event.bytes, files: event.files, truncated: event.truncated, done: event.done, error: event.error } };
}

export const buildRows = (locations: StorageLocation[], measurements: Record<string, Measurement>): StorageRow[] => locations.map((location) => ({ ...location, measurement: measurements[location.key] ?? null }));

export type Totals = { total: number; categories: Array<{ category: StorageCategory; bytes: number }>; measured: number; pending: number; failed: number };

/**
 * Totals per category. Rows that sit inside another category (rollback copies and unfinished downloads live in the Tofu
 * folders) are taken out of that category, so the stacked bar adds up to what is really on disk.
 */
export function summarise(rows: StorageRow[]): Totals {
  const bytes = new Map<StorageCategory, number>();
  let measured = 0, pending = 0, failed = 0;
  for (const row of rows) {
    const size = row.measurement;
    if (!size) { pending += 1; continue; }
    if (size.error) { failed += 1; continue; }
    if (!size.done) pending += 1; else measured += 1;
    bytes.set(row.category, (bytes.get(row.category) ?? 0) + size.bytes);
    if (row.inside) bytes.set(row.inside, Math.max(0, (bytes.get(row.inside) ?? 0) - size.bytes));
  }
  const categories = categoryOrder.map((category) => ({ category, bytes: bytes.get(category) ?? 0 })).filter((item) => item.bytes > 0);
  return { total: categories.reduce((sum, item) => sum + item.bytes, 0), categories, measured, pending, failed };
}

/** Share of the total in percent (one decimal below 10%), "" while unknown. */
export function formatShare(bytes: number | null, total: number): string {
  if (bytes === null || total <= 0) return "";
  const share = (bytes / total) * 100;
  if (share > 0 && share < 0.1) return "<0.1%";
  return `${share < 10 ? share.toFixed(1) : Math.round(share)}%`;
}

/** Unmeasured rows always sort last, whatever the direction, so a long scan never pushes results below skeletons. */
export function sortRows(rows: StorageRow[], sort: SortState): StorageRow[] {
  const sign = sort.dir === "asc" ? 1 : -1;
  const size = (row: StorageRow) => (row.measurement && !row.measurement.error ? row.measurement.bytes : null);
  return [...rows].sort((a, b) => {
    if (sort.key === "bytes") {
      const [x, y] = [size(a), size(b)];
      if (x === null || y === null) return x === y ? a.name.localeCompare(b.name) : x === null ? 1 : -1;
      return (x - y) * sign || a.name.localeCompare(b.name);
    }
    const [x, y] = sort.key === "name" ? [a.name, b.name] : [categoryLabels[a.category], categoryLabels[b.category]];
    return x.localeCompare(y, undefined, { sensitivity: "base" }) * sign || a.name.localeCompare(b.name);
  });
}

/** The first `limit` rows (the long tail of a big library is behind a "show more" button, not in the DOM). */
export const visibleRows = <T,>(rows: T[], limit: number): { shown: T[]; hidden: number } => ({ shown: rows.slice(0, limit), hidden: Math.max(0, rows.length - limit) });

export const clearActions: Array<{ kind: ClearKind; label: string; detail: string; needsAge: boolean; category: StorageCategory; danger: boolean }> = [
  { kind: "artworkCache", label: "Clear artwork cache", detail: "Covers downloaded from the web. Mochi fetches them again when needed; covers you picked yourself are kept.", needsAge: false, category: "artwork", danger: false },
  { kind: "downloadTemp", label: "Remove unfinished downloads", detail: "Half-downloaded files and extraction leftovers in your mod folders. Downloads running right now are skipped.", needsAge: false, category: "downloads", danger: false },
  { kind: "rollbackCopies", label: "Remove old rollback copies", detail: "Earlier versions kept so an update can be undone. Mods that were rolled forward lose their \"Roll back\" option.", needsAge: true, category: "rollback", danger: true },
  { kind: "snapshots", label: "Remove old snapshots", detail: "Saved snapshots older than the chosen age.", needsAge: true, category: "snapshots", danger: true },
  { kind: "logs", label: "Remove old game logs", detail: "Launch logs of past sessions.", needsAge: true, category: "logs", danger: false },
];
export const ageOptions = [7, 30, 90, 365] as const;
export const ageLabel = (days: number) => (days === 365 ? "1 year" : `${days} days`);
