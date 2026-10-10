import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readJson, removeKey, writeJson, writeString } from "./storage";
import { sanitizeLibrary } from "./library";

export const BACKUP_KIND = "mochi-library-backup";
export const BACKUP_VERSION = 1;
export const MAX_VALUE_CHARS = 40 * 1024 * 1024;

/** Library data kept in the webview. Accounts, tokens and device settings are never part of a backup. */
const FIXED_KEYS = ["mochi:pikos", "mochi:collections", "mochi:wishlist", "mochi:saved-filters", "mochi:time-to-beat", "mochi:launcher-overrides", "mochi:duplicate-dismissed"];
const PROFILE_KEY = /^mochi:profile:[^:]{1,80}:(pikos|collections|wishlist)$/;

export const isBackupKey = (key: string) => FIXED_KEYS.includes(key) || PROFILE_KEY.test(key);

export type BackupFile = { kind: typeof BACKUP_KIND; version: number; createdAt: number; appVersion: string; data: Record<string, unknown> };

/** Reads every backup key from storage (values are parsed JSON, so the file stays readable). */
export function collectBackupData(storage: Pick<Storage, "length" | "key" | "getItem"> = window.localStorage): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!key || !isBackupKey(key)) continue;
    try { const raw = storage.getItem(key); if (raw) data[key] = JSON.parse(raw); } catch { /* a damaged entry is left out */ }
  }
  return data;
}

export const buildBackup = (data: Record<string, unknown>, appVersion: string, now = Date.now()): BackupFile => ({ kind: BACKUP_KIND, version: BACKUP_VERSION, createdAt: now, appVersion, data });

export type BackupSummary = { games: number; collections: number; wishlist: number; savedFilters: number; createdAt: number; appVersion: string };

/** Checks a backup read from a file: right kind, only known keys, library entries sane. Throws a readable error otherwise. */
export function parseBackup(text: string): { file: BackupFile; summary: BackupSummary } {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error("This file is not a Mochi backup."); }
  const file = raw as Partial<BackupFile> | null;
  if (!file || file.kind !== BACKUP_KIND || typeof file.data !== "object" || file.data === null || Array.isArray(file.data)) throw new Error("This file is not a Mochi backup.");
  if (typeof file.version !== "number" || file.version > BACKUP_VERSION) throw new Error("This backup was made by a newer Mochi. Update Mochi first.");
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(file.data)) {
    if (!isBackupKey(key) || value === undefined || value === null) continue;
    if (JSON.stringify(value).length > MAX_VALUE_CHARS) throw new Error("This backup is too large.");
    data[key] = value;
  }
  const library = data["mochi:pikos"];
  if (library !== undefined && !Array.isArray(library)) throw new Error("The library in this backup is damaged.");
  const length = (key: string) => (Array.isArray(data[key]) ? (data[key] as unknown[]).length : 0);
  const games = Array.isArray(library) ? sanitizeLibrary(library, {}).length : 0;
  if (!Object.keys(data).length) throw new Error("This backup holds no library data.");
  return {
    file: { kind: BACKUP_KIND, version: file.version, createdAt: typeof file.createdAt === "number" ? file.createdAt : 0, appVersion: typeof file.appVersion === "string" ? file.appVersion.slice(0, 40) : "", data },
    summary: { games, collections: length("mochi:collections"), wishlist: length("mochi:wishlist"), savedFilters: length("mochi:saved-filters"), createdAt: typeof file.createdAt === "number" ? file.createdAt : 0, appVersion: typeof file.appVersion === "string" ? file.appVersion : "" },
  };
}

/** Replaces the stored library data with the backup's, then the caller reloads the app. Keys the backup does not have are cleared so nothing old lingers. */
export function writeBackupData(file: BackupFile, storage: Pick<Storage, "length" | "key"> = window.localStorage) {
  const existing: string[] = [];
  for (let index = 0; index < storage.length; index++) { const key = storage.key(index); if (key && isBackupKey(key)) existing.push(key); }
  for (const key of existing) if (!(key in file.data)) removeKey(key);
  for (const [key, value] of Object.entries(file.data)) writeJson(key, value);
  // The app mirrors its library into storage while it runs; the reload that follows must start from the restored copy.
  writeString("mochi:restored-at", String(Date.now()));
}

export const backupFileName = (now = new Date()) => `mochi-backup-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

export async function exportBackupToFile(appVersion: string): Promise<string | null> {
  const picked = await save({ title: "Save library backup", defaultPath: `${backupFileName()}.mochibackup`, filters: [{ name: "Mochi backup", extensions: ["mochibackup"] }] });
  if (!picked) return null;
  return invoke<string>("write_library_backup", { path: picked, content: JSON.stringify(buildBackup(collectBackupData(), appVersion)) });
}

export async function pickBackupFile(): Promise<{ file: BackupFile; summary: BackupSummary } | null> {
  const picked = await open({ title: "Restore library backup", multiple: false, directory: false, filters: [{ name: "Mochi backup", extensions: ["mochibackup"] }] });
  if (typeof picked !== "string") return null;
  return parseBackup(await invoke<string>("read_library_backup", { path: picked }));
}

export type BackupSchedule = { enabled: boolean; folder: string; everyDays: 1 | 7 | 30; keep: number; lastAt: number };
export const scheduleKey = "mochi:backup-schedule";
export const defaultSchedule: BackupSchedule = { enabled: false, folder: "", everyDays: 7, keep: 5, lastAt: 0 };

export function sanitizeSchedule(value: unknown): BackupSchedule {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const days = raw.everyDays === 1 || raw.everyDays === 30 ? raw.everyDays : 7;
  const keep = typeof raw.keep === "number" && Number.isFinite(raw.keep) ? Math.max(1, Math.min(50, Math.round(raw.keep))) : 5;
  return { enabled: raw.enabled === true && typeof raw.folder === "string" && raw.folder !== "", folder: typeof raw.folder === "string" ? raw.folder : "", everyDays: days, keep, lastAt: typeof raw.lastAt === "number" && Number.isFinite(raw.lastAt) ? raw.lastAt : 0 };
}
export const readSchedule = () => sanitizeSchedule(readJson<unknown>(scheduleKey, null));
export const writeSchedule = (schedule: BackupSchedule) => { writeJson(scheduleKey, schedule); };
export const backupDue = (schedule: BackupSchedule, now = Date.now()) => schedule.enabled && now - schedule.lastAt >= schedule.everyDays * 86_400_000;

/** Writes the scheduled copy into the chosen folder and prunes older ones. */
export async function runScheduledBackup(schedule: BackupSchedule, appVersion: string, now = new Date()): Promise<void> {
  await invoke("write_scheduled_library_backup", { folder: schedule.folder, name: `${backupFileName(now)}.mochibackup`, content: JSON.stringify(buildBackup(collectBackupData(), appVersion, now.getTime())), keep: schedule.keep });
}
