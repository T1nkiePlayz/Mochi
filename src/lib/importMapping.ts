import type { Piko, Tofu } from "../models";
import { sanitizeKey } from "./metadata";
import { launcherArt } from "./launcherArt";
import type { ImportedGame } from "./sources";
import { isInstanceTarget, mergeInstances } from "./minecraftPiko";

const platformLabels: Record<string, string> = {
  steam: "Steam", heroic: "Heroic", lutris: "Lutris", bottles: "Bottles", itch: "itch.io", apps: "Applications", flatpak: "Flatpak",
  epic: "Epic Games", whisky: "Whisky", battlenet: "Battle.net", gog: "GOG", prism: "Minecraft", legendary: "Epic Games", nile: "Amazon Games",
};

/** The default Tofu of an imported game. (A Minecraft instance is a Tofu of the one Minecraft Piko; see `minecraftPiko.ts`.) */
const defaultTofu = (game: ImportedGame): Tofu => ({ id: "default", name: "Default", version: "Imported", runtime: game.source, mods: 0, status: "Ready" });
export const platformLabel = (source: string) => platformLabels[source] ?? "Other";

/** Turns a scanned item into a library entry: games get a default Tofu, launchers get bundled artwork. */
export function importedGameToPiko(game: ImportedGame, now: number): Piko {
  if (isInstanceTarget(game.launchTarget)) return mergeInstances([], [game])!.piko;
  const launcher = game.kind === "launcher";
  return {
    id: `imported-${game.source}-${sanitizeKey(game.id)}-${now}`,
    name: game.name,
    kind: launcher ? "launcher" : "game",
    ...(launcher && game.launcherId ? { launcherId: game.launcherId } : {}),
    description: launcher
      ? `${game.name} game launcher. Mochi starts it so you can reach its library.`
      : `Imported from ${platformLabel(game.source)}. The original launcher remains responsible for the installation and runtime.`,
    accent: "#a99ad6",
    artwork: launcher ? launcherArt(game.launcherId) : "",
    artworkCacheKey: sanitizeKey(`${game.source}-${game.id}`),
    importKey: game.id,
    executablePath: game.launchTarget,
    installPath: game.installPath ?? undefined,
    source: "custom",
    sourceId: game.source,
    platformCategory: launcher ? "Launchers" : platformLabel(game.source),
    categories: launcher ? ["Launcher"] : [],
    tofus: [defaultTofu(game)],
    ...(!launcher && game.contentType ? { contentType: game.contentType } : {}),
  };
}
