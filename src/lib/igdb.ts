import type { SupabaseClient } from "@supabase/supabase-js";
import { invokeProviderFunction } from "./functions";

export type IgdbGame = {
  id?: number;
  name: string;
  summary?: string;
  cover?: { url?: string };
  artworks?: Array<{ url?: string }>;
  screenshots?: Array<{ url?: string }>;
  videos?: Array<{ name?: string; video_id?: string }>;
  genres?: Array<{ name: string }>;
  themes?: Array<{ name: string }>;
  game_modes?: Array<{ name: string }>;
  player_perspectives?: Array<{ name: string }>;
  first_release_date?: number;
  // Added to the edge function's field list for game search; absent until that function is redeployed.
  slug?: string;
  url?: string;
  platforms?: Array<{ name: string }>;
  total_rating?: number;
  total_rating_count?: number;
  websites?: Array<{ url?: string }>;
  involved_companies?: Array<{ developer?: boolean; company?: { name?: string } }>;
  similar_games?: Array<{ id?: number; name: string; cover?: { url?: string } }>;
};

export async function lookupIgdbGames(client: SupabaseClient, name: string): Promise<IgdbGame[]> {
  if (!name.trim()) return [];
  const data = await invokeProviderFunction<{ games?: IgdbGame[] }>(client, { action: "igdb-search", query: name.trim(), limit: 6 });
  return data.games ?? [];
}

/** Hours to finish the main story per IGDB game id (`normally`, else `hastily`). Missing games are omitted. */
export async function lookupTimeToBeat(client: SupabaseClient, gameIds: number[]): Promise<Map<number, number>> {
  const ids = [...new Set(gameIds)].slice(0, 100);
  const hours = new Map<number, number>();
  if (!ids.length) return hours;
  const data = await invokeProviderFunction<{ times?: Array<{ game_id?: number; hastily?: number; normally?: number }> }>(client, { action: "igdb-time-to-beat", gameIds: ids });
  for (const row of data.times ?? []) {
    const seconds = row.normally ?? row.hastily;
    if (typeof row.game_id === "number" && typeof seconds === "number" && seconds > 0) hours.set(row.game_id, seconds / 3600);
  }
  return hours;
}

const normalizeTitle = (value: string) => value.toLocaleLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/** A safe IGDB image URL for the result whose title equals `name` (so a sequel's art is never used), or null. */
export function igdbIconFor(name: string, matches: IgdbGame[]): string | null {
  const needle = normalizeTitle(name);
  const match = matches.find((candidate) => normalizeTitle(candidate.name) === needle);
  const raw = match?.cover?.url ?? match?.artworks?.[0]?.url;
  if (!raw) return null;
  let parsed: URL;
  try { parsed = new URL(raw.startsWith("//") ? `https:${raw}` : raw); } catch { return null; }
  if (parsed.protocol !== "https:" || parsed.hostname !== "images.igdb.com") return null;
  parsed.pathname = parsed.pathname.replace(/\/t_[a-z0-9_]+\//i, "/t_cover_big/");
  return parsed.toString();
}
