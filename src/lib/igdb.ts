import type { SupabaseClient } from "@supabase/supabase-js";

export type IgdbSettings = {
  clientId: string;
  clientSecret: string;
};

export type IgdbGame = {
  id?: number;
  name: string;
  summary?: string;
  cover?: { url?: string };
  artworks?: Array<{ url?: string }>;
  genres?: Array<{ name: string }>;
  first_release_date?: number;
};

export async function lookupIgdbGames(client: SupabaseClient, name: string): Promise<IgdbGame[]> {
  if (!name.trim()) return [];
  const { data, error } = await client.functions.invoke("store-provider-credentials", {
    body: { action: "igdb-search", query: name.trim(), limit: 6 },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return (data?.games ?? []) as IgdbGame[];
}

export async function lookupIgdbGame(client: SupabaseClient, name: string): Promise<IgdbGame | null> {
  const games = await lookupIgdbGames(client, name);
  return games[0] ?? null;
}
