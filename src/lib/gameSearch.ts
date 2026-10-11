import { invoke } from "@tauri-apps/api/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { lookupIgdbGames, type IgdbGame } from "./igdb";
import { resolveIgdbImage } from "./metadata";
import { bestSgdbGame, sgdbAssets, sgdbSearch, type SgdbAsset, type SgdbGame } from "./metadata/steamgriddb";
import { getSteamStoreDetails, type SteamStoreDetails } from "./metadata/steam";
import { getPriceInfo, storeLabel, type PriceInfo } from "./deals";
import { bestIgdbMatch, normalizeText } from "./search";
import { readJson, storageKeys, writeJson } from "./storage";

/** Experimental "game-search": look up any game, with prices and a local price history. Docs: docs/game-search.md. */
export const OPEN_GAME_SEARCH_EVENT = "mochi:open-game-search";
export const openGameSearch = () => window.dispatchEvent(new Event(OPEN_GAME_SEARCH_EVENT));

export const SEARCH_DEBOUNCE_MS = 300;
export const MIN_QUERY_LENGTH = 2;
export const MAX_SCREENSHOTS = 12;
export const MAX_ART = 8;

export type Readiness = { igdb: boolean; steamgriddb: boolean };
/** Search is offered only when at least one of the two key-backed providers is set up. */
export const gameSearchAvailable = (ready: Readiness) => ready.igdb || ready.steamgriddb;

export type SearchHit = { key: string; name: string; coverUrl?: string; year?: number; igdb?: IgdbGame; sgdb?: SgdbGame };
export type Rating = { score: number; count: number | null };
export type SteamPrice = { currency: string; initial: number; final: number; discountPercent: number; formatted: string };
export type GamePrices = { steam: SteamPrice | null; shark: PriceInfo | null };
export type GameLink = { label: string; url: string };
export type SimilarGame = { name: string; coverUrl?: string };
export type GameArt = { covers: SgdbAsset[]; heroes: SgdbAsset[]; logos: SgdbAsset[] };

export type GameDetails = {
  key: string; name: string; description: string; genres: string[]; releaseDate: number | null; developers: string[]; publishers: string[];
  platforms: string[]; rating: Rating | null; screenshots: string[]; art: GameArt; links: GameLink[]; similar: SimilarGame[];
  coverUrl?: string; heroUrl?: string; steamAppId: number | null; prices: GamePrices; sources: string[];
};

// --- Debounce + cancel stale -----------------------------------------------------------------------------------

export type DebouncedSearch = { call: (query: string) => void; cancel: () => void };

/**
 * Runs `run(query, signal)` once the user stops typing for `delay` ms. A newer call (or `cancel`) aborts the previous
 * request and drops its result, so a slow old answer can never replace a newer one. Queries shorter than `minLength` only clear.
 */
export function createDebouncedSearch<T>(
  run: (query: string, signal: AbortSignal) => Promise<T>,
  handlers: { onStart: () => void; onResult: (query: string, result: T) => void; onError: (query: string, error: unknown) => void; onClear: () => void },
  options: { delay?: number; minLength?: number } = {},
): DebouncedSearch {
  const delay = options.delay ?? SEARCH_DEBOUNCE_MS;
  const minLength = options.minLength ?? MIN_QUERY_LENGTH;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  const cancel = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; controller?.abort(); controller = undefined; };
  const call = (raw: string) => {
    cancel();
    const query = raw.trim();
    if (query.length < minLength) { handlers.onClear(); return; }
    handlers.onStart();
    timer = setTimeout(() => {
      timer = undefined;
      const mine = new AbortController();
      controller = mine;
      run(query, mine.signal).then(
        (result) => { if (!mine.signal.aborted) handlers.onResult(query, result); },
        (error) => { if (!mine.signal.aborted) handlers.onError(query, error); },
      );
    }, delay);
  };
  return { call, cancel };
}

// --- Price history (local observations) ------------------------------------------------------------------------

export type PriceObservation = { t: number; price: number; store: string; source: "steam" | "cheapshark"; currency: string };
export const HISTORY_POINT_CAP = 120;
export const HISTORY_GAME_CAP = 60;
/** The same source and store is recorded at most once per this long, so reopening a game does not pile up points. */
export const MIN_OBSERVATION_GAP_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const validObservation = (value: unknown): value is PriceObservation => {
  const o = value as Partial<PriceObservation> | null;
  return Boolean(o) && typeof o?.t === "number" && Number.isFinite(o.t) && typeof o.price === "number" && Number.isFinite(o.price) && o.price >= 0
    && typeof o.store === "string" && (o.source === "steam" || o.source === "cheapshark") && typeof o.currency === "string";
};

/** Adds new observations to a game's history: drops near-duplicates (same source and store within the gap), keeps time order, keeps the newest `cap`. Pure. */
export function mergeObservations(existing: PriceObservation[], incoming: PriceObservation[], cap = HISTORY_POINT_CAP, gapMs = MIN_OBSERVATION_GAP_MS): PriceObservation[] {
  const merged = existing.filter(validObservation).sort((a, b) => a.t - b.t);
  for (const next of incoming) {
    if (!validObservation(next)) continue;
    if (merged.some((o) => o.source === next.source && o.store === next.store && Math.abs(o.t - next.t) < gapMs)) continue;
    merged.push(next);
    merged.sort((a, b) => a.t - b.t);
  }
  return merged.slice(-cap);
}

export type PriceHistory = Record<string, PriceObservation[]>;

/** Keeps the `limit` most recently updated games. Pure. */
export function pruneHistory(history: PriceHistory, limit = HISTORY_GAME_CAP): PriceHistory {
  const last = (list: PriceObservation[]) => list[list.length - 1]?.t ?? 0;
  return Object.fromEntries(Object.entries(history).filter(([, list]) => list.length).sort((a, b) => last(b[1]) - last(a[1])).slice(0, limit));
}

export function readPriceHistory(): PriceHistory {
  const raw = readJson<unknown>(storageKeys.priceHistory, {});
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw as Record<string, unknown>).map(([key, list]) => [key, Array.isArray(list) ? list.filter(validObservation) : []]).filter(([, list]) => (list as unknown[]).length));
}

/** Stable per-game key: the Steam app id when known (same game found by title or by id), else the normalised name. */
export const historyKey = (game: { name: string; steamAppId?: number | null }) => (game.steamAppId ? `steam:${game.steamAppId}` : `name:${normalizeText(game.name).slice(0, 80)}`);

/** Stores observations for a game and returns its full history. */
export function recordObservations(key: string, incoming: PriceObservation[]): PriceObservation[] {
  const history = readPriceHistory();
  history[key] = mergeObservations(history[key] ?? [], incoming);
  writeJson(storageKeys.priceHistory, pruneHistory(history));
  return history[key];
}

/** What the current prices say as observations (USD only; Steam is requested for the US region). */
export function observationsFromPrices(prices: GamePrices, now: number): PriceObservation[] {
  const out: PriceObservation[] = [];
  if (prices.steam && prices.steam.currency === "USD") out.push({ t: now, price: prices.steam.final / 100, store: "Steam", source: "steam", currency: "USD" });
  const best = prices.shark?.deals.reduce<PriceInfo["deals"][number] | null>((low, deal) => (!low || deal.price < low.price ? deal : low), null);
  if (best) out.push({ t: now, price: best.price, store: storeLabel(best.storeId), source: "cheapshark", currency: "USD" });
  return out;
}

export type ChartPoint = { t: number; price: number };
/** The lowest USD price seen per day: the line the graph draws. */
export function dailyLowest(observations: PriceObservation[]): ChartPoint[] {
  const byDay = new Map<number, ChartPoint>();
  for (const o of observations) {
    if (o.currency !== "USD") continue;
    const day = Math.floor(o.t / DAY_MS);
    const current = byDay.get(day);
    if (!current || o.price < current.price) byDay.set(day, { t: o.t, price: o.price });
  }
  return [...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([, point]) => point);
}

export type Chart = { width: number; height: number; line: string; dots: Array<{ x: number; y: number; t: number; price: number }>; everY: number | null; min: number; max: number };

/** Plain SVG geometry for the history graph. `ever` is drawn as a dashed horizontal line (CheapShark's lowest-ever price). */
export function buildChart(points: ChartPoint[], ever: number | null, width = 320, height = 96, pad = 8): Chart {
  const prices = [...points.map((p) => p.price), ...(ever !== null ? [ever] : [])];
  const min = prices.length ? Math.min(...prices) : 0;
  const max = prices.length ? Math.max(...prices) : 0;
  const span = max - min || 1;
  const t0 = points[0]?.t ?? 0;
  const tSpan = (points[points.length - 1]?.t ?? 0) - t0 || 1;
  const y = (price: number) => (max === min ? height / 2 : pad + (1 - (price - min) / span) * (height - pad * 2));
  const dots = points.map((p) => ({ x: points.length === 1 ? width / 2 : pad + ((p.t - t0) / tSpan) * (width - pad * 2), y: y(p.price), t: p.t, price: p.price }));
  const round = (n: number) => Math.round(n * 10) / 10;
  return { width, height, line: dots.map((d, i) => `${i ? "L" : "M"}${round(d.x)} ${round(d.y)}`).join(" "), dots, everY: ever === null ? null : y(ever), min, max };
}

const day = (t: number) => new Date(t).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
/** The graph's caption: always says where the data comes from and how far back it goes. */
export function historyCaption(observations: PriceObservation[], everDate: number | null, t: (message: string) => string): string {
  const usd = observations.filter((o) => o.currency === "USD");
  const since = usd[0] ? t(usd.length === 1 ? "Local observations since {date} ({count} point)" : "Local observations since {date} ({count} points)").replace("{date}", day(usd[0].t)).replace("{count}", String(usd.length)) : t("No local observations yet");
  const dateSuffix = everDate ? ` (${day(everDate * 1000)})` : "";
  return `${since} ${t("Plus the lowest-ever price from CheapShark{dateSuffix}.").replace("{dateSuffix}", dateSuffix)} ${t("Prices are in USD.")}`;
}

// --- Assembling a result page ----------------------------------------------------------------------------------

const uniq = (items: string[]) => [...new Set(items.map((item) => item.trim()).filter(Boolean))];
const https = (url?: string) => (url && /^https:\/\//i.test(url) ? url : undefined);
export const steamStoreUrl = (appId: number) => `https://store.steampowered.com/app/${appId}`;

export function igdbRating(game: IgdbGame | null | undefined): Rating | null {
  return game && typeof game.total_rating === "number" && game.total_rating > 0 ? { score: Math.round(game.total_rating), count: game.total_rating_count ?? null } : null;
}

export type DetailInputs = {
  hit: SearchHit; igdb: IgdbGame | null; sgdb: SgdbAsset[]; steam: SteamStoreDetails | null; prices: GamePrices; steamAppId: number | null;
};

/** Merges every provider's answer into one page. IGDB wins for text and ratings, Steam fills the gaps, SteamGridDB supplies artwork. Pure. */
export function assembleDetails({ hit, igdb, sgdb, steam, prices, steamAppId }: DetailInputs): GameDetails {
  const igdbShots = (igdb?.screenshots ?? []).map((s) => resolveIgdbImage(s.url, "t_screenshot_big")).filter((u): u is string => Boolean(u));
  const developers = (igdb?.involved_companies ?? []).filter((c) => c.developer && c.company?.name).map((c) => c.company?.name ?? "");
  const art: GameArt = { covers: sgdb.filter((a) => a.kind === "grids").slice(0, MAX_ART), heroes: sgdb.filter((a) => a.kind === "heroes").slice(0, MAX_ART), logos: sgdb.filter((a) => a.kind === "logos").slice(0, MAX_ART) };
  const links: GameLink[] = [];
  const addLink = (label: string, url?: string) => { const safe = https(url); if (safe && !links.some((l) => l.url === safe)) links.push({ label, url: safe }); };
  if (steamAppId) addLink("Steam store", steamStoreUrl(steamAppId));
  addLink("IGDB", igdb?.url);
  (igdb?.websites ?? []).slice(0, 6).forEach((site) => { try { addLink(new URL(site.url ?? "").hostname.replace(/^www\./, ""), site.url); } catch { /* ignore malformed */ } });
  const sources = [igdb || hit.igdb ? "IGDB" : "", sgdb.length || hit.sgdb ? "SteamGridDB" : "", steam ? "Steam" : "", prices.shark ? "CheapShark" : ""].filter(Boolean);
  return {
    key: hit.key, name: igdb?.name ?? hit.name,
    description: (igdb?.summary ?? "").trim() || steam?.description?.trim() || "",
    genres: uniq([...(igdb?.genres ?? []).map((g) => g.name), ...(steam?.genres ?? [])]).slice(0, 10),
    releaseDate: igdb?.first_release_date ?? steam?.releaseDate ?? (hit.sgdb?.release_date ?? null),
    developers: uniq([...developers, ...(steam?.developers ?? [])]).slice(0, 6),
    publishers: uniq(steam?.publishers ?? []).slice(0, 4),
    platforms: uniq((igdb?.platforms ?? []).map((p) => p.name)).slice(0, 12),
    rating: igdbRating(igdb),
    screenshots: uniq([...igdbShots, ...(steam?.screenshots ?? [])]).slice(0, MAX_SCREENSHOTS),
    art, links,
    similar: (igdb?.similar_games ?? []).filter((g) => g.name).slice(0, 8).map((g) => ({ name: g.name, coverUrl: resolveIgdbImage(g.cover?.url, "t_cover_small") })),
    coverUrl: hit.coverUrl ?? art.covers[0]?.thumb ?? steam?.coverUrl,
    heroUrl: art.heroes[0]?.url ?? resolveIgdbImage(igdb?.artworks?.[0]?.url, "t_1080p") ?? steam?.heroUrl,
    steamAppId, prices, sources,
  };
}

// --- Backend (providers) ---------------------------------------------------------------------------------------

export type GameSearchBackend = {
  search: (query: string, signal: AbortSignal) => Promise<SearchHit[]>;
  details: (hit: SearchHit, signal: AbortSignal) => Promise<GameDetails>;
};

/** The IGDB hits first (they carry the full record), then SteamGridDB-only hits whose name IGDB did not already return. Pure. */
export function mergeHits(igdb: IgdbGame[], sgdb: SgdbGame[]): SearchHit[] {
  const hits: SearchHit[] = igdb.filter((g) => g.name).map((g) => ({
    key: `igdb:${g.id ?? normalizeText(g.name)}`, name: g.name, igdb: g, coverUrl: resolveIgdbImage(g.cover?.url, "t_cover_big"),
    year: g.first_release_date ? new Date(g.first_release_date * 1000).getUTCFullYear() : undefined,
  }));
  const seen = new Set(hits.map((h) => normalizeText(h.name)));
  for (const g of sgdb) {
    const norm = normalizeText(g.name);
    if (seen.has(norm)) continue;
    seen.add(norm);
    hits.push({ key: `sgdb:${g.id}`, name: g.name, sgdb: g, year: g.release_date ? new Date(g.release_date * 1000).getUTCFullYear() : undefined });
  }
  return hits.slice(0, 12);
}

const unlessAborted = (signal: AbortSignal) => { if (signal.aborted) throw new DOMException("Aborted", "AbortError"); };

type Cache<V> = { get: (key: string) => V | undefined; set: (key: string, value: V) => void };
/** Small in-memory LRU. API data is never written to disk (provider terms); only the local price observations are persisted. */
export function createMemoryCache<V>(limit: number, ttlMs: number, now: () => number = Date.now): Cache<V> {
  const map = new Map<string, { at: number; value: V }>();
  return {
    get(key) {
      const hit = map.get(key);
      if (!hit) return undefined;
      if (now() - hit.at > ttlMs) { map.delete(key); return undefined; }
      map.delete(key); map.set(key, hit);
      return hit.value;
    },
    set(key, value) { map.delete(key); map.set(key, { at: now(), value }); while (map.size > limit) map.delete(map.keys().next().value as string); },
  };
}

const searchCache = createMemoryCache<SearchHit[]>(30, 10 * 60 * 1000);
const detailsCache = createMemoryCache<GameDetails>(20, 30 * 60 * 1000);

/** Region for Steam prices. The history graph is USD, so this is fixed to the US store. */
export const STEAM_REGION = "us";

export async function getSteamPrice(appId: number, cc = STEAM_REGION): Promise<SteamPrice | null> {
  try {
    const result = await invoke<{ status: string; data: SteamPrice | null }>("get_steam_price", { appId, cc });
    return result.status === "ok" ? result.data : null;
  } catch { return null; }
}

export function createProviderBackend(client: SupabaseClient, ready: Readiness): GameSearchBackend {
  return {
    async search(query, signal) {
      const key = `${ready.igdb}:${ready.steamgriddb}:${normalizeText(query)}`;
      const cached = searchCache.get(key);
      if (cached) return cached;
      const [igdb, sgdb] = await Promise.allSettled([ready.igdb ? lookupIgdbGames(client, query) : Promise.resolve([]), ready.steamgriddb ? sgdbSearch(client, query) : Promise.resolve([])]);
      unlessAborted(signal);
      if (igdb.status === "rejected" && sgdb.status === "rejected") throw igdb.reason;
      const hits = mergeHits(igdb.status === "fulfilled" ? igdb.value : [], sgdb.status === "fulfilled" ? sgdb.value : []);
      searchCache.set(key, hits);
      return hits;
    },
    async details(hit, signal) {
      const cached = detailsCache.get(hit.key);
      if (cached) return cached;
      const quiet = <T>(job: Promise<T>, fallback: T) => job.catch(() => fallback);
      const igdbJob = quiet((async () => {
        if (hit.igdb) return hit.igdb;
        if (!ready.igdb) return null;
        return bestIgdbMatch(hit.name, await lookupIgdbGames(client, hit.name));
      })(), null);
      const artJob = quiet((async () => {
        if (!ready.steamgriddb) return [] as SgdbAsset[];
        const game = hit.sgdb ?? bestSgdbGame(hit.name, await sgdbSearch(client, hit.name));
        return game ? await sgdbAssets(client, { gameId: game.id }, { kinds: ["grids", "heroes", "logos"], limit: MAX_ART }) : [];
      })(), [] as SgdbAsset[]);
      // CheapShark first: it also tells us the Steam app id, which unlocks Steam's details and price. Requests share one throttled client.
      const shark = await quiet(getPriceInfo({ title: hit.name }), null);
      unlessAborted(signal);
      const steamAppId = Number(shark?.steamAppId) > 0 ? Number(shark?.steamAppId) : null;
      const [steamResult, steamPrice] = steamAppId ? await Promise.all([quiet(getSteamStoreDetails(steamAppId), null), getSteamPrice(steamAppId)]) : [null, null];
      const [igdb, sgdb] = await Promise.all([igdbJob, artJob]);
      unlessAborted(signal);
      const details = assembleDetails({ hit, igdb, sgdb, steam: steamResult?.status === "ok" ? steamResult.details ?? null : null, prices: { steam: steamPrice, shark }, steamAppId });
      detailsCache.set(hit.key, details);
      return details;
    },
  };
}

// Dev-only hook: the browser build has no Supabase, so the dev mock installs a fake backend for screenshots and tests.
let override: GameSearchBackend | null = null;
export const setGameSearchBackendForDev = (backend: GameSearchBackend | null) => { override = backend; };
export const gameSearchBackendOverride = () => override;
