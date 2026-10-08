import type { SupabaseClient } from "@supabase/supabase-js";
import { invokeProviderFunction } from "./functions";

export type NexusGame = {
  id: string;
  name: string;
  domainName: string;
  iconUrl?: string;
  modCount?: number;
  genre?: string;
};

export type NexusMod = {
  id: string;
  /** Numeric Nexus mod id, needed to list files and download. */
  modId?: number;
  name: string;
  author?: string;
  summary?: string;
  pictureUrl?: string;
  modPageUrl: string;
};

export type NexusModSort = "catalog" | "trending";

export type NexusModPage = {
  mods: NexusMod[];
  total: number;
  offset: number;
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
    ...(typeof value.genre === "string" && value.genre.trim() ? { genre: value.genre.trim() } : {}),
  };
}

export async function getNexusGames(client: SupabaseClient, query = ""): Promise<NexusGame[]> {
  const data = await invokeProviderFunction<{ games?: unknown[]; data?: { games?: unknown[] } }>(client, { action: "nexus-games", query: query.trim() });

  const values: unknown[] = Array.isArray(data.games)
    ? data.games
    : Array.isArray(data.data?.games)
      ? data.data.games
      : [];

  return values
    .map(normalizeNexusGame)
    .filter((game): game is NexusGame => Boolean(game));
}

export async function getNexusMods(
  client: SupabaseClient,
  gameDomain: string,
  options: { sort?: NexusModSort; offset?: number; limit?: number } = {},
): Promise<NexusModPage> {
  const limit = Math.max(8, Math.min(100, Math.floor(options.limit ?? 100)));
  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  const data = await invokeProviderFunction<{ mods?: NexusMod[]; total?: number; offset?: number }>(client, { action: "nexus-mods", gameDomain, sort: options.sort ?? "catalog", offset, limit });
  return {
    mods: data.mods ?? [],
    total: Number(data.total ?? data.mods?.length ?? 0),
    offset: Number(data.offset ?? offset),
  };
}

/** The numeric Nexus mod id of a listed mod (older server replies only carry it in `id`). */
export function nexusModId(mod: Pick<NexusMod, "id" | "modId">): number | null {
  const value = mod.modId ?? Number(mod.id);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export type NexusStatus = { configured: boolean; premium: boolean; name?: string };
export async function getNexusStatus(client: SupabaseClient): Promise<NexusStatus> {
  const data = await invokeProviderFunction<Partial<NexusStatus>>(client, { action: "nexus-status" });
  return { configured: data.configured === true, premium: data.premium === true, ...(data.name ? { name: String(data.name) } : {}) };
}

export type NexusModDetail = {
  id: number; name: string; summary?: string; description?: string; author?: string; pictureUrl?: string;
  version?: string; endorsements?: number; modPageUrl: string;
};
export async function getNexusModDetail(client: SupabaseClient, gameDomain: string, modId: number): Promise<NexusModDetail> {
  return invokeProviderFunction<NexusModDetail>(client, { action: "nexus-mod", gameDomain, modId });
}

export type NexusFile = { fileId: number; name: string; fileName: string; version?: string; category?: string; sizeKb?: number; uploadedAt?: string; primary?: boolean };
export async function getNexusFiles(client: SupabaseClient, gameDomain: string, modId: number): Promise<NexusFile[]> {
  const data = await invokeProviderFunction<{ files?: NexusFile[] }>(client, { action: "nexus-files", gameDomain, modId });
  return Array.isArray(data.files) ? data.files : [];
}

/** Premium users resolve a link directly; free users need the `key` and `expires` of an nxm:// link. Throws `EdgeFunctionError` with code `premium_required` otherwise. */
export async function getNexusDownload(client: SupabaseClient, gameDomain: string, modId: number, fileId: number, link?: { key: string; expires: number }): Promise<{ url: string; fileName: string }> {
  return invokeProviderFunction<{ url: string; fileName: string }>(client, { action: "nexus-download", gameDomain, modId, fileId, ...(link ? { key: link.key, expires: link.expires } : {}) });
}

export const nexusModPageUrl = (gameDomain: string, modId: number, files = false) =>
  `https://www.nexusmods.com/${encodeURIComponent(gameDomain)}/mods/${modId}${files ? "?tab=files" : ""}`;
