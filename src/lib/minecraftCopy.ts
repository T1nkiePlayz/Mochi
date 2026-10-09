import { invoke } from "@tauri-apps/api/core";
import { subscribeNative } from "./nativeEvents";
import { parseInstanceTarget } from "./minecraftPiko";
import type { ImportedGame } from "./sources";

/** What Mochi does with the Minecraft instances it imports. */
export type MinecraftMode = "copy" | "in-place";

export type CopiedInstance = { launchTarget: string; gameDir: string; installPath: string; name: string };
export type CopyProgress = { target: string; copiedBytes: number; totalBytes: number; file: string };
export type CopyFailure = { game: ImportedGame; error: string };

export const copyMinecraftInstance = (launchTarget: string) => invoke<CopiedInstance>("copy_minecraft_instance", { launchTarget });

/** The imported game for a copy: the original's facts (version, loader, icon) with the copy's target, folders and name. */
export function copiedGame(game: ImportedGame, copy: CopiedInstance): ImportedGame {
  const folder = parseInstanceTarget(copy.launchTarget)?.id ?? copy.name;
  return { ...game, id: `${game.id.split(":")[0]}:${folder}`, name: copy.name, launchTarget: copy.launchTarget, installPath: copy.installPath, minecraft: { version: game.minecraft?.version, loader: game.minecraft?.loader ?? "vanilla", gameDir: copy.gameDir } };
}

type Hooks = { onStart?: (game: ImportedGame, index: number) => void; onProgress?: (game: ImportedGame, progress: CopyProgress) => void; copy?: (target: string) => Promise<CopiedInstance> };

/**
 * Copies instances one at a time. A failed copy never stops the others and never yields a game:
 * the caller gets the copies that worked and the instances that did not.
 */
export async function copyInstances(games: ImportedGame[], hooks: Hooks = {}): Promise<{ copied: ImportedGame[]; failed: CopyFailure[] }> {
  const copied: ImportedGame[] = [];
  const failed: CopyFailure[] = [];
  const copy = hooks.copy ?? copyMinecraftInstance;
  for (const [index, game] of games.entries()) {
    hooks.onStart?.(game, index);
    const off = hooks.onProgress ? subscribeNative<CopyProgress>("minecraft-copy-progress", (progress) => { if (progress.target === game.launchTarget) hooks.onProgress!(game, progress); }) : () => {};
    try { copied.push(copiedGame(game, await copy(game.launchTarget))); }
    catch (error) { failed.push({ game, error: error instanceof Error ? error.message : String(error) }); }
    finally { off(); }
  }
  return { copied, failed };
}
