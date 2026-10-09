import type { ModLoader, Piko, Tofu } from "../models";
import { sanitizeKey } from "./metadata";
import { launcherArt } from "./launcherArt";
import type { ImportedGame } from "./sources";

const platformLabels: Record<string, string> = {
  steam: "Steam", heroic: "Heroic", lutris: "Lutris", bottles: "Bottles", itch: "itch.io", apps: "Applications", flatpak: "Flatpak",
  epic: "Epic Games", whisky: "Whisky", battlenet: "Battle.net", gog: "GOG", prism: "Minecraft",
};
const LOADERS: ReadonlyArray<ModLoader> = ["vanilla", "fabric", "quilt", "forge", "neoforge"];

/** The default Tofu of an imported game; a Minecraft instance's Tofu is the instance folder itself. */
function defaultTofu(game: ImportedGame): Tofu {
  const tofu: Tofu = { id: "default", name: "Default", version: "Imported", runtime: game.source, mods: 0, status: "Ready" };
  const instance = game.minecraft;
  if (!instance?.gameDir) return tofu;
  const loader = LOADERS.find((value) => value === instance.loader) ?? "vanilla";
  return { ...tofu, version: instance.version || "Imported", loader, path: `${instance.gameDir}/mods`, contentRoot: instance.gameDir };
}
export const platformLabel = (source: string) => platformLabels[source] ?? "Other";

/** Turns a scanned item into a library entry: games get a default Tofu, launchers get bundled artwork. */
export function importedGameToPiko(game: ImportedGame, now: number): Piko {
  const launcher = game.kind === "launcher";
  return {
    id: `imported-${game.source}-${sanitizeKey(game.id)}-${now}`,
    name: game.name,
    kind: launcher ? "launcher" : "game",
    ...(launcher && game.launcherId ? { launcherId: game.launcherId } : {}),
    description: launcher
      ? `${game.name} game launcher. Mochi starts it so you can reach its library.`
      : game.minecraft
        ? "Minecraft instance. Its launcher (Prism, MultiMC, ...) starts it; Mochi manages its mods in this Tofu."
        : `Imported from ${platformLabel(game.source)}. The original launcher remains responsible for the installation and runtime.`,
    accent: "#a99ad6",
    artwork: launcher ? launcherArt(game.launcherId) : "",
    artworkCacheKey: sanitizeKey(`${game.source}-${game.id}`),
    executablePath: game.launchTarget,
    installPath: game.installPath ?? undefined,
    source: "custom",
    sourceId: game.source,
    platformCategory: launcher ? "Launchers" : platformLabel(game.source),
    categories: launcher ? ["Launcher"] : game.minecraft ? ["Minecraft"] : [],
    tofus: [defaultTofu(game)],
    ...(game.minecraft ? { modLinks: { minecraft: true, source: "auto" as const } } : {}),
  };
}
