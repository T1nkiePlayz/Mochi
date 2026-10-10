import type { SupabaseClient } from "@supabase/supabase-js";
import { igdbIconFor, lookupIgdbGames } from "./igdb";

type CacheEntry = { promise: Promise<string | null>; expiresAt: number };
const iconLookups = new Map<string, CacheEntry>();
const SUCCESS_TTL = Number.POSITIVE_INFINITY;
const MISS_TTL_MS = 30_000;

/**
 * Resolve verified game artwork through IGDB, sharing in-flight requests between Discover tabs
 * and the Add Game search picker. Empty results are briefly cached to avoid repeat requests while
 * a user types, while successful artwork stays cached for the lifetime of the app.
 */
export function lookupGameIcon(client: SupabaseClient, cacheKey: string, name: string): Promise<string | null> {
  const normalizedName = name.trim().toLocaleLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const key = `${cacheKey.trim().toLocaleLowerCase()}|${normalizedName}`;
  const cached = iconLookups.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;
  if (cached) iconLookups.delete(key);

  const entry: CacheEntry = { promise: Promise.resolve(null), expiresAt: SUCCESS_TTL };
  entry.promise = lookupIgdbGames(client, name).then((matches) => {
    const url = igdbIconFor(name, matches);
    if (iconLookups.get(key) === entry) entry.expiresAt = url ? SUCCESS_TTL : Date.now() + MISS_TTL_MS;
    return url;
  }).catch((error: unknown) => {
    if (iconLookups.get(key) === entry) entry.expiresAt = Date.now() + MISS_TTL_MS;
    throw error;
  });
  iconLookups.set(key, entry);
  return entry.promise;
}
