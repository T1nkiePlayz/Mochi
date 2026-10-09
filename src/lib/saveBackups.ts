import { invoke } from "@tauri-apps/api/core";
import type { Piko } from "../models";
import { MINECRAFT_PIKO_ID } from "./minecraftPiko";
import { steamAppIdOf } from "./metadata/merge";

export type SaveHints = { steamAppId: number | null; folders: string[]; instances: Array<{ id: string; name: string; contentRoot: string }> };
export type SaveLocation = { key: string; kind: "minecraft" | "steam" | "custom"; label: string; group: string | null; path: string; /** The folder as the user added it (custom folders). */ source: string | null; problem: string | null; backups: number; lastBackup: number | null; backupBytes: number };
export type BackupInfo = { id: string; locationKey: string; createdAt: number; size: number; entries: number; files: number; kind: "manual" | "auto" | "safety"; fingerprint: string };
export type BackupResult = { backup: BackupInfo | null; skipped: "unchanged" | "empty" | null };
export type RestoreResult = { safety: BackupInfo | null; files: number };
export type AutoSummary = { created: number; unchanged: number; failed: number; firstError: string | null };
export type BackupSettings = { keep: number; maxTotalBytes: number };

export const listSaveLocations = (pikoId: string, hints: SaveHints) => invoke<SaveLocation[]>("list_save_locations", { pikoId, hints });
export const createSaveBackup = (pikoId: string, location: Pick<SaveLocation, "path" | "label">) => invoke<BackupResult>("create_save_backup", { location: { pikoId, path: location.path, label: location.label } });
export const listSaveBackups = (locationKey: string) => invoke<BackupInfo[]>("list_save_backups", { locationKey });
export const restoreSaveBackup = (id: string) => invoke<RestoreResult>("restore_save_backup", { id });
export const deleteSaveBackup = (id: string) => invoke<void>("delete_save_backup", { id });
export const autoBackupSaves = (pikoId: string, hints: SaveHints) => invoke<AutoSummary>("auto_backup_saves", { pikoId, hints });
export const getBackupSettings = () => invoke<BackupSettings>("get_save_backup_settings");
export const setBackupSettings = (settings: BackupSettings) => invoke<BackupSettings>("set_save_backup_settings", { settings });

/** What the native side needs to find a game's saves: its Steam id, the folders the user added and (Minecraft) every instance's game folder. */
export function saveHints(piko: Piko): SaveHints {
  const instances = piko.id === MINECRAFT_PIKO_ID ? piko.tofus.filter((tofu) => tofu.contentRoot).map((tofu) => ({ id: tofu.id, name: tofu.name, contentRoot: tofu.contentRoot as string })) : [];
  return { steamAppId: steamAppIdOf(piko), folders: piko.saveBackup?.folders ?? [], instances };
}

/** "Back up saves when the game closes": on by default for Minecraft worlds, off for everything else until the user opts in. */
export const autoBackupEnabled = (piko: Pick<Piko, "id" | "saveBackup">) => piko.saveBackup?.auto ?? piko.id === MINECRAFT_PIKO_ID;

/** Worth looking at on exit: the game can have saves (Minecraft instances, a Steam id or a user folder). */
export const hasSaveSources = (hints: SaveHints) => hints.instances.length > 0 || hints.steamAppId !== null || hints.folders.length > 0;

/** Adds a folder once (trailing slashes ignored); returns the same array when it is already there. */
export function addFolder(folders: string[] | undefined, folder: string): string[] {
  const clean = folder.trim().replace(/[\\/]+$/, "") || folder.trim();
  const list = folders ?? [];
  return !clean || list.includes(clean) ? list : [...list, clean];
}
export const removeFolder = (folders: string[] | undefined, folder: string) => (folders ?? []).filter((item) => item !== folder);

/** Games that were running before and are not any more. */
export const closedGames = (before: ReadonlySet<string>, now: ReadonlySet<string>) => [...before].filter((id) => !now.has(id));

/** Minecraft worlds grouped by instance (in order of appearance), then Steam, then user folders: `[heading, locations]` pairs. */
export function groupLocations(locations: SaveLocation[]): Array<[string, SaveLocation[]]> {
  const groups = new Map<string, SaveLocation[]>();
  const add = (heading: string, location: SaveLocation) => groups.set(heading, [...(groups.get(heading) ?? []), location]);
  for (const location of locations) add(location.kind === "minecraft" ? location.group ?? "Worlds" : location.kind === "steam" ? "Steam" : "Added folders", location);
  return [...groups];
}

export function describeResult(result: BackupResult): string {
  if (result.backup) return "Backup created.";
  return result.skipped === "unchanged" ? "Nothing changed since the last backup, so no new one was made." : "That folder is empty, so there is nothing to back up.";
}

export function describeAuto(summary: AutoSummary): { title: string; message: string } | null {
  if (summary.failed) return { title: "Save backup failed", message: summary.firstError ?? "A save folder could not be backed up." };
  if (!summary.created) return null;
  return { title: "Saves backed up", message: `${summary.created} save folder${summary.created === 1 ? "" : "s"} backed up.` };
}

export const BACKUP_KIND_LABEL: Record<BackupInfo["kind"], string> = { manual: "Manual", auto: "Automatic", safety: "Before restore" };
