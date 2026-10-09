// Pure helpers: how a Tofu's folders change when the user picks a game folder. No runtime imports.
import type { ModLoader, Tofu } from "../../models";
import { hasSeparateStore, samePath } from "./targets";

/** The part of a detected location these helpers need (`ModLocation` satisfies it). */
export type PickedLocation = { modsDir: string; contentRoot?: string; loader?: ModLoader; gameVersion?: string };

type FolderPatch = Pick<Tofu, "path" | "gameDir" | "contentRoot"> & Partial<Pick<Tofu, "loader" | "version">>;

/**
 * Points a Tofu at a game folder found by detection. By default the Tofu works on that folder directly (what the user sees in
 * their launcher is what Mochi manages). With `keepSeparate` the Tofu keeps its own copy in `storeDir` and the game folder is
 * only written to at launch. Loader and game version come from the instance when it says so.
 */
export function applyLocation(tofu: Tofu, location: PickedLocation, options: { keepSeparate?: boolean; storeDir?: string } = {}): FolderPatch {
  const separate = options.keepSeparate && options.storeDir;
  const patch: FolderPatch = { path: separate ? options.storeDir : location.modsDir, gameDir: location.modsDir, contentRoot: location.contentRoot };
  if (location.loader) patch.loader = location.loader;
  if (location.gameVersion && (!tofu.version || tofu.version === "Local" || location.gameVersion !== tofu.version)) patch.version = location.gameVersion;
  return patch;
}

/** A folder the user picked by hand: it is the game's mods folder and the Tofu works on it directly. */
export function applyManualFolder(tofu: Tofu, dir: string): FolderPatch {
  const separate = hasSeparateStore(tofu);
  return { path: separate ? (tofu.path as string) : dir, gameDir: dir, contentRoot: tofu.contentRoot };
}

/** Switches between "work on the game folder" and "keep this Tofu's mods apart" (needs a game folder and a store). */
export function setSeparateStore(tofu: Tofu, separate: boolean, storeDir: string): Pick<Tofu, "path"> | undefined {
  if (!tofu.gameDir) return undefined;
  return { path: separate ? storeDir : tofu.gameDir };
}

/** A one-line description of where mods go, for headers. */
export function describeFolders(tofu: Pick<Tofu, "path" | "gameDir">): string {
  if (!tofu.path && !tofu.gameDir) return "No folder chosen yet.";
  if (hasSeparateStore(tofu)) return `Kept apart in Mochi; copied to ${tofu.gameDir} when you launch.`;
  return tofu.gameDir && samePath(tofu.path, tofu.gameDir) ? `Working directly in ${tofu.gameDir}.` : tofu.path ?? "";
}

/** What ranking needs from a detected location (`ModLocation` satisfies it). */
export type RankedLocation = { exists: boolean; fileCount?: number; modifiedMs?: number };

/**
 * The location to apply without asking, or undefined when none exists. One existing folder wins; among several, the
 * ones that already hold mod files win; a tie goes to the most recently changed folder for Minecraft (the instance the
 * user played last) and to detection order otherwise (the per-game table comes before generic guesses).
 */
export function bestPick<T extends RankedLocation>(locations: readonly T[], minecraft = false): T | undefined {
  const present = locations.filter((location) => location.exists);
  if (present.length <= 1) return present[0];
  const withFiles = present.filter((location) => (location.fileCount ?? 0) > 0);
  const pool = withFiles.length ? withFiles : present;
  if (pool.length === 1 || !minecraft) return pool[0];
  return pool.reduce((best, location) => ((location.modifiedMs ?? 0) > (best.modifiedMs ?? 0) ? location : best), pool[0]);
}
