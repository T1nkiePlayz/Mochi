import { invoke } from "@tauri-apps/api/core";
import type { Piko } from "../models";
import { readJson, storageKeys, writeJson } from "./storage";
import { addToWishlist, readWishlist, updateWishlistItem, type WishlistInput, type WishlistItem } from "./wishlist";

/** Free-game and sale alerts (experimental "deal-alerts"). Sources and terms: docs/deals.md. */
export type StoreId = "steam" | "epic" | "gog";
export const dealStores: Array<{ id: StoreId; label: string; sharkId: string }> = [
  { id: "steam", label: "Steam", sharkId: "1" },
  { id: "epic", label: "Epic Games Store", sharkId: "25" },
  { id: "gog", label: "GOG", sharkId: "7" },
];
export const storeLabel = (sharkId: string) => dealStores.find((store) => store.sharkId === sharkId)?.label ?? "Other store";

export type EpicFreeGame = { id: string; title: string; url: string; state: "free-now" | "upcoming"; start: string | null; end: string | null; originalPrice: string | null };
export type Deal = { dealId: string; storeId: string; gameId: string; title: string; salePrice: number; normalPrice: number; savings: number; steamAppId: string | null; link: string; lastChange: number };
export type StoreDeal = { storeId: string; price: number; retailPrice: number; savings: number; link: string };
export type PriceInfo = { gameId: string; title: string; steamAppId: string | null; cheapestNow: number | null; cheapestEver: number | null; cheapestEverDate: number | null; deals: StoreDeal[] };
export type DealsResult<T> = { status: "ok" | "offline" | "error"; data: T | null; message: string | null };

export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const RETRY_MS = 30 * 60 * 1000;
/** Sales are only announced when they are at least this deep. */
export const ALERT_MIN_SAVINGS = 50;
export const MAX_ALERTS_PER_CHECK = 8;
export const MAX_WATCHES_PER_CHECK = 20;
const SEEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SEEN_LIMIT = 400;

/** Library source id -> stores the user evidently shops at. Heroic hosts Epic and GOG libraries. */
const SOURCE_STORES: Record<string, StoreId[]> = { steam: ["steam"], epic: ["epic"], gog: ["gog"], heroic: ["epic", "gog"] };

/** Stores seen in the library's sources. */
export function detectStores(library: Array<Pick<Piko, "sourceId">>): StoreId[] {
  const found = new Set<StoreId>();
  for (const piko of library) for (const store of SOURCE_STORES[piko.sourceId ?? ""] ?? []) found.add(store);
  return dealStores.map((store) => store.id).filter((id) => found.has(id));
}

export type StoreChoices = Partial<Record<StoreId, boolean>>;
export const readStoreChoices = (): StoreChoices => {
  const raw = readJson<Record<string, unknown>>(storageKeys.dealsStores, {});
  return Object.fromEntries(dealStores.filter((store) => typeof raw[store.id] === "boolean").map((store) => [store.id, raw[store.id] as boolean]));
};
export const writeStoreChoices = (choices: StoreChoices) => writeJson(storageKeys.dealsStores, choices);

/** Detected stores, with the user's explicit on/off choices applied on top. */
export function activeStores(detected: StoreId[], choices: StoreChoices): StoreId[] {
  return dealStores.map((store) => store.id).filter((id) => choices[id] ?? detected.includes(id));
}
export const sharkIds = (stores: StoreId[]) => dealStores.filter((store) => stores.includes(store.id)).map((store) => store.sharkId);

/** Sales from the user's stores, deepest discount first. */
export function filterDeals(deals: Deal[], stores: StoreId[]): Deal[] {
  const ids = new Set(sharkIds(stores));
  return deals.filter((deal) => ids.has(deal.storeId)).sort((a, b) => b.savings - a.savings);
}

export type DealsState = { checkedAt: number; seen: Record<string, number> };
const emptyState = (): DealsState => ({ checkedAt: 0, seen: {} });
export function readDealsState(): DealsState {
  const raw = readJson<Partial<DealsState>>(storageKeys.dealsState, {});
  const seen = raw.seen && typeof raw.seen === "object" ? Object.fromEntries(Object.entries(raw.seen).filter(([, at]) => typeof at === "number")) : {};
  return { ...emptyState(), checkedAt: typeof raw.checkedAt === "number" ? raw.checkedAt : 0, seen };
}
export const writeDealsState = (state: DealsState) => writeJson(storageKeys.dealsState, state);

/** Identity of an alert: the same free game or the same sale price is announced once. */
export const epicAlertKey = (game: EpicFreeGame) => `epic:${game.id}:${game.start ?? ""}`;
export const dealAlertKey = (deal: Deal) => `deal:${deal.storeId}:${deal.gameId}:${deal.salePrice}`;

/** Drops old entries and keeps the newest `SEEN_LIMIT`, so the stored set stays small. */
export function pruneSeen(seen: Record<string, number>, now: number): Record<string, number> {
  return Object.fromEntries(Object.entries(seen).filter(([, at]) => now - at < SEEN_TTL_MS).sort((a, b) => b[1] - a[1]).slice(0, SEEN_LIMIT));
}

export type DealAlert = { key: string; title: string; message: string; item: string };

const money = (value: number) => `$${value.toFixed(2)}`;

/** Alerts not announced before: free Epic games right now, and deep sales. Marks them seen in `seen` (a copy is returned). */
export function newAlerts(input: { epic: EpicFreeGame[]; deals: Deal[]; stores: StoreId[]; seen: Record<string, number>; now: number }): { alerts: DealAlert[]; seen: Record<string, number> } {
  const seen = { ...input.seen };
  const alerts: DealAlert[] = [];
  const add = (alert: DealAlert) => { if (alert.key in seen) return; seen[alert.key] = input.now; alerts.push(alert); };
  if (input.stores.includes("epic")) {
    for (const game of input.epic) if (game.state === "free-now") add({ key: epicAlertKey(game), title: "Free on Epic", message: `${game.title} is free to keep on the Epic Games Store${game.end ? ` until ${new Date(game.end).toLocaleDateString()}` : ""}.`, item: game.title });
  }
  for (const deal of filterDeals(input.deals, input.stores)) {
    if (deal.savings < ALERT_MIN_SAVINGS) continue;
    add({ key: dealAlertKey(deal), title: "Game on sale", message: `${deal.title} is ${Math.round(deal.savings)}% off on ${storeLabel(deal.storeId)}: ${money(deal.salePrice)} (was ${money(deal.normalPrice)}).`, item: deal.title });
  }
  return { alerts: alerts.slice(0, MAX_ALERTS_PER_CHECK), seen };
}

/** Whether a watched game's current price should notify: at or under the target, and not already announced at this price or lower. */
export function priceWatchTriggered(watch: NonNullable<WishlistItem["priceWatch"]>, price: number): boolean {
  if (typeof watch.targetPrice !== "number" || !(watch.targetPrice > 0) || !Number.isFinite(price)) return false;
  if (price > watch.targetPrice) return false;
  return watch.lastPrice === undefined || watch.lastPrice > watch.targetPrice || price < watch.lastPrice;
}

/** Records the price just seen on a watch; `triggered` says whether to alert. Pure. */
export function applyPrice(watch: NonNullable<WishlistItem["priceWatch"]>, price: number, now: number): { watch: NonNullable<WishlistItem["priceWatch"]>; triggered: boolean } {
  return { triggered: priceWatchTriggered(watch, price), watch: { ...watch, lastPrice: price, checkedAt: now } };
}

// --- Native lookups -------------------------------------------------------------------------------------------

const call = async <T>(command: string, args?: Record<string, unknown>): Promise<DealsResult<T>> => {
  try { return await invoke<DealsResult<T>>(command, args); } catch (error) { return { status: "error", data: null, message: error instanceof Error ? error.message : String(error) }; }
};
export const fetchEpicFreeGames = () => call<EpicFreeGame[]>("get_epic_free_games");
export const fetchDeals = (stores: StoreId[]) => call<Deal[]>("get_cheapshark_deals", { storeIds: sharkIds(stores) });

/** Current and cheapest-ever prices of a game (CheapShark; in USD). Cached natively for an hour. */
export async function getPriceInfo(query: { title?: string; steamAppId?: number | string }): Promise<PriceInfo | null> {
  const appId = Number(query.steamAppId);
  const result = await call<PriceInfo>("get_price_info", { title: query.title ?? null, steamAppId: Number.isInteger(appId) && appId > 0 ? appId : null });
  return result.status === "ok" ? result.data : null;
}

/** Lookup arguments for a wishlist item: its Steam app id when it has one, else its name. */
export const watchQuery = (item: Pick<WishlistItem, "name" | "source" | "externalId">) => ({ title: item.name, steamAppId: item.source === "steam" ? item.externalId : undefined });

/** Watches a game's price: adds it to the wishlist when needed and stores the target in its `priceWatch`. Returns the item, or null when it could not be stored. */
export function watchPrice(item: WishlistInput | WishlistItem, targetPrice: number): WishlistItem | null {
  if (!(targetPrice > 0) || !Number.isFinite(targetPrice)) return null;
  const stored = addToWishlist(item);
  if (!stored) return null;
  updateWishlistItem(stored.id, { priceWatch: { ...stored.priceWatch, targetPrice, currency: "USD" } });
  return readWishlist().find((entry) => entry.id === stored.id) ?? null;
}

export function unwatchPrice(id: string): void {
  updateWishlistItem(id, { priceWatch: undefined });
}

export const watchedItems = (items: WishlistItem[]) => items.filter((item) => typeof item.priceWatch?.targetPrice === "number");

export type CheckDeps = {
  stores: StoreId[];
  now: number;
  seen: Record<string, number>;
  epic: () => Promise<DealsResult<EpicFreeGame[]>>;
  deals: (stores: StoreId[]) => Promise<DealsResult<Deal[]>>;
  price: (item: WishlistItem) => Promise<number | null>;
  watches: WishlistItem[];
  shouldStop: () => boolean;
};
export type CheckResult = {
  epic: EpicFreeGame[]; deals: Deal[]; alerts: DealAlert[]; seen: Record<string, number>;
  watchUpdates: Array<{ id: string; priceWatch: NonNullable<WishlistItem["priceWatch"]> }>; watchAlerts: DealAlert[];
  offline: boolean; error: string | null;
};

/** One full check: free games, sales, then watched prices, one request at a time. Stops early when `shouldStop()` (offline, disabled). */
export async function runDealsCheck(deps: CheckDeps): Promise<CheckResult> {
  const result: CheckResult = { epic: [], deals: [], alerts: [], seen: deps.seen, watchUpdates: [], watchAlerts: [], offline: false, error: null };
  const note = (r: DealsResult<unknown>) => { if (r.status === "offline") result.offline = true; else if (r.status === "error") result.error = r.message ?? "The deals service is unavailable."; };
  if (deps.stores.includes("epic")) { const r = await deps.epic(); note(r); result.epic = r.data ?? []; }
  const sharkStores = deps.stores.filter((store) => store !== "epic");
  if (!result.offline && !deps.shouldStop() && sharkStores.length) { const r = await deps.deals(sharkStores); note(r); result.deals = r.data ?? []; }
  const fresh = newAlerts({ epic: result.epic, deals: result.deals, stores: deps.stores, seen: deps.seen, now: deps.now });
  result.alerts = fresh.alerts;
  result.seen = pruneSeen(fresh.seen, deps.now);
  for (const item of deps.watches.slice(0, MAX_WATCHES_PER_CHECK)) {
    if (result.offline || deps.shouldStop() || !item.priceWatch) break;
    const price = await deps.price(item);
    if (price === null) continue;
    const applied = applyPrice(item.priceWatch, price, deps.now);
    result.watchUpdates.push({ id: item.id, priceWatch: applied.watch });
    if (applied.triggered) result.watchAlerts.push({ key: `watch:${item.id}:${price}`, title: "Price target reached", message: `${item.name} is ${money(price)}, at or under your target of ${money(applied.watch.targetPrice ?? 0)}.`, item: item.name });
  }
  return result;
}

const fold = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Free-game and sale alerts only matter when the game is on the wishlist; everything else stays in the Deals tab. */
export function wishlistedAlerts(alerts: DealAlert[], wishlistNames: string[]): DealAlert[] {
  const wanted = wishlistNames.map(fold).filter(Boolean);
  if (!wanted.length) return [];
  return alerts.filter((alert) => { const name = fold(alert.item); return Boolean(name) && wanted.some((wish) => name === wish || name.includes(wish) || wish.includes(name)); });
}
