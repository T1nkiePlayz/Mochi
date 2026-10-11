// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assembleDetails, buildChart, createDebouncedSearch, createMemoryCache, dailyLowest, gameSearchAvailable, historyCaption, historyKey, mergeHits, mergeObservations,
  observationsFromPrices, pruneHistory, readPriceHistory, recordObservations, HISTORY_POINT_CAP, type PriceObservation, type SearchHit,
} from "./gameSearch";

const H = 60 * 60 * 1000;
const obs = (t: number, price: number, over: Partial<PriceObservation> = {}): PriceObservation => ({ t, price, store: "Steam", source: "steam", currency: "USD", ...over });

describe("debounced, cancelling search", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const setup = (run: (q: string, s: AbortSignal) => Promise<string>) => {
    const events: string[] = [];
    const search = createDebouncedSearch(run, { onStart: () => events.push("start"), onResult: (q, r) => events.push(`result:${q}:${r}`), onError: (q) => events.push(`error:${q}`), onClear: () => events.push("clear") });
    return { search, events };
  };
  it("waits 300 ms and only searches for the last query", async () => {
    const run = vi.fn(async (q: string) => q.toUpperCase());
    const { search, events } = setup(run);
    search.call("ha"); vi.advanceTimersByTime(200); search.call("had"); vi.advanceTimersByTime(299);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    expect(events.at(-1)).toBe("result:had:HAD");
  });
  it("aborts the stale request and drops its late answer", async () => {
    const resolvers: Array<(v: string) => void> = [];
    const signals: AbortSignal[] = [];
    const { search, events } = setup((_q, signal) => { signals.push(signal); return new Promise((resolve) => resolvers.push(resolve)); });
    search.call("hades"); await vi.advanceTimersByTimeAsync(300);
    search.call("hades ii"); expect(signals[0].aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(300);
    resolvers[1]("new"); resolvers[0]("old"); await vi.advanceTimersByTimeAsync(0);
    expect(events.filter((e) => e.startsWith("result"))).toEqual(["result:hades ii:new"]);
  });
  it("clears for short queries and cancels pending work", async () => {
    const run = vi.fn(async () => "x");
    const { search, events } = setup(run);
    search.call("hades"); search.call(" a "); await vi.advanceTimersByTimeAsync(500);
    expect(run).not.toHaveBeenCalled();
    expect(events.at(-1)).toBe("clear");
    search.call("hades"); search.cancel(); await vi.advanceTimersByTimeAsync(500);
    expect(run).not.toHaveBeenCalled();
  });
  it("reports errors of the current query only", async () => {
    const { search, events } = setup(async () => { throw new Error("boom"); });
    search.call("hades"); await vi.advanceTimersByTimeAsync(300);
    expect(events.at(-1)).toBe("error:hades");
  });
});

describe("price history", () => {
  beforeEach(() => localStorage.clear());
  it("skips near-duplicates of the same source and store but keeps other stores", () => {
    const first = [obs(0, 10)];
    expect(mergeObservations(first, [obs(2 * H, 10)])).toHaveLength(1);
    expect(mergeObservations(first, [obs(7 * H, 9)])).toHaveLength(2);
    expect(mergeObservations(first, [obs(1 * H, 8, { store: "GOG", source: "cheapshark" })])).toHaveLength(2);
  });
  it("keeps time order and caps to the newest points", () => {
    const many = Array.from({ length: HISTORY_POINT_CAP + 30 }, (_, i) => obs(i * 7 * H, i));
    const merged = mergeObservations([], many);
    expect(merged).toHaveLength(HISTORY_POINT_CAP);
    expect(merged[0].price).toBe(30);
    expect(mergeObservations([obs(10 * H, 1)], [obs(0, 2)]).map((o) => o.t)).toEqual([0, 10 * H]);
  });
  it("ignores malformed observations", () => {
    expect(mergeObservations([{ bad: true } as unknown as PriceObservation], [obs(0, -1), obs(0, NaN)])).toEqual([]);
  });
  it("prunes to the most recently updated games", () => {
    const pruned = pruneHistory({ a: [obs(1, 1)], b: [obs(3, 1)], c: [obs(2, 1)], empty: [] }, 2);
    expect(Object.keys(pruned).sort()).toEqual(["b", "c"]);
  });
  it("persists per game and survives corrupt storage", () => {
    recordObservations("steam:1", [obs(0, 5)]);
    recordObservations("steam:1", [obs(10 * H, 4)]);
    expect(readPriceHistory()["steam:1"]).toHaveLength(2);
    localStorage.setItem("mochi:price-history", "{not json");
    expect(readPriceHistory()).toEqual({});
  });
  it("keys by Steam app id, else normalised name", () => {
    expect(historyKey({ name: "Hades", steamAppId: 1145360 })).toBe("steam:1145360");
    expect(historyKey({ name: "  HADES II!! " })).toBe(historyKey({ name: "hades ii" }));
  });
  it("turns prices into USD observations", () => {
    const list = observationsFromPrices({
      steam: { currency: "USD", initial: 2000, final: 1500, discountPercent: 25, formatted: "$15.00" },
      shark: { gameId: "1", title: "G", steamAppId: null, cheapestNow: 12, cheapestEver: 9, cheapestEverDate: 1, deals: [{ storeId: "7", price: 12, retailPrice: 20, savings: 40, link: "x" }, { storeId: "1", price: 15, retailPrice: 20, savings: 25, link: "y" }] },
    }, 5);
    expect(list.map((o) => [o.source, o.store, o.price])).toEqual([["steam", "Steam", 15], ["cheapshark", "GOG", 12]]);
    expect(observationsFromPrices({ steam: { currency: "EUR", initial: 1, final: 1, discountPercent: 0, formatted: "" }, shark: null }, 5)).toEqual([]);
  });
  it("graphs the lowest USD price per day and labels the span", () => {
    const day = 24 * H;
    const points = dailyLowest([obs(1 * H, 10), obs(2 * H, 8), obs(day + H, 9), obs(2 * day, 1, { currency: "EUR" })]);
    expect(points.map((p) => p.price)).toEqual([8, 9]);
    const chart = buildChart(points, 5);
    expect(chart.line.startsWith("M")).toBe(true);
    expect(chart.everY).toBeGreaterThan(chart.dots[0].y);
    expect(buildChart([{ t: 1, price: 3 }], null).dots).toHaveLength(1);
    expect(buildChart([], null).line).toBe("");
    const caption = historyCaption([obs(Date.UTC(2026, 0, 5), 8)], 1_740_000_000, (message) => message);
    expect(caption).toMatch(/^Local observations since .*2026.* \(1 point\) Plus the lowest-ever price from CheapShark/);
    expect(historyCaption([], null, (message) => message)).toMatch(/No local observations yet/);
  });
});

describe("result assembly", () => {
  const hit: SearchHit = { key: "igdb:1", name: "Hades" };
  const prices = { steam: null, shark: null };
  it("prefers IGDB text, fills gaps from Steam, merges and dedupes lists", () => {
    const game = assembleDetails({
      hit, steamAppId: 1145360, prices, sgdb: [],
      igdb: { name: "Hades", summary: "", genres: [{ name: "Roguelike" }], screenshots: [{ url: "//images.igdb.com/igdb/image/upload/t_thumb/a.jpg" }], total_rating: 90.6, total_rating_count: 10, platforms: [{ name: "PC" }, { name: "PC" }],
        involved_companies: [{ developer: true, company: { name: "Supergiant" } }, { developer: false, company: { name: "Pub" } }], websites: [{ url: "https://hades.example/" }, { url: "http://insecure.example/" }, { url: "garbage" }], similar_games: [{ name: "Dead Cells" }] },
      steam: { appid: 1145360, name: "Hades", description: "Steam text", genres: ["Roguelike", "Action"], screenshots: ["https://s/1.jpg"], developers: ["Supergiant"], publishers: ["Supergiant"], releaseDate: 5, coverUrl: "https://c", headerUrl: "", heroUrl: "https://h" },
    });
    expect(game.description).toBe("Steam text");
    expect(game.genres).toEqual(["Roguelike", "Action"]);
    expect(game.developers).toEqual(["Supergiant"]);
    expect(game.platforms).toEqual(["PC"]);
    expect(game.rating).toEqual({ score: 91, count: 10 });
    expect(game.screenshots).toEqual(["https://images.igdb.com/igdb/image/upload/t_screenshot_big/a.jpg", "https://s/1.jpg"]);
    expect(game.links.map((l) => l.url)).toEqual(["https://store.steampowered.com/app/1145360", "https://hades.example/"]);
    expect(game.similar).toEqual([{ name: "Dead Cells", coverUrl: undefined }]);
    expect(game.releaseDate).toBe(5);
    expect(game.sources).toEqual(["IGDB", "Steam"]);
  });
  it("works with only SteamGridDB artwork and caps each kind", () => {
    const grid = (id: number) => ({ id, kind: "grids" as const, url: `https://g/${id}`, thumb: `https://t/${id}`, width: 600, height: 900 });
    const game = assembleDetails({ hit: { key: "sgdb:2", name: "Indie", sgdb: { id: 2, name: "Indie", release_date: 99 } }, igdb: null, steam: null, steamAppId: null, prices, sgdb: Array.from({ length: 20 }, (_, i) => grid(i)) });
    expect(game.art.covers).toHaveLength(8);
    expect(game.coverUrl).toBe("https://t/0");
    expect(game.releaseDate).toBe(99);
    expect(game.rating).toBeNull();
    expect(game.sources).toEqual(["SteamGridDB"]);
  });
  it("merges hits with IGDB first and drops SteamGridDB duplicates by name", () => {
    const hits = mergeHits([{ id: 1, name: "Hades", first_release_date: 1_600_000_000 }], [{ id: 5, name: "HADES" }, { id: 6, name: "Hades II" }]);
    expect(hits.map((h) => h.key)).toEqual(["igdb:1", "sgdb:6"]);
    expect(hits[0].year).toBe(2020);
  });
  it("is available only with an IGDB or SteamGridDB key", () => {
    expect(gameSearchAvailable({ igdb: false, steamgriddb: false })).toBe(false);
    expect(gameSearchAvailable({ igdb: false, steamgriddb: true })).toBe(true);
  });
});

describe("memory cache", () => {
  it("expires and evicts the least recently used entry", () => {
    let now = 0;
    const cache = createMemoryCache<number>(2, 100, () => now);
    cache.set("a", 1); cache.set("b", 2); cache.get("a"); cache.set("c", 3);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(1);
    now = 101;
    expect(cache.get("a")).toBeUndefined();
  });
});
