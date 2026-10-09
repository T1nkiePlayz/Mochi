import { invoke } from "@tauri-apps/api/core";
import type { ModLoader } from "../../models";
import type { Subdir } from "./targets";

/** What Mochi remembers about one installed file of a Tofu (`mods.json` in the Tofu's data folder). */
export type ModRecord = {
  /** File name without the `.disabled` marker. */
  file: string;
  subdir: "" | Subdir;
  enabled: boolean;
  source: "modrinth" | "curseforge" | "nexus" | "manual";
  projectId: string;
  fileId: string;
  version: string;
  title: string;
  iconUrl?: string;
  sha1?: string;
  fileDate?: string;
  installedAt: number;
  /** The version an update replaced; "Roll back" restores it. */
  rollback?: { file: string; version: string; fileId: string; sha1?: string; fileDate?: string };
  /** A .zip that was unpacked into the folder (`file` is the archive name, no longer on disk). */
  extracted?: boolean;
};

/** A file in a Tofu's mod folder with its record (if Mochi installed it). */
export type InstanceMod = {
  filename: string; path: string; enabled: boolean; size: number; record?: ModRecord;
  /** Last modification, ms since the epoch. */
  modifiedMs?: number;
  /** Only another Tofu sharing the folder owns this file (it is off while this Tofu is active). */
  foreign?: boolean;
};

/** Files of a Tofu folder with their records. `siblings`: ids of the game's other Tofus, to mark files only they own. */
export const listInstanceMods = (tofuId: string, path: string, subdir?: Subdir, siblings?: string[]) =>
  invoke<InstanceMod[]>("list_instance_mods", { tofuId, path, subdir: subdir ?? null, siblings: siblings ?? null });

/** Everything recorded for a Tofu (also unpacked archives); used for "Downloaded" states. */
export const listInstanceRecords = (tofuId: string) => invoke<ModRecord[]>("list_instance_records", { tofuId });

export type HashedFile = { path: string; filename: string; size: number; sha1: string; md5: string; fingerprint: number };
/** SHA-1, MD5 and CurseForge fingerprint of mod files (unreadable or huge files are left out). */
export const hashModFiles = (paths: string[]) => invoke<HashedFile[]>("hash_mod_files", { paths });

export type ModrinthMatch = { projectId: string; versionId: string; versionNumber: string; title: string; iconUrl?: string; datePublished: string };
/** Modrinth versions by SHA-1, keyed by hash. */
export const modrinthIdentify = (hashes: string[]) => invoke<Record<string, ModrinthMatch>>("modrinth_identify", { hashes });

export type RecordEntry = { file: string; subdir?: string; sha1?: string; enabled: boolean; record: { source: ModRecord["source"]; projectId: string; fileId: string; version?: string; title?: string; iconUrl?: string; fileDate?: string } };
/** Saves many records at once; an identified record replaces a manual one, never the other way round. */
export const recordInstanceMods = (tofuId: string, entries: RecordEntry[]) => invoke<number>("record_instance_mods", { tofuId, entries });

export type BulkResult = { changed: number; failed: string[] };
/** Disables or enables many files at once by renaming `x.jar` <-> `x.jar.disabled`; always reversible. */
export const setInstanceModsEnabled = (tofuId: string, paths: string[], enabled: boolean) =>
  invoke<BulkResult>("set_instance_mods_enabled", { tofuId, paths, enabled });

/** Folder inside Mochi's data for a Tofu that keeps its mods apart from the game folder. */
export const getInstanceStoreDir = (tofuId: string) => invoke<string>("get_instance_store_dir", { tofuId });

/** Copies the mod files of a game folder into a Tofu's own folder (originals stay). Returns how many were copied. */
export const importModsFromFolder = (from: string, to: string) => invoke<number>("import_mods_from_folder", { from, to });

export const rollbackModUpdate = (tofuId: string, dir: string, file: string, subdir?: Subdir) =>
  invoke<string>("rollback_mod_update", { tofuId, dir, file, subdir: subdir ?? null });

export type ModLocation = {
  id: string;
  label: string;
  launcher: string;
  instance?: string;
  /** The folder the game loads mods from. */
  modsDir: string;
  /** Minecraft: the game folder that also holds resourcepacks, shaderpacks and saves. */
  contentRoot?: string;
  exists: boolean;
  loader?: ModLoader;
  gameVersion?: string;
  /** Mod files already in `modsDir` (capped), used to rank candidates. */
  fileCount?: number;
  /** Last change of `modsDir` (ms since epoch). */
  modifiedMs?: number;
};

/** Where a game loads mods from: Minecraft instances of every common launcher, or a per-game table. Never writes anything. */
export const detectModLocations = (game: { name: string; installPath?: string; executablePath?: string; minecraft: boolean }) =>
  invoke<ModLocation[]>("detect_mod_locations", { gameName: game.name, installPath: game.installPath ?? null, executablePath: game.executablePath ?? null, minecraft: game.minecraft });

export type SyncReport = { added: number; removed: number; unchanged: number; /** Shared-folder Tofus: switched on / off in place. */ enabled?: number; disabled?: number; conflicts: string[]; errors: string[] };
export const syncInstanceMods = (request: { tofuId: string; storeDir: string; gameDir: string; contentRoot?: string; adoptUnmanaged?: boolean }) =>
  invoke<SyncReport>("sync_instance_mods", { request });

/** Gives a new Tofu the same mod list as `from` (used by "Duplicate"). */
export const copyInstanceRecords = (from: string, to: string) => invoke<number>("copy_instance_records", { from, to });

/** A game's Tofus as the native side needs them for switching and the `.mochi/tofus.json` file. */
export type TofuRef = { id: string; name: string; path?: string; version?: string; loader?: string };
export type TofuApplyRequest = { tofuId: string; storeDir: string; gameDir: string; contentRoot?: string; adoptUnmanaged?: boolean; tofus?: TofuRef[] };

/** Enables the active Tofu's mods (and disables the other Tofus') now; also what runs at launch. */
export const applyTofuMods = (request: TofuApplyRequest) => invoke<SyncReport>("apply_tofu_mods", { request });
/** Saves `<game folder>/.mochi/tofus.json`. */
export const writeTofuManifest = (request: TofuApplyRequest) => invoke<void>("write_tofu_manifest", { request });

export type ManifestMod = { file: string; subdir: string; enabled: boolean; source: string; projectId: string; fileId: string; version: string; title: string; sha1?: string; fileDate?: string };
export type ManifestTofu = { id: string; name: string; version?: string; loader?: string; separate: boolean; mods: ManifestMod[] };
export type TofuManifest = { schema: number; generator: string; updatedAt: number; activeTofuId: string; tofus: ManifestTofu[] };
export const readTofuManifest = (gameDir: string) => invoke<TofuManifest | null>("read_tofu_manifest", { gameDir });
export const restoreInstanceRecords = (tofuId: string, mods: ManifestMod[]) => invoke<number>("restore_instance_records", { tofuId, mods });
