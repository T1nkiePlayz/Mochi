// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { activeStores, applyPrice, dealAlertKey, detectStores, filterDeals, newAlerts, priceWatchTriggered, pruneSeen, runDealsCheck, unwatchPrice, watchPrice, type Deal, type EpicFreeGame } from "./deals";
import { readWishlist } from "./wishlist";

const deal = (over: Partial<Deal> = {}): Deal => ({ dealId: "d", storeId: "1", gameId: "g1", title: "Game", salePrice: 5, normalPrice: 20, savings: 75, steamAppId: null, link: "https://www.cheapshark.com/redirect?dealID=d", lastChange: 1, ...over });
const epic = (over: Partial<EpicFreeGame> = {}): EpicFreeGame => ({ id: "e1", title: "Free One", url: "https://store.epicgames.com/en-US/p/x", state: "free-now", start: "2026-10-09T15:00:00.000Z", end: null, originalPrice: null, ...over });

describe("store detection and filtering", () => {
  it("maps library sources to stores, heroic to Epic and GOG", () => {
    expect(detectStores([{ sourceId: "steam" }, { sourceId: "lutris" }, {}])).toEqual(["steam"]);
    expect(detectStores([{ sourceId: "heroic" }])).toEqual(["epic", "gog"]);
    expect(detectStores([])).toEqual([]);
  });
  it("applies explicit choices over detection", () => {
    expect(activeStores(["steam"], {})).toEqual(["steam"]);
    expect(activeStores(["steam"], { steam: false, gog: true })).toEqual(["gog"]);
  });
  it("keeps only the user's stores, deepest discount first", () => {
    const list = [deal({ gameId: "a", savings: 30 }), deal({ gameId: "b", storeId: "25" }), deal({ gameId: "c", savings: 90 })];
    expect(filterDeals(list, ["steam"]).map((d) => d.gameId)).toEqual(["c", "a"]);
    expect(filterDeals(list, [])).toEqual([]);
  });
});

describe("alert dedupe", () => {
  const base = { stores: ["steam", "epic"] as const, now: 1000 };
  it("announces free Epic games and deep sales once", () => {
    const first = newAlerts({ ...base, stores: ["steam", "epic"], epic: [epic(), epic({ id: "e2", state: "upcoming" })], deals: [deal(), deal({ gameId: "shallow", savings: 20 })], seen: {} });
    expect(first.alerts.map((a) => a.item)).toEqual(["Free One", "Game"]);
    const second = newAlerts({ ...base, stores: ["steam", "epic"], epic: [epic()], deals: [deal()], seen: first.seen });
    expect(second.alerts).toEqual([]);
  });
  it("re-announces when the price drops further", () => {
    const first = newAlerts({ ...base, stores: ["steam"], epic: [], deals: [deal()], seen: {} });
    const again = newAlerts({ ...base, stores: ["steam"], epic: [], deals: [deal({ salePrice: 3 })], seen: first.seen });
    expect(again.alerts).toHaveLength(1);
    expect(dealAlertKey(deal())).not.toBe(dealAlertKey(deal({ salePrice: 3 })));
  });
  it("ignores stores the user turned off and Epic when disabled", () => {
    expect(newAlerts({ ...base, stores: ["gog"], epic: [epic()], deals: [deal()], seen: {} }).alerts).toEqual([]);
  });
  it("prunes old entries", () => {
    const day = 24 * 3600 * 1000;
    expect(Object.keys(pruneSeen({ old: 0, fresh: 40 * day }, 41 * day))).toEqual(["fresh"]);
  });
});

describe("price watch triggers", () => {
  it("fires at or under target, once per price level", () => {
    expect(priceWatchTriggered({ targetPrice: 10 }, 12)).toBe(false);
    expect(priceWatchTriggered({ targetPrice: 10 }, 10)).toBe(true);
    expect(priceWatchTriggered({ targetPrice: 10, lastPrice: 9 }, 9)).toBe(false);
    expect(priceWatchTriggered({ targetPrice: 10, lastPrice: 9 }, 8)).toBe(true);
    expect(priceWatchTriggered({ targetPrice: 10, lastPrice: 15 }, 9)).toBe(true);
    expect(priceWatchTriggered({}, 1)).toBe(false);
    expect(priceWatchTriggered({ targetPrice: 10 }, NaN)).toBe(false);
  });
  it("records the last price", () => {
    expect(applyPrice({ targetPrice: 10 }, 8, 5)).toEqual({ triggered: true, watch: { targetPrice: 10, lastPrice: 8, checkedAt: 5 } });
  });
});

describe("watchPrice", () => {
  beforeEach(() => { window.localStorage.clear(); });
  it("adds the game to the wishlist with its target and can remove it", () => {
    const item = watchPrice({ name: "Hades", source: "steam", externalId: "1145360" }, 12.5);
    expect(item?.priceWatch).toEqual({ targetPrice: 12.5, currency: "USD" });
    expect(readWishlist()).toHaveLength(1);
    expect(watchPrice({ name: "Hades", source: "steam", externalId: "1145360" }, 9)?.priceWatch?.targetPrice).toBe(9);
    expect(readWishlist()).toHaveLength(1);
    unwatchPrice(item!.id);
    expect(readWishlist()[0].priceWatch).toBeUndefined();
    expect(watchPrice({ name: "X" }, 0)).toBeNull();
  });
});

describe("runDealsCheck", () => {
  const ok = <T,>(data: T) => ({ status: "ok" as const, data, message: null });
  const watch = (id: string, target: number) => ({ id, name: id, addedAt: 0, priceWatch: { targetPrice: target } });
  it("collects alerts and watch updates", async () => {
    const price = vi.fn().mockResolvedValueOnce(8).mockResolvedValueOnce(null);
    const result = await runDealsCheck({ stores: ["steam", "epic"], now: 10, seen: {}, epic: async () => ok([epic()]), deals: async () => ok([deal()]), price, watches: [watch("a", 10), watch("b", 10)], shouldStop: () => false });
    expect(result.alerts).toHaveLength(2);
    expect(result.watchAlerts.map((a) => a.item)).toEqual(["a"]);
    expect(result.watchUpdates).toEqual([{ id: "a", priceWatch: { targetPrice: 10, lastPrice: 8, checkedAt: 10 } }]);
  });
  it("stops when offline and skips Epic when it is not a chosen store", async () => {
    const epicFn = vi.fn(async () => ok([] as EpicFreeGame[]));
    const price = vi.fn();
    const result = await runDealsCheck({ stores: ["steam"], now: 1, seen: {}, epic: epicFn, deals: async () => ({ status: "offline", data: null, message: "x" }), price, watches: [watch("a", 5)], shouldStop: () => false });
    expect(epicFn).not.toHaveBeenCalled();
    expect(result.offline).toBe(true);
    expect(price).not.toHaveBeenCalled();
  });
  it("honours shouldStop between requests", async () => {
    const price = vi.fn();
    await runDealsCheck({ stores: ["steam"], now: 1, seen: {}, epic: async () => ok([]), deals: async () => ok([]), price, watches: [watch("a", 5)], shouldStop: () => true });
    expect(price).not.toHaveBeenCalled();
  });
});
