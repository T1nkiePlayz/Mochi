import { invoke } from "@tauri-apps/api/core";
import { deleteGameArtwork } from "./artwork";
import { clearProviderCaches } from "./metadata/cache";
import { removeKey, igdbCacheKey } from "./storage";
import type { Piko } from "../models";

/** Everything Mochi keeps for a data source, so each can be cleared on its own. */
export type DataSourceId = "igdb" | "steamgriddb" | "steam" | "steam-achievements" | "custom-artwork";

export const dataSources: Array<{ id: DataSourceId; label: string; detail: string }> = [
  { id: "igdb", label: "IGDB", detail: "Saved IGDB lookups and the covers downloaded from IGDB." },
  { id: "steamgriddb", label: "SteamGridDB", detail: "Saved SteamGridDB lookups and the artwork downloaded from it." },
  { id: "steam", label: "Steam Store", detail: "Saved Steam Store descriptions and the covers downloaded from Steam." },
  { id: "steam-achievements", label: "Steam achievements", detail: "Saved achievement lists and progress. They are fetched again the next time you open a Steam game." },
  { id: "custom-artwork", label: "Your own artwork", detail: "Covers you chose yourself. This cannot be undone and they are not fetched again." },
];

/** Library games whose cover file came from this source (only artwork sources have files; the others return nothing). */
export function gamesWithArtworkFrom(library: Piko[], id: DataSourceId): Piko[] {
  const source = id === "custom-artwork" ? "custom" : id === "igdb" || id === "steamgriddb" || id === "steam" ? id : null;
  return source ? library.filter((piko) => piko.artworkSource === source && piko.artworkCacheKey) : [];
}

/** The same game with the cover forgotten; the cache key stays so a later refresh can fill it again. */
export function withoutArtwork(piko: Piko): Piko {
  const { artworkUrl: _url, artworkSource: _source, ...rest } = piko;
  void _url; void _source;
  return { ...rest, artwork: "", lockedFields: piko.lockedFields?.filter((field) => field !== "artwork") };
}

/** Deletes one source's cached data. Resolves to the number of cover files removed. Never touches another source. */
export async function clearDataSource(id: DataSourceId, library: Piko[], setLibrary: (update: (current: Piko[]) => Piko[]) => void, userId?: string): Promise<number> {
  if (id === "igdb" || id === "steamgriddb" || id === "steam") {
    clearProviderCaches(userId, id);
    if (id === "igdb") removeKey(igdbCacheKey(userId));
    if (id === "steam") await invoke("clear_steam_store_cache").catch(() => undefined);
  }
  if (id === "steam-achievements") { await invoke("clear_steam_achievements_cache"); return 0; }
  const games = gamesWithArtworkFrom(library, id);
  await Promise.all(games.map((game) => deleteGameArtwork(game.artworkCacheKey!).catch(() => undefined)));
  if (games.length) {
    const ids = new Set(games.map((game) => game.id));
    setLibrary((current) => current.map((piko) => (ids.has(piko.id) ? withoutArtwork(piko) : piko)));
  }
  return games.length;
}

/** Clears every cached source except the user's own artwork, which is not a cache. */
export async function clearAllDataSources(library: Piko[], setLibrary: (update: (current: Piko[]) => Piko[]) => void, userId?: string): Promise<number> {
  let total = 0;
  for (const source of dataSources) if (source.id !== "custom-artwork") total += await clearDataSource(source.id, library, setLibrary, userId);
  return total;
}
