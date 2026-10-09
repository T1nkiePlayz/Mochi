import type { ModLoader, Piko, Tofu } from "../models";
import grassBlock from "../assets/minecraft-grass-block.svg";
import { sanitizeKey } from "./metadata";
import type { ImportedGame } from "./sources";

/** Minecraft is one Piko; every launcher instance (Prism, MultiMC, ...) is a Tofu of it. */
export const MINECRAFT_PIKO_ID = "minecraft";
const SCHEME = "mc-instance://";
const LOADERS: ReadonlyArray<ModLoader> = ["vanilla", "fabric", "quilt", "forge", "neoforge"];

export const isInstanceTarget = (target: string | undefined) => (target ?? "").startsWith(SCHEME);

/** `mc-instance://<launcher>/<percent-encoded id>` to its parts, or null. */
export function parseInstanceTarget(target: string | undefined): { launcher: string; id: string } | null {
  if (!isInstanceTarget(target)) return null;
  const [launcher, ...rest] = (target as string).slice(SCHEME.length).split("/");
  let id = rest.join("/");
  try { id = decodeURIComponent(id); } catch { /* keep the raw text */ }
  return launcher && id ? { launcher, id } : null;
}

/** Stable Tofu id of an instance (valid for the native side: letters, digits, `-`, `_`), the same on every re-import. */
export function instanceTofuId(target: string): string {
  const parts = parseInstanceTarget(target);
  return parts ? `mc-${sanitizeKey(parts.launcher)}-${sanitizeKey(parts.id)}`.slice(0, 120) : `mc-${sanitizeKey(target)}`.slice(0, 120);
}

/** The Tofu of one scanned Minecraft instance. Its mods folder is the instance's own `mods` folder. */
export function instanceTofu(game: ImportedGame): Tofu {
  const instance = game.minecraft;
  const loader = LOADERS.find((value) => value === instance?.loader) ?? "vanilla";
  const dir = instance?.gameDir;
  return {
    id: instanceTofuId(game.launchTarget), name: game.name, version: instance?.version || "Imported", runtime: "prism", mods: 0, status: "Ready",
    loader, launchTarget: game.launchTarget,
    ...(instance?.pack ? { pack: { source: instance.pack.source, projectId: instance.pack.projectId, ...(instance.pack.versionId ? { versionId: instance.pack.versionId } : {}), matchedBy: "managed" as const } } : {}),
    ...(game.installPath ? { installPath: game.installPath } : {}),
    ...(dir ? { path: `${dir}/mods`, gameDir: `${dir}/mods`, contentRoot: dir } : {}),
  };
}

export const newMinecraftPiko = (tofus: Tofu[] = []): Piko => ({
  id: MINECRAFT_PIKO_ID, name: "Minecraft", kind: "game", importKey: MINECRAFT_PIKO_ID, artworkCacheKey: MINECRAFT_PIKO_ID,
  description: "Minecraft. Each of your launcher instances is a Tofu: pick one to launch it and manage its mods.",
  accent: "#a99ad6", artwork: grassBlock, source: "custom", sourceId: "prism", platformCategory: "Minecraft", categories: ["Minecraft"],
  modLinks: { minecraft: true, source: "auto" }, executablePath: tofus[0]?.launchTarget, tofus,
});

/** Adds an instance Tofu, or refreshes the scanned facts (version, loader, targets, folders) of the one with the same id. The user's own edits stay. */
function upsertTofu(tofus: Tofu[], next: Tofu): Tofu[] {
  const index = tofus.findIndex((tofu) => tofu.id === next.id);
  if (index < 0) return [...tofus, next];
  const old = tofus[index];
  const merged: Tofu = { ...old, version: next.version, loader: next.loader, launchTarget: next.launchTarget, installPath: next.installPath ?? old.installPath,
    ...(next.pack ? { pack: next.pack } : {}), // what the launcher recorded beats a name match and refreshes the version
    path: old.path ?? next.path, gameDir: old.gameDir ?? next.gameDir, contentRoot: old.contentRoot ?? next.contentRoot };
  return tofus.map((tofu, at) => (at === index ? merged : tofu));
}

/**
 * Imports scanned Minecraft instances into the one Minecraft Piko (created when missing). Returns the new library and
 * the Minecraft Piko. Re-importing an instance updates its Tofu instead of duplicating it.
 */
export function mergeInstances(library: Piko[], games: ImportedGame[]): { library: Piko[]; piko: Piko } | null {
  const instances = games.filter((game) => isInstanceTarget(game.launchTarget));
  if (!instances.length) return null;
  const existing = library.find((piko) => piko.id === MINECRAFT_PIKO_ID);
  const base = existing ?? newMinecraftPiko();
  const tofus = instances.reduce((list, game) => upsertTofu(list, instanceTofu(game)), base.tofus);
  const piko: Piko = { ...base, tofus, executablePath: base.executablePath || tofus[0]?.launchTarget };
  return { library: existing ? library.map((item) => (item.id === MINECRAFT_PIKO_ID ? piko : item)) : [...library, piko], piko };
}

const unique = <T,>(items: T[]) => [...new Set(items)];

/**
 * One-time, idempotent load migration: every Piko that is a launcher instance (its launch target is `mc-instance://...`)
 * becomes a Tofu of the Minecraft Piko. Nothing is dropped: the instance's own Tofu (folders, loader, profiles, launch
 * settings) is kept, extra Tofus of that Piko stay as Tofus, favourite/tags/collections are unioned, and a cover the user had
 * is kept on the Tofu. Returns the same array when there is nothing to migrate.
 */
export function migrateMinecraftPikos(library: Piko[]): Piko[] {
  const old = library.filter((piko) => piko.id !== MINECRAFT_PIKO_ID && isInstanceTarget(piko.executablePath));
  if (!old.length) return library;
  const existing = library.find((piko) => piko.id === MINECRAFT_PIKO_ID);
  let merged = existing ?? newMinecraftPiko();
  let tofus = merged.tofus;
  for (const piko of old) {
    const target = piko.executablePath as string;
    const id = instanceTofuId(target);
    const [first, ...extra] = piko.tofus;
    const hasOwnCover = Boolean(piko.artworkSource === "custom" || piko.artworkSource === "icon" || piko.artworkUrl);
    const common = { launchTarget: target, ...(piko.installPath ? { installPath: piko.installPath } : {}), legacyPikoId: piko.id };
    const own: Tofu = { ...first, ...common, id, name: piko.name, legacyTofuId: first && first.id !== id ? first.id : undefined,
      ...(hasOwnCover ? { artwork: piko.artwork || undefined, artworkCacheKey: piko.artworkCacheKey } : {}) };
    tofus = upsertTofu(tofus, own);
    for (const tofu of extra) {
      const taken = tofus.some((other) => other.id === tofu.id);
      const extraId = tofu.id === "default" || taken ? `${id}-${sanitizeKey(tofu.id)}`.slice(0, 120) : tofu.id;
      tofus = upsertTofu(tofus, { ...tofu, ...common, id: extraId, name: `${piko.name} · ${tofu.name}`, legacyTofuId: extraId !== tofu.id ? tofu.id : undefined });
    }
    merged = {
      ...merged,
      favorite: merged.favorite || piko.favorite || undefined,
      tags: unique([...(merged.tags ?? []), ...(piko.tags ?? [])]),
      collectionIds: unique([...(merged.collectionIds ?? []), ...(piko.collectionIds ?? [])]),
    };
  }
  if (!merged.tags?.length) delete merged.tags;
  if (!merged.collectionIds?.length) delete merged.collectionIds;
  if (!merged.favorite) delete merged.favorite;
  merged = { ...merged, tofus, executablePath: merged.executablePath || tofus[0]?.launchTarget };
  const firstAt = library.findIndex((piko) => piko.id === MINECRAFT_PIKO_ID || old.includes(piko));
  const rest = library.filter((piko) => piko.id !== MINECRAFT_PIKO_ID && !old.includes(piko));
  const before = library.slice(0, firstAt).filter((piko) => rest.includes(piko));
  return [...before, merged, ...rest.slice(before.length)];
}

/** What to start for a Tofu: its own instance target, else the Piko's. */
export const launchTargetFor = (piko: Pick<Piko, "executablePath">, tofu?: Pick<Tofu, "launchTarget">): string | undefined => tofu?.launchTarget || piko.executablePath;

/** Playtime of the Pikos that were merged into Minecraft counts for Minecraft: one entry per Piko with the sum and the latest play. */
export function foldLegacyPlaytime<T extends { gameId: string; seconds: number; lastPlayed: number }>(entries: T[], library: Piko[]): T[] {
  const alias = new Map<string, string>();
  for (const piko of library) for (const tofu of piko.tofus) if (tofu.legacyPikoId && tofu.legacyPikoId !== piko.id) alias.set(tofu.legacyPikoId, piko.id);
  if (!alias.size) return entries;
  const out = new Map<string, T>();
  for (const entry of entries) {
    const key = alias.get(entry.gameId) ?? entry.gameId;
    const seen = out.get(key);
    out.set(key, seen ? { ...seen, seconds: seen.seconds + entry.seconds, lastPlayed: Math.max(seen.lastPlayed, entry.lastPlayed) } : { ...entry, gameId: key });
  }
  return [...out.values()];
}
