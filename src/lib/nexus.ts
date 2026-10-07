import type { SupabaseClient } from "@supabase/supabase-js";

export type NexusGame = {
  id: string;
  name: string;
  domainName: string;
  iconUrl?: string;
  modCount?: number;
};

export type NexusMod = {
  id: string;
  name: string;
  author?: string;
  summary?: string;
  pictureUrl?: string;
  modPageUrl: string;
};

export async function getNexusGames(client: SupabaseClient, query = ""): Promise<NexusGame[]> {
  const { data, error } = await client.functions.invoke("store-provider-credentials", {
    body: { action: "nexus-games", query: query.trim() },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return (data?.games ?? []) as NexusGame[];
}

export async function getNexusMods(client: SupabaseClient, gameDomain: string): Promise<NexusMod[]> {
  const { data, error } = await client.functions.invoke("store-provider-credentials", {
    body: { action: "nexus-mods", gameDomain },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return (data?.mods ?? []) as NexusMod[];
}
