import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import { notifyArtworkChanged } from "../lib/artwork";
import type { User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { removeKey, igdbCacheKey } from "../lib/storage";
import { sanitizeKey } from "../lib/metadata";
import { ProviderCache, clearProviderCaches } from "../lib/metadata/cache";
import {
  applyMetadata, classifyError, mergeText, planProviders, providers, steamAppIdOf, steamImportTargets, withSteam,
  type ArtChoice, type MetadataChoice, type ProviderId, type ProviderResult,
} from "../lib/metadata/index";
import type { Piko } from "../models";
import { applyLauncherLogos } from "../lib/iconCover";
import { hasArtwork } from "../lib/fallbackArt";
import { createPacer } from "../lib/throttle";
import { GAME_LAUNCHER_METADATA } from "../lib/robloxCover";

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
/** Steam Store lookups start at least this far apart, across all workers, to respect its rate limit. */
const steamPace = createPacer(350);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Caches the artwork file on disk. Resolves true on success; offline or blocked hosts resolve false. */
export async function cacheArtworkUrl(url: string, cacheKey: string, force = false): Promise<boolean> {
  try { await invoke("cache_game_artwork", { url, cacheKey, force }); notifyArtworkChanged(cacheKey); return true; } catch { return false; }
}

export async function cacheArtwork(piko: Piko): Promise<void> {
  if (!piko.artworkUrl || !piko.artworkCacheKey) return;
  await cacheArtworkUrl(piko.artworkUrl, piko.artworkCacheKey);
}

type Options = { force?: boolean; /** Also ask the keyless Steam Store for Steam games, even when the "Metadata source" setting excludes it. */ includeSteam?: boolean; /** Ask only this provider (per-provider refresh); default is the "Metadata source" setting. */ only?: ProviderId };
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
    const mapped = piko.kind === "launcher" ? GAME_LAUNCHER_METADATA[piko.launcherId as keyof typeof GAME_LAUNCHER_METADATA] : undefined;
    const queryPiko = mapped ? { ...piko, name: mapped.gameName } : piko;
    const key = id === "steam" ? `app:${steamAppIdOf(queryPiko)}` : id === "steamgriddb" && steamAppIdOf(queryPiko) ? `app:${steamAppIdOf(queryPiko)}` : queryPiko.name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
    const cache = caches.get(id)!;
    const cached = options.force ? undefined : cache.get(key);
    if (cached) return cached;
    for (let attempt = 0; ; attempt += 1) {
      const wait = (pausedUntil.current[id] ?? 0) - Date.now();
      if (wait > 0) await sleep(wait);
      try {
        if (id === "steam") await steamPace();
        const result = await providers[id].lookup({ client: supabase }, queryPiko);
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
    const plan = planFor(piko, options);
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
    // IGDB's Roblox title describes the launcher target, but must not rename the Sober/Mocktail shortcut.
    if (piko.kind === "launcher" && piko.launcherId && GAME_LAUNCHER_METADATA[piko.launcherId as keyof typeof GAME_LAUNCHER_METADATA]?.gameName === "Roblox" && text) text.name = undefined;
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

  const planFor = (game: Piko, options: Options) => {
    const special = game.kind === "launcher" && game.launcherId ? GAME_LAUNCHER_METADATA[game.launcherId as keyof typeof GAME_LAUNCHER_METADATA] : undefined;
    if (special) {
      if (options.only && options.only !== special.provider) return { text: [], art: [] };
      return planProviders(special.provider, ready, null);
    }
    const plan = planProviders(options.only ?? provider, ready, steamAppIdOf(game));
    return options.includeSteam ? withSteam(plan, steamAppIdOf(game)) : plan;
  };
  const specialLauncher = (piko: Piko) => piko.kind === "launcher" && Boolean(piko.launcherId && GAME_LAUNCHER_METADATA[piko.launcherId as keyof typeof GAME_LAUNCHER_METADATA]);
  const anyProvider = (game: Piko, only?: ProviderId, includeSteam?: boolean) => { const plan = planFor(game, { only, includeSteam }); return plan.text.length + plan.art.length > 0; };

  const commit = (updated: Map<string, Piko>) =>
    setLibrary((current) => current.map((piko) => updated.get(piko.id) ? mergeInto(piko, updated.get(piko.id)!) : piko));

  /** Looks games up (3 at a time), caches artwork on disk and writes the results into the library. */
  const enrich = async (games: Piko[], options: Options = {}) => {
    const targets = games.filter((game) => anyProvider(game, options.only, options.includeSteam));
    if (!targets.length) return;
    const jobId = startProgress("Updating your library", `Finding metadata for ${targets.length} games…`, targets.length);
    const updated = await run(targets, options, (done) => updateProgress(jobId, { value: done, total: targets.length }, `Looking up games: ${done} of ${targets.length}`));
    commit(updated);
    updateProgress(jobId, { value: targets.length, total: targets.length }, `Metadata update finished for ${targets.length} games.`);
  };

  /** Freshly imported games: the usual enrichment plus Steam Store data (no keys or account needed) for new Steam games. */
  const enrichImported = async (games: Piko[]) => {
    const steam = new Set(steamImportTargets(games).map((piko) => piko.id));
    const [withSteamData, rest] = [games.filter((piko) => steam.has(piko.id)), games.filter((piko) => !steam.has(piko.id))];
    await Promise.all([enrich(withSteamData, { includeSteam: true }), enrich(rest)]);
  };

  /** Clears the lookup caches and re-fetches every game from the requested scope. */
  const refreshScope = async (library: Piko[], only?: ProviderId) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setRefreshBusy(true);
    const label = only ? providers[only].label : "metadata";
    try {
      clearProviderCaches(user?.id, only);
      if (!only || only === "igdb") removeKey(igdbCacheKey(user?.id));
      // Launchers (Steam, Lutris...) are shortcuts, not games: looking them up would overwrite their name and art.
      const candidates = library.filter((piko) => (piko.kind !== "launcher" || specialLauncher(piko)) && anyProvider(piko, only));
      notify(`${only ? label : "Metadata"} refresh started`, `Refreshing ${label === "metadata" ? "metadata" : `${label} data`} for ${candidates.length} library games.`);
      await enrich(candidates, { force: true, only });
      if ((!only || only === "igdb") && ready.igdb) await refreshLauncherLogos(library);
      notify(`${only ? label : "Metadata"} refresh finished`, `Updated ${label === "metadata" ? "metadata" : `${label} data`} for ${candidates.length} library games.`);
    } catch (error) {
      notify("Metadata refresh failed", error instanceof Error ? error.message : "Could not refresh game metadata.");
    } finally { busyRef.current = false; setRefreshBusy(false); }
  };

  /** Refresh just this provider. Keeping the source required prevents a provider row from falling back to Auto/all. */
  const refreshProvider = (library: Piko[], source: ProviderId) => refreshScope(library, source);
  /** Refresh using the user's configured metadata source. */
  const refreshAll = (library: Piko[]) => refreshScope(library);

  /** How many library games each provider could refresh right now (0 means its button stays disabled). */
  const refreshableCount = (library: Piko[], only: ProviderId) => library.filter((piko) => (piko.kind !== "launcher" || specialLauncher(piko)) && anyProvider(piko, only)).length;

  /** Games that show generated art and may still get a real cover (not launchers, not hand-picked art). */
  const missingCovers = (library: Piko[]) => library.filter((piko) => (piko.kind !== "launcher" || specialLauncher(piko)) && !hasArtwork(piko) && piko.artworkSource !== "custom" && !(piko.lockedFields ?? []).includes("artwork") && anyProvider(piko, undefined, true));

  /** One pass over the games without a cover: looks each up (Steam games need no keys) and keeps what it finds. */
  const findMissingCovers = async (library: Piko[]): Promise<number> => {
    if (busyRef.current) return 0;
    const targets = missingCovers(library);
    if (!targets.length) { notify("No covers to find", "Every game that can have a cover already has one, or no metadata source is ready."); return 0; }
    busyRef.current = true;
    setRefreshBusy(true);
    const jobId = startProgress("Finding covers", `Looking for covers for ${targets.length} games…`, targets.length);
    try {
      const updated = await run(targets, { includeSteam: true }, (done) => updateProgress(jobId, { value: done, total: targets.length }, `Looking for covers: ${done} of ${targets.length}`));
      commit(updated);
      const found = [...updated.values()].filter((piko) => hasArtwork(piko)).length;
      updateProgress(jobId, { value: targets.length, total: targets.length }, `Found ${found} cover${found === 1 ? "" : "s"}.`);
      notify("Cover search finished", found ? `Found covers for ${found} of ${targets.length} games.` : `No cover was found for ${targets.length === 1 ? "that game" : `those ${targets.length} games`}. You can pick one by hand in the game's artwork tab.`);
      return found;
    } catch (error) {
      notify("Cover search failed", error instanceof Error ? error.message : "Could not look up covers.");
      return 0;
    } finally { busyRef.current = false; setRefreshBusy(false); }
  };

  /** Launchers are not games: instead of a game lookup (which would bring a trailer and a wrong name) they get their company's IGDB logo. */
  const refreshLauncherLogos = async (pikos: Piko[]): Promise<number> => {
    if (!supabase || !ready.igdb) return 0;
    const done = await applyLauncherLogos(supabase, pikos);
    if (done.size) setLibrary((current) => current.map((piko) => (done.has(piko.id) && piko.artworkSource !== "custom" ? { ...piko, artworkSource: "igdb", artworkUrl: undefined, trailerId: undefined } : piko)));
    return done.size;
  };

  /** Re-fetches one game, ignoring cached lookups. Never rejects. */
  const refreshGame = async (piko: Piko): Promise<void> => {
    if (specialLauncher(piko)) {
      if (!anyProvider(piko)) { notify("Metadata source not ready", "Save an IGDB key for Roblox or a SteamGridDB key for Roblox Studio to refresh this launcher."); return; }
      try {
        const updated = await run([piko], { force: true });
        commit(updated);
        notify(updated.size ? "Game data updated" : "No new game data", updated.size ? `Refreshed ${piko.name}.` : `No new data was found for ${piko.name}.`);
      } catch (error) { notify("Metadata refresh failed", error instanceof Error ? error.message : "Could not refresh game metadata."); }
      return;
    }
    if (piko.kind === "launcher") {
      if (!ready.igdb) { notify("IGDB not ready", "Save your IGDB keys in Settings to fetch launcher logos."); return; }
      const count = await refreshLauncherLogos([piko]);
      notify(count ? "Logo updated" : "No logo found", count ? `${piko.name} now shows its company logo from IGDB.` : `IGDB has no company logo for ${piko.name}.`);
      return;
    }
    if (!anyProvider(piko)) { notify("No metadata source ready", "Save an IGDB or SteamGridDB key in Settings, or pick a Steam game."); return; }
    try {
      const updated = await run([piko], { force: true });
      commit(updated);
      notify(updated.size ? "Metadata updated" : "No new metadata", updated.size ? `Refreshed ${piko.name}.` : `No provider had anything new for ${piko.name}.`);
    } catch (error) {
      notify("Metadata refresh failed", error instanceof Error ? error.message : "Could not refresh game metadata.");
    }
  };

  return { enrich, enrichImported, refreshAll, refreshProvider, refreshGame, findMissingCovers, missingCovers, refreshBusy, refreshableCount, ready };
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
    ...(live.contentTypeLocked || !fresh.contentType ? {} : { contentType: fresh.contentType }),
    igdbId: fresh.igdbId, screenshots: fresh.screenshots, trailerId: fresh.trailerId, trailerVideos: fresh.trailerVideos, firstReleaseDate: fresh.firstReleaseDate,
  };
}

export type MetadataState = ReturnType<typeof useMetadata>;
