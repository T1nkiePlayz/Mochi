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

function normalizeNexusGame(value: any): NexusGame | null {
  if (!value || typeof value !== "object") return null;
  const id = value.id == null ? "" : String(value.id);
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const domainName = typeof value.domainName === "string"
    ? value.domainName.trim()
    : typeof value.domain_name === "string"
      ? value.domain_name.trim()
      : "";
  if (!name || !domainName) return null;

  const iconUrl = [
    value.iconUrl,
    value.icon_url,
    value.pictureUrl,
    value.picture_url,
    value.imageUrl,
    value.image_url,
    value.thumbnailUrl,
    value.thumbnail_url,
  ].find((candidate) => typeof candidate === "string" && candidate.trim());

  const modCount = Number(value.modCount ?? value.mod_count ?? value.file_count ?? 0);
  const resolvedIconUrl = iconUrl
    ? String(iconUrl)
    : id
      ? `https://staticdelivery.nexusmods.com/images/games/cover_${encodeURIComponent(id)}.jpg`
      : undefined;

  return {
    id,
    name,
    domainName,
    ...(resolvedIconUrl ? { iconUrl: resolvedIconUrl } : {}),
    ...(Number.isFinite(modCount) && modCount > 0 ? { modCount } : {}),
  };
}

export async function getNexusGames(client: SupabaseClient, query = ""): Promise<NexusGame[]> {
  const { data, error } = await client.functions.invoke("store-provider-credentials", {
    body: { action: "nexus-games", query: query.trim() },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);

  const values = Array.isArray(data?.games)
    ? data.games
    : Array.isArray(data?.data?.games)
      ? data.data.games
      : [];

  return values
    .map(normalizeNexusGame)
    .filter((game): game is NexusGame => Boolean(game));
}

export async function getNexusMods(client: SupabaseClient, gameDomain: string): Promise<NexusMod[]> {
  const { data, error } = await client.functions.invoke("store-provider-credentials", {
    body: { action: "nexus-mods", gameDomain },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return (data?.mods ?? []) as NexusMod[];
}
