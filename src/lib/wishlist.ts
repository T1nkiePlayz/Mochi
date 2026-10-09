import { useSyncExternalStore } from "react";
import { readString, storageKeys, writeJson } from "./storage";

/** Reserved for the later price-watch feature; nothing reads it yet. */
export type PriceWatch = { targetPrice?: number; currency?: string; lastPrice?: number; checkedAt?: number };
export type WishlistItem = {
  id: string;
  name: string;
  source?: "igdb" | "steam" | "manual";
  externalId?: string;
  coverUrl?: string;
  note?: string;
  addedAt: number;
  priceWatch?: PriceWatch;
};
/** What callers pass to `addToWishlist`: everything but the generated fields (an `id` may be supplied to be idempotent). */
export type WishlistInput = Omit<WishlistItem, "id" | "addedAt"> & { id?: string; addedAt?: number };

export const WISHLIST_LIMIT = 500;
const NAME_MAX = 120;
const NOTE_MAX = 280;
const clean = (text: unknown, max: number) => (typeof text === "string" ? text.trim().replace(/\s+/g, " ").slice(0, max) : "");
const newId = () => `wish-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Same game = same source + external id, or (without ids) the same name ignoring case. */
export function sameWish(a: Pick<WishlistItem, "name" | "source" | "externalId">, b: Pick<WishlistItem, "name" | "source" | "externalId">): boolean {
  if (a.externalId && b.externalId) return a.source === b.source && a.externalId === b.externalId;
  return a.name.trim().toLowerCase() === b.name.trim().toLowerCase();
}

/** Makes stored data safe to render: drops junk and duplicate ids, trims text. */
export function sanitizeWishlist(value: unknown): WishlistItem[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: WishlistItem[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const name = clean(item.name, NAME_MAX);
    if (typeof item.id !== "string" || !item.id || !name || seen.has(item.id)) continue;
    seen.add(item.id);
    const source = item.source === "igdb" || item.source === "steam" || item.source === "manual" ? item.source : undefined;
    out.push({
      id: item.id, name, ...(source ? { source } : {}),
      ...(typeof item.externalId === "string" && item.externalId ? { externalId: item.externalId } : {}),
      ...(typeof item.coverUrl === "string" && /^https?:\/\//.test(item.coverUrl) ? { coverUrl: item.coverUrl } : {}),
      ...(clean(item.note, NOTE_MAX) ? { note: clean(item.note, NOTE_MAX) } : {}),
      addedAt: typeof item.addedAt === "number" && Number.isFinite(item.addedAt) ? item.addedAt : 0,
      ...(item.priceWatch && typeof item.priceWatch === "object" ? { priceWatch: item.priceWatch as PriceWatch } : {}),
    });
  }
  return out;
}

// In-memory snapshot, re-parsed only when the stored text changes (stable identity for useSyncExternalStore).
const EMPTY: WishlistItem[] = [];
let cache: { raw: string | null; items: WishlistItem[] } = { raw: null, items: EMPTY };
const listeners = new Set<() => void>();

export function readWishlist(): WishlistItem[] {
  const raw = readString(storageKeys.wishlist);
  if (raw !== cache.raw) {
    let parsed: unknown = [];
    try { parsed = raw ? JSON.parse(raw) : []; } catch { /* corrupt: treat as empty */ }
    cache = { raw, items: raw ? sanitizeWishlist(parsed) : EMPTY };
  }
  return cache.items;
}

function save(items: WishlistItem[]): void {
  writeJson(storageKeys.wishlist, items);
  listeners.forEach((listener) => listener());
}

/** Adds a game to the wishlist (the API the future game search uses). Returns the stored item, or the existing one for a duplicate; null for an empty name or a full list. */
export function addToWishlist(input: WishlistInput, now = Date.now()): WishlistItem | null {
  const name = clean(input.name, NAME_MAX);
  if (!name) return null;
  const items = readWishlist();
  const existing = items.find((item) => item.id === input.id || sameWish(item, { ...input, name }));
  if (existing) return existing;
  if (items.length >= WISHLIST_LIMIT) return null;
  const [item] = sanitizeWishlist([{ ...input, name, id: input.id || newId(), addedAt: input.addedAt ?? now }]);
  if (!item) return null;
  save([item, ...items]);
  return item;
}

export function removeFromWishlist(id: string): void {
  const items = readWishlist();
  if (items.some((item) => item.id === id)) save(items.filter((item) => item.id !== id));
}

export function updateWishlistItem(id: string, changes: Partial<Omit<WishlistItem, "id" | "addedAt">>): void {
  const items = readWishlist();
  if (!items.some((item) => item.id === id)) return;
  save(sanitizeWishlist(items.map((item) => (item.id === id ? { ...item, ...changes } : item))));
}

export const isWishlisted = (items: WishlistItem[], probe: Pick<WishlistItem, "name" | "source" | "externalId">) => items.some((item) => sameWish(item, probe));

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => { if (event.key === storageKeys.wishlist || event.key === null) listener(); };
  window.addEventListener("storage", onStorage);
  return () => { listeners.delete(listener); window.removeEventListener("storage", onStorage); };
}

export function useWishlist() {
  const items = useSyncExternalStore(subscribe, readWishlist, () => EMPTY);
  return { items, add: addToWishlist, remove: removeFromWishlist, update: updateWishlistItem };
}
