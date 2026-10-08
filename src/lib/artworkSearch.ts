import { supabase } from "./supabase";
import { lookupIgdbGames } from "./igdb";
import { resolveIgdbImage } from "./metadata";
import { sgdbAssets, sgdbSearch } from "./metadata/steamgriddb";

export type ArtworkCandidate = {
  id: string;
  provider: "steamgriddb" | "igdb" | "steam";
  url: string;
  thumbUrl: string;
  width: number;
  height: number;
  style?: string;
  author?: string;
};

type Options = { provider?: "steamgriddb" | "igdb" | "all"; signal?: AbortSignal };

async function searchSteamGridDb(query: string): Promise<ArtworkCandidate[]> {
  if (!supabase) return [];
  const [game] = await sgdbSearch(supabase, query);
  if (!game) return [];
  const grids = await sgdbAssets(supabase, { gameId: game.id }, { kinds: ["grids"], dimensions: ["600x900", "342x482", "660x930"], limit: 24 });
  const loose = grids.length ? [] : await sgdbAssets(supabase, { gameId: game.id }, { kinds: ["grids"], limit: 24 });
  return [...grids, ...loose].map((item) => ({
    id: `steamgriddb:${item.id}`, provider: "steamgriddb" as const, url: item.url, thumbUrl: item.thumb || item.url,
    width: item.width, height: item.height, style: item.style, author: item.author,
  }));
}

async function searchIgdb(query: string): Promise<ArtworkCandidate[]> {
  if (!supabase) return [];
  const out: ArtworkCandidate[] = [];
  for (const game of (await lookupIgdbGames(supabase, query)).slice(0, 4)) {
    const cover = resolveIgdbImage(game.cover?.url, "t_cover_big_2x");
    if (cover && game.id) out.push({ id: `igdb:${game.id}:cover`, provider: "igdb", url: cover, thumbUrl: resolveIgdbImage(game.cover?.url, "t_cover_big") ?? cover, width: 528, height: 748, style: game.name });
    (game.artworks ?? []).slice(0, 2).forEach((art, index) => {
      const url = resolveIgdbImage(art.url, "t_1080p");
      if (url) out.push({ id: `igdb:${game.id}:art${index}`, provider: "igdb", url, thumbUrl: resolveIgdbImage(art.url, "t_screenshot_med") ?? url, width: 1920, height: 1080, style: game.name });
    });
  }
  return out;
}

/** Artwork the user can pick from. Providers that are unavailable (no key, offline) are skipped; this never throws. */
export async function searchArtwork(query: string, opts: Options = {}): Promise<ArtworkCandidate[]> {
  const term = query.trim();
  if (!term) return [];
  const provider = opts.provider ?? "all";
  const jobs: Array<Promise<ArtworkCandidate[]>> = [];
  if (provider === "all" || provider === "steamgriddb") jobs.push(searchSteamGridDb(term));
  if (provider === "all" || provider === "igdb") jobs.push(searchIgdb(term));
  const settled = await Promise.allSettled(jobs);
  if (opts.signal?.aborted) return [];
  return settled.flatMap((result) => {
    if (result.status === "fulfilled") return result.value;
    console.warn("Artwork search failed", result.reason);
    return [];
  });
}
