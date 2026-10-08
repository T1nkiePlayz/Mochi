import type { SupabaseClient } from "@supabase/supabase-js";
import { invokeProviderFunction } from "../functions";
import { editDistance, normalizeText } from "../search";
import { pickGrid, steamAppIdOf } from "./merge";
import { ProviderError, type MetadataProvider } from "./types";

export type SgdbKind = "grids" | "heroes" | "logos" | "icons";
export type SgdbGame = { id: number; name: string; verified?: boolean; release_date?: number };
export type SgdbAsset = { id: number; kind: SgdbKind; url: string; thumb: string; width: number; height: number; style?: string; author?: string };

export async function sgdbSearch(client: SupabaseClient, query: string): Promise<SgdbGame[]> {
  if (!query.trim()) return [];
  return (await invokeProviderFunction<{ games?: SgdbGame[] }>(client, { action: "sgdb-search", query: query.trim().slice(0, 200) })).games ?? [];
}

export async function sgdbAssets(
  client: SupabaseClient,
  target: { gameId: number } | { steamAppId: number },
  options: { kinds?: SgdbKind[]; dimensions?: string[]; limit?: number } = {},
): Promise<SgdbAsset[]> {
  const data = await invokeProviderFunction<{ items?: SgdbAsset[] }>(client, { action: "sgdb-assets", ...target, kinds: options.kinds ?? ["grids"], dimensions: options.dimensions, limit: options.limit ?? 12 });
  return data.items ?? [];
}

/** The search hit whose title is the same game, or the top hit when SteamGridDB marks it verified and the names are close. */
export function bestSgdbGame(name: string, games: SgdbGame[]): SgdbGame | null {
  const expected = normalizeText(name);
  const scored = games.map((game, index) => {
    const candidate = normalizeText(game.name);
    return { game, index, score: 1 - editDistance(expected, candidate) / Math.max(expected.length, candidate.length, 1) };
  }).sort((a, b) => b.score - a.score || a.index - b.index);
  return scored[0] && scored[0].score >= 0.8 ? scored[0].game : null;
}

export const steamGridDbProvider: MetadataProvider = {
  id: "steamgriddb", label: "SteamGridDB", provides: { text: false, art: true },
  async lookup({ client }, piko) {
    if (!client) throw new ProviderError("Sign in to use SteamGridDB.", "auth");
    const appId = steamAppIdOf(piko);
    let target: { gameId: number } | { steamAppId: number };
    if (appId) target = { steamAppId: appId };
    else {
      const game = bestSgdbGame(piko.name, await sgdbSearch(client, piko.name));
      if (!game) return {};
      target = { gameId: game.id };
    }
    // 600x900 is what the library renders; fall back to any grid when none exists at that size.
    let grids = await sgdbAssets(client, target, { dimensions: ["600x900"], limit: 8 });
    if (!grids.length) grids = await sgdbAssets(client, target, { limit: 12 });
    const grid = pickGrid(grids);
    return grid ? { art: [{ source: "steamgriddb", url: grid.url }] } : {};
  },
};
