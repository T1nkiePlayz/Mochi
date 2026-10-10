import type { Piko } from "../models";
import type { ImportedGame } from "./sources";
import { isInstanceTarget } from "./minecraftPiko";

const normalizeTarget = (target: string | null | undefined): string => {
  const value = (target ?? "").trim();
  if (!value) return "";
  // Paths may be reported with different separators by launchers on Windows.
  return value.replace(/\\/g, "/").replace(/^([A-Z]):/, (_, drive: string) => `${drive.toLowerCase()}:`);
};

function hasImportIdentity(piko: Piko, game: ImportedGame): boolean {
  if (piko.sourceId === game.source && piko.importKey === game.id) return true;
  return (piko.launchSources ?? []).some((source) => source.sourceId === game.source && source.importKey === game.id);
}

/** True when the scanned entry is already represented by a library Piko or one of its launch sources/Tofus. */
export function isImportedGameInLibrary(game: ImportedGame, library: Piko[]): boolean {
  const target = normalizeTarget(game.launchTarget);
  return library.some((piko) => {
    if (piko.id === "__empty") return false;
    if (hasImportIdentity(piko, game)) return true;

    // Minecraft instances are represented as Tofus under the shared Minecraft Piko.
    if (isInstanceTarget(game.launchTarget) && piko.tofus.some((tofu) => tofu.launchTarget === game.launchTarget)) return true;

    // A shared executable can back both a launcher shortcut and a game entry; never conflate those kinds by path alone.
    const sameKind = (piko.kind === "launcher") === (game.kind === "launcher");
    if (!sameKind) return false;
    if (target && normalizeTarget(piko.executablePath) === target) return true;
    return (piko.launchSources ?? []).some((source) => target && normalizeTarget(source.executablePath) === target);
  });
}

/** Remove entries that already exist in the user's library, retaining scan order. */
export function excludeLibraryImports(games: ImportedGame[], library: Piko[]): ImportedGame[] {
  if (!library.length) return games;
  return games.filter((game) => !isImportedGameInLibrary(game, library));
}
