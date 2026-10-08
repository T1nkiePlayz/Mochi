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
};

export async function lookupIgdbGames(client: SupabaseClient, name: string): Promise<IgdbGame[]> {
  if (!name.trim()) return [];
  const data = await invokeProviderFunction<{ games?: IgdbGame[] }>(client, { action: "igdb-search", query: name.trim(), limit: 6 });
  return data.games ?? [];
}
