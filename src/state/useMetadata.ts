import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { removeKey, igdbCacheKey } from "../lib/storage";
import { sanitizeKey } from "../lib/metadata";
import { ProviderCache, clearProviderCaches } from "../lib/metadata/cache";
import {
  applyMetadata, classifyError, mergeText, planProviders, providers, steamAppIdOf,
  type ArtChoice, type MetadataChoice, type ProviderId, type ProviderResult,
} from "../lib/metadata/index";
import type { Piko } from "../models";

type Params = {
  user: User | null;
  /** IGDB and SteamGridDB credentials saved on the account. */
  igdbConfigured: boolean;
  steamGridDbConfigured?: boolean;
  /** `Behavior.metadataProvider`. */
  provider?: MetadataChoice;
  setLibrary: Dispatch<SetStateAction<Piko[]>>;
  notify: (title: string, message: string) => void;
  startProgress: (title: string, message: string, total: number) => string;
  updateProgress: (id: string, progress: { value: number; total: number }, message: string) => void;
};

const CONCURRENCY = 3;
const MAX_RETRIES = 3;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Caches the artwork file on disk. Resolves true on success; offline or blocked hosts resolve false. */
async function cacheArtworkUrl(url: string, cacheKey: string, force = false): Promise<boolean> {
  try { await invoke("cache_game_artwork", { url, cacheKey, force }); return true; } catch { return false; }
}

export async function cacheArtwork(piko: Piko): Promise<void> {
  if (!piko.artworkUrl || !piko.artworkCacheKey) return;
  await cacheArtworkUrl(piko.artworkUrl, piko.artworkCacheKey);
}

type Options = { force?: boolean };
type Outcome = { piko: Piko; changed: boolean };

/**
 * Fetches metadata for games from IGDB, SteamGridDB and the Steam Store according to the
 * "Metadata source" setting, caches artwork on disk and writes results into the library.
 * Hand-edited (locked) fields and custom artwork are never overwritten.
 */
export function useMetadata({ user, igdbConfigured, steamGridDbConfigured = false, provider = "auto", setLibrary, notify, startProgress, updateProgress }: Params) {
  const [refreshBusy, setRefreshBusy] = useState(false);
  const busyRef = useRef(false);
  // Provider-wide cool-down after a 429, shared by all workers.
  const pausedUntil = useRef<Record<string, number>>({});
  const canUseAccount = Boolean(supabase && user);
  const ready = { igdb: igdbConfigured && canUseAccount, steamgriddb: steamGridDbConfigured && canUseAccount };

  const lookup = async (id: ProviderId, piko: Piko, caches: Map<ProviderId, ProviderCache>, options: Options): Promise<ProviderResult> => {
    const key = id === "steam" ? `app:${steamAppIdOf(piko)}` : id === "steamgriddb" && steamAppIdOf(piko) ? `app:${steamAppIdOf(piko)}` : piko.name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
    const cache = caches.get(id)!;
    const cached = options.force ? undefined : cache.get(key);
    if (cached) return cached;
    for (let attempt = 0; ; attempt += 1) {
      const wait = (pausedUntil.current[id] ?? 0) - Date.now();
      if (wait > 0) await sleep(wait);
      try {
        const result = await providers[id].lookup({ client: supabase }, piko);
        cache.set(key, result);
        return result;
      } catch (error) {
        const failure = classifyError(error);
        if (failure.kind !== "rate-limit" || attempt >= MAX_RETRIES) throw failure;
        const delay = 1500 * 2 ** attempt + Math.random() * 500;
        pausedUntil.current[id] = Date.now() + delay;
      }
    }
  };

  /** Resolves one game: text from the first provider that has some, artwork from the first that yields a cacheable image. */
  const resolveGame = async (piko: Piko, caches: Map<ProviderId, ProviderCache>, options: Options): Promise<Outcome> => {
    const plan = planProviders(provider, ready, steamAppIdOf(piko));
    const results = new Map<ProviderId, ProviderResult>();
    const failures: string[] = [];
    const ask = async (id: ProviderId) => {
      if (results.has(id)) return results.get(id)!;
      try { const result = await lookup(id, piko, caches, options); results.set(id, result); return result; }
      catch (error) { failures.push(`${providers[id].label}: ${classifyError(error).message}`); return {}; }
    };
    const textResults: ProviderResult[] = [];
    for (const id of plan.text) {
      const result = await ask(id);
      textResults.push(result);
      // Stop once something with a description arrived; later providers only fill gaps when asked for artwork anyway.
      if (result.text?.description) break;
    }
    let art: ArtChoice | undefined;
    const cacheKey = piko.artworkCacheKey || sanitizeKey(piko.id);
    const wantsArt = !(piko.lockedFields ?? []).includes("artwork") && piko.artworkSource !== "custom";
    if (wantsArt) {
      let firstCandidate: ArtChoice | undefined;
      artSearch: for (const id of plan.art) {
        for (const candidate of (await ask(id)).art ?? []) {
          firstCandidate ??= candidate;
          // Only discard the cached file when the artwork actually changes, so a failed download keeps the old one.
          if (await cacheArtworkUrl(candidate.url, cacheKey, candidate.url !== piko.artworkUrl)) { art = candidate; break artSearch; }
        }
      }
      // Nothing could be downloaded (offline?): keep the best remote URL so artwork appears once online.
      art ??= firstCandidate;
    }
    if (failures.length) console.warn(`Metadata lookup for ${piko.name}`, failures);
    const text = results.size ? mergeText(textResults.map((result) => result.text)) : undefined;
    const hasText = Boolean(text && Object.values(text).some((value) => (Array.isArray(value) ? value.length : value !== undefined)));
    if (!hasText && !art) return { piko, changed: false };
    return { piko: applyMetadata(piko, { text: hasText ? text : undefined, art }), changed: true };
  };

  const makeCaches = () => new Map<ProviderId, ProviderCache>((["igdb", "steamgriddb", "steam"] as const).map((id) => [id, new ProviderCache(id, user?.id)]));

  const run = async (games: Piko[], options: Options, onStep?: (done: number) => void): Promise<Map<string, Piko>> => {
    const caches = makeCaches();
    const updated = new Map<string, Piko>();
    const queue = [...games];
    let done = 0;
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (let piko = queue.shift(); piko; piko = queue.shift()) {
        try { const outcome = await resolveGame(piko, caches, options); if (outcome.changed) updated.set(piko.id, outcome.piko); }
        catch (error) { console.warn(`Metadata failed for ${piko.name}`, error); }
        done += 1;
        onStep?.(done);
      }
    }));
    caches.forEach((cache) => cache.flush());
    return updated;
  };

  const anyProvider = (game: Piko) => { const plan = planProviders(provider, ready, steamAppIdOf(game)); return plan.text.length + plan.art.length > 0; };

  const commit = (updated: Map<string, Piko>) =>
    setLibrary((current) => current.map((piko) => updated.get(piko.id) ? mergeInto(piko, updated.get(piko.id)!) : piko));

  /** Looks games up (3 at a time), caches artwork on disk and writes the results into the library. */
  const enrich = async (games: Piko[], options: Options = {}) => {
    const targets = games.filter(anyProvider);
    if (!targets.length) return;
    const jobId = startProgress("Updating your library", `Finding metadata for ${targets.length} games…`, targets.length);
    const updated = await run(targets, options, (done) => updateProgress(jobId, { value: done, total: targets.length }, `Looking up games: ${done} of ${targets.length}`));
    commit(updated);
    updateProgress(jobId, { value: targets.length, total: targets.length }, `Metadata update finished for ${targets.length} games.`);
  };

  const refreshAll = async (library: Piko[]) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setRefreshBusy(true);
    try {
      clearProviderCaches(user?.id);
      removeKey(igdbCacheKey(user?.id));
      const candidates = library;
      notify("Metadata refresh started", `Refreshing metadata for ${candidates.length} library games.`);
      await enrich(candidates, { force: true });
      notify("Metadata refresh finished", `Updated metadata for ${candidates.length} library games.`);
    } catch (error) {
      notify("Metadata refresh failed", error instanceof Error ? error.message : "Could not refresh game metadata.");
    } finally { busyRef.current = false; setRefreshBusy(false); }
  };

  /** Re-fetches one game, ignoring cached lookups. Never rejects. */
  const refreshGame = async (piko: Piko): Promise<void> => {
    if (!anyProvider(piko)) { notify("No metadata source ready", "Save an IGDB or SteamGridDB key in Settings, or pick a Steam game."); return; }
    try {
      const updated = await run([piko], { force: true });
      commit(updated);
      notify(updated.size ? "Metadata updated" : "No new metadata", updated.size ? `Refreshed ${piko.name}.` : `No provider had anything new for ${piko.name}.`);
    } catch (error) {
      notify("Metadata refresh failed", error instanceof Error ? error.message : "Could not refresh game metadata.");
    }
  };

  return { enrich, refreshAll, refreshGame, refreshBusy };
}

/** Applies only the metadata fields from a fresh result onto the live Piko, so edits made while it ran are kept. */
function mergeInto(live: Piko, fresh: Piko): Piko {
  const keep = new Set(live.lockedFields ?? []);
  return {
    ...live,
    name: keep.has("name") ? live.name : fresh.name,
    description: keep.has("description") ? live.description : fresh.description,
    categories: keep.has("categories") ? live.categories : fresh.categories,
    ...(keep.has("artwork") || live.artworkSource === "custom" ? {} : {
      artwork: fresh.artwork, artworkUrl: fresh.artworkUrl, artworkCacheKey: fresh.artworkCacheKey, artworkSource: fresh.artworkSource,
    }),
    igdbId: fresh.igdbId, screenshots: fresh.screenshots, trailerId: fresh.trailerId, firstReleaseDate: fresh.firstReleaseDate,
  };
}

export type MetadataState = ReturnType<typeof useMetadata>;
