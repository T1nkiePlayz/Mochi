import type { CfGame } from "../curseforge";
import { bestNameMatch } from "./gameMatch";
import { sectionLimiter } from "./limit";
import type { ModPage, ModSource } from "./types";

/** One game's block on Discover > All. `tab` is the id the page's tab list uses for that game. */
export type SectionPlan = { key: string; tab: string; name: string; iconUrl?: string; iconFallbackUrls?: string[]; site: "modrinth" | "curseforge" | "nexus"; cfId?: number; nexusDomain?: string; minecraft: boolean };

type PlanGame = { key: string; name: string; iconUrl?: string; iconFallbackUrls?: string[]; cfId?: number; nexusDomain?: string; primary: "curseforge" | "nexus" | null };

/** Minecraft first (Modrinth, else CurseForge), then each tab game on its primary site. */
export function planSections(opts: { modrinth: boolean; curseforge: boolean; minecraftIconUrl?: string; games: readonly PlanGame[] }): { sections: SectionPlan[] } {
  const sections: SectionPlan[] = [];
  if (opts.modrinth) sections.push({ key: "minecraft", tab: "minecraft", name: "Minecraft", iconUrl: opts.minecraftIconUrl, site: "modrinth", minecraft: true });
  else if (opts.curseforge) sections.push({ key: "minecraft", tab: "minecraft", name: "Minecraft", iconUrl: opts.minecraftIconUrl, site: "curseforge", cfId: 432, minecraft: true });
  for (const game of opts.games) {
    if (game.primary === "curseforge" && game.cfId !== undefined) sections.push({ key: game.key, tab: game.key, name: game.name, iconUrl: game.iconUrl, iconFallbackUrls: game.iconFallbackUrls, site: "curseforge", cfId: game.cfId, minecraft: false });
    else if (game.primary === "nexus" && game.nexusDomain) sections.push({ key: game.key, tab: game.key, name: game.name, iconUrl: game.iconUrl, iconFallbackUrls: game.iconFallbackUrls, site: "nexus", nexusDomain: game.nexusDomain, minecraft: false });
  }
  return { sections };
}

/** Well-known CurseForge games, matched to the live list by name so a wrong id can never slip in. */
export const POPULAR_GAME_NAMES = ["The Sims 4", "World of Warcraft", "ARK: Survival Evolved", "Hogwarts Legacy", "Starfield", "Kerbal Space Program", "Skyrim", "Fallout 4", "Terraria", "Stardew Valley", "Palworld", "Cyberpunk 2077"];

/** Up to `count` games the user has not added: the well-known ones first, then the list's own order. Minecraft is never offered. */
export function pickOtherGames(all: readonly CfGame[] | null, addedIds: ReadonlySet<number>, count = 6, curated: readonly string[] = POPULAR_GAME_NAMES): CfGame[] {
  if (!all) return [];
  const usable = all.filter((game) => game.id !== 432 && !addedIds.has(game.id));
  const out: CfGame[] = [];
  const take = (game: CfGame | null) => { if (game && !out.some((entry) => entry.id === game.id)) out.push(game); };
  for (const name of curated) { if (out.length >= count) break; take(bestNameMatch(name, usable)); }
  for (const game of usable) { if (out.length >= count) break; take(game); }
  return out.slice(0, count);
}

const pages = new Map<string, Promise<ModPage>>();

/**
 * The same source, limited to its first `size` results (its default, most popular sort), queued behind the shared
 * limiter, and remembered in memory for the session so switching tabs does not refetch. A failed fetch is forgotten so Retry works.
 */
export function createPreviewSource(source: ModSource, cacheKey: string, size = 10, limiter = sectionLimiter): ModSource {
  return {
    ...source, mixed: false,
    categories: async () => [],
    search(options) {
      const key = `${cacheKey}|${options.query}`;
      const hit = pages.get(key);
      if (hit) return hit;
      const promise = limiter.run(() => source.search({ ...options, offset: 0, limit: size, sort: source.defaultSort })).then((page) => ({ ...page, items: page.items.slice(0, size), hasMore: false }));
      pages.set(key, promise);
      promise.catch(() => { if (pages.get(key) === promise) pages.delete(key); });
      return promise;
    },
  };
}
