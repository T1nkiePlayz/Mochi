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
};

/** A file in a Tofu's mod folder with its record (if Mochi installed it). */
export type InstanceMod = { filename: string; path: string; enabled: boolean; size: number; record?: ModRecord };

export const listInstanceMods = (tofuId: string, path: string, subdir?: Subdir) =>
  invoke<InstanceMod[]>("list_instance_mods", { tofuId, path, subdir: subdir ?? null });

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
};

/** Where a game loads mods from: Minecraft instances of every common launcher, or a per-game table. Never writes anything. */
export const detectModLocations = (game: { name: string; installPath?: string; executablePath?: string; minecraft: boolean }) =>
  invoke<ModLocation[]>("detect_mod_locations", { gameName: game.name, installPath: game.installPath ?? null, executablePath: game.executablePath ?? null, minecraft: game.minecraft });

export type SyncReport = { added: number; removed: number; unchanged: number; conflicts: string[]; errors: string[] };
export const syncInstanceMods = (request: { tofuId: string; storeDir: string; gameDir: string; contentRoot?: string; adoptUnmanaged?: boolean }) =>
  invoke<SyncReport>("sync_instance_mods", { request });
