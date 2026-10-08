import { useState, type Dispatch, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { lookupIgdbGames, type IgdbGame } from "../lib/igdb";
import { applyIgdbMetadata } from "../lib/metadata";
import { bestIgdbMatch } from "../lib/search";
import { igdbCacheKey, readJson, removeKey, writeJson } from "../lib/storage";
import type { Piko } from "../models";

type Params = {
  user: User | null;
  igdbConfigured: boolean;
  setLibrary: Dispatch<SetStateAction<Piko[]>>;
  notify: (title: string, message: string) => void;
  startProgress: (title: string, message: string, total: number) => string;
  updateProgress: (id: string, progress: { value: number; total: number }, message: string) => void;
};

const cacheKeyFor = (name: string) => name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export async function cacheArtwork(piko: Piko): Promise<void> {
  if (!piko.artworkUrl || !piko.artworkCacheKey) return;
  try { await invoke("cache_game_artwork", { url: piko.artworkUrl, cacheKey: piko.artworkCacheKey }); } catch { /* Keep the remote artwork URL as an offline fallback. */ }
}

/** Looks games up on IGDB (3 at a time), caches their artwork on disk and writes the results into the library. */
export function useMetadata({ user, igdbConfigured, setLibrary, notify, startProgress, updateProgress }: Params) {
  const [refreshBusy, setRefreshBusy] = useState(false);

  const enrich = async (games: Piko[]) => {
    if (!supabase || !user || !igdbConfigured || !games.length) return;
    const client = supabase;
    const userId = user.id;
    const jobId = startProgress("IGDB is updating your library", `Finding metadata for ${games.length} imported games…`, games.length);
    const cache = readJson<Record<string, IgdbGame | null>>(igdbCacheKey(userId), {});
    const resolved = new Map<string, IgdbGame | null>();
    let completed = 0;
    const runPool = async (items: Piko[], work: (piko: Piko) => Promise<void>) => {
      const queue = [...items];
      await Promise.all(Array.from({ length: Math.min(3, queue.length) }, async () => {
        for (let piko = queue.shift(); piko; piko = queue.shift()) await work(piko);
      }));
    };
    await runPool(games, async (piko) => {
      const key = cacheKeyFor(piko.name);
      try {
        if (Object.prototype.hasOwnProperty.call(cache, key)) resolved.set(piko.id, cache[key]);
        else resolved.set(piko.id, bestIgdbMatch(piko.name, await lookupIgdbGames(client, piko.name)));
      } catch (error) {
        console.warn(`IGDB lookup failed for ${piko.name}`, error);
        resolved.set(piko.id, null);
      }
      completed += 1;
      updateProgress(jobId, { value: completed, total: games.length }, `Looking up games: ${completed} of ${games.length}`);
    });
    completed = 0;
    await runPool(games, async (piko) => {
      const metadata = resolved.get(piko.id) ?? null;
      if (metadata) {
        const enriched = applyIgdbMetadata(piko, metadata);
        if (enriched.artworkUrl) await cacheArtwork(enriched);
        cache[cacheKeyFor(piko.name)] = metadata;
      }
      completed += 1;
      updateProgress(jobId, { value: completed, total: games.length }, `Saving cover images and game details: ${completed} of ${games.length}`);
    });
    writeJson(igdbCacheKey(userId), cache);
    setLibrary((current) => current.map((piko) => (resolved.has(piko.id) ? applyIgdbMetadata(piko, resolved.get(piko.id) ?? null) : piko)));
    updateProgress(jobId, { value: games.length, total: games.length }, `IGDB update finished for ${games.length} games.`);
  };

  const refreshAll = async (library: Piko[]) => {
    if (!supabase || !user || !igdbConfigured || refreshBusy) return;
    setRefreshBusy(true);
    try {
      removeKey(igdbCacheKey(user.id));
      await invoke("clear_game_artwork_cache");
      setLibrary((current) => current.map((piko) => piko.artworkSource === "custom" ? piko : ({
        ...piko, igdbId: undefined, artworkUrl: undefined, artworkCacheKey: undefined, screenshots: undefined, trailerId: undefined, firstReleaseDate: undefined,
        categories: piko.sourceId ? [] : piko.categories,
        description: piko.sourceId ? `Imported from ${piko.platformCategory || piko.sourceId}. The original launcher remains responsible for the installation and runtime.` : piko.description,
        artwork: piko.sourceId ? "" : piko.artwork,
      })));
      const candidates = library.filter((piko) => Boolean(piko.sourceId || piko.platformCategory));
      notify("IGDB refresh started", `Refreshing metadata for ${candidates.length} library games.`);
      await enrich(candidates);
      notify("IGDB refresh finished", `Updated metadata for ${candidates.length} library games.`);
    } catch (error) {
      notify("IGDB refresh failed", error instanceof Error ? error.message : "Could not refresh game metadata.");
    } finally { setRefreshBusy(false); }
  };

  return { enrich, refreshAll, refreshBusy };
}

export type MetadataState = ReturnType<typeof useMetadata>;
