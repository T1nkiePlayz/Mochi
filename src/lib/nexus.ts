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
  // Do not invent a cover URL from the GraphQL id: Nexus game ids are not guaranteed to be the
  // numeric filename used by its static image CDN. Missing icon data is handled by the configured IGDB fallback.

  return {
    id,
    name,
    domainName,
    ...(iconUrl ? { iconUrl: String(iconUrl) } : {}),
    ...(Number.isFinite(modCount) && modCount > 0 ? { modCount } : {}),
    ...(typeof value.genre === "string" && value.genre.trim() ? { genre: value.genre.trim() } : {}),
  };
}

const NEXUS_GRAPHQL = "https://api.nexusmods.com/v2/graphql";
/** The public GraphQL API serves at most this many nodes per request. */
const NEXUS_PAGE_MAX = 80;
const GAMES_QUERY = "query($count: Int!, $offset: Int!, $filter: GamesSearchFilter) { games(filter: $filter, count: $count, offset: $offset, sort: [{ downloads: { direction: DESC } }]) { nodes { id name domainName modCount genre } } }";
const MODS_QUERY = "query($domain: String!, $count: Int!, $offset: Int!) { mods(filter: { gameDomainName: { value: $domain, op: EQUALS } }, sort: [{ downloads: { direction: DESC } }], count: $count, offset: $offset) { totalCount nodes { modId name summary thumbnailUrl pictureUrl author } } }";

/** Public catalog data needs no API key (and sending none avoids Nexus rejecting a stale one), so this goes straight to Nexus. */
async function nexusGraphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  let response: Response;
  try {
    response = await fetch(NEXUS_GRAPHQL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Application-Name": "Mochi", "Application-Version": "0.1.0" },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch { throw new Error("Unable to reach Nexus Mods. Try again."); }
  if (response.status === 429) throw new Error("Nexus Mods is rate limiting requests. Try again later.");
  if (!response.ok) throw new Error(`Nexus Mods returned HTTP ${response.status}.`);
  const payload = await response.json().catch(() => null) as { data?: T; errors?: Array<{ message?: string }> } | null;
  if (!payload?.data) throw new Error(payload?.errors?.map((item) => item.message).filter(Boolean).join("; ") || "Nexus Mods returned invalid data.");
  return payload.data;
}

let gamesCache: { at: number; games: NexusGame[] } | null = null;
const GAMES_TTL_MS = 10 * 60_000;
const POPULAR_GAME_PAGES = 3;

/** Nexus games by name, or the most downloaded games when `query` is empty. Keyless. */
export async function getNexusGames(_client: SupabaseClient | null, query = ""): Promise<NexusGame[]> {
  const needle = query.trim();
  if (!needle && gamesCache && Date.now() - gamesCache.at < GAMES_TTL_MS) return gamesCache.games;
  const pages = needle ? [0] : Array.from({ length: POPULAR_GAME_PAGES }, (_, index) => index);
  const filter = needle ? { name: { value: needle, op: "WILDCARD" } } : undefined;
  const results = await Promise.all(pages.map((page) => nexusGraphql<{ games?: { nodes?: unknown[] } }>(GAMES_QUERY, { count: NEXUS_PAGE_MAX, offset: page * NEXUS_PAGE_MAX, filter })));
  const seen = new Set<string>();
  const games = results
    .flatMap((result) => result.games?.nodes ?? [])
    .map(normalizeNexusGame)
    .filter((game): game is NexusGame => Boolean(game) && !seen.has(game!.domainName) && Boolean(seen.add(game!.domainName)));
  if (!needle) gamesCache = { at: Date.now(), games };
  return games;
}

type RawGraphqlMod = { modId?: number | string; name?: string; summary?: string; thumbnailUrl?: string; pictureUrl?: string; author?: string };

/**
 * Mods of a Nexus game. "catalog" lists the most downloaded mods first, straight from Nexus's public GraphQL API
 * (no key needed). "trending" needs the user's key via the edge function and falls back to the catalog without one.
 */
export async function getNexusMods(
  client: SupabaseClient | null,
  gameDomain: string,
  options: { sort?: NexusModSort; offset?: number; limit?: number } = {},
): Promise<NexusModPage> {
  const limit = Math.max(8, Math.min(NEXUS_PAGE_MAX, Math.floor(options.limit ?? NEXUS_PAGE_MAX)));
  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  if (options.sort === "trending" && client) {
    try {
      const data = await invokeProviderFunction<{ mods?: NexusMod[]; total?: number; offset?: number }>(client, { action: "nexus-mods", gameDomain, sort: "trending", offset, limit });
      return { mods: data.mods ?? [], total: Number(data.total ?? data.mods?.length ?? 0), offset: Number(data.offset ?? offset) };
    } catch { /* No key or Nexus refused it: show the most downloaded mods instead of nothing. */ }
  }
  const domain = gameDomain.trim().replace(/[^a-z0-9_-]/gi, "");
  if (!domain) throw new Error("Invalid Nexus game.");
  const data = await nexusGraphql<{ mods?: { totalCount?: number; nodes?: RawGraphqlMod[] } }>(MODS_QUERY, { domain, count: limit, offset });
  const mods = (data.mods?.nodes ?? []).flatMap((mod): NexusMod[] => {
    const modId = Number(mod.modId);
    if (!Number.isSafeInteger(modId) || modId < 1) return [];
    const picture = mod.thumbnailUrl || mod.pictureUrl;
    return [{
      id: String(modId), modId, name: String(mod.name ?? "Untitled mod"),
      ...(mod.author ? { author: mod.author } : {}), ...(mod.summary ? { summary: mod.summary } : {}), ...(picture ? { pictureUrl: picture } : {}),
      modPageUrl: nexusModPageUrl(domain, modId),
    }];
  });
  return { mods, total: Number(data.mods?.totalCount ?? mods.length), offset };
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

export type NexusFile = { fileId: number; name: string; fileName: string; version?: string; category?: string; sizeKb?: number; /** Unix seconds from Mochi's edge function (0 when unknown). */ uploadedAt?: string | number; primary?: boolean };
export async function getNexusFiles(client: SupabaseClient, gameDomain: string, modId: number): Promise<NexusFile[]> {
  const data = await invokeProviderFunction<{ files?: NexusFile[] }>(client, { action: "nexus-files", gameDomain, modId });
  return Array.isArray(data.files) ? data.files : [];
}

/** Premium users resolve a link directly; free users need the `key` and `expires` of an nxm:// link. Throws `EdgeFunctionError` with code `premium_required` otherwise. */
export async function getNexusDownload(client: SupabaseClient, gameDomain: string, modId: number, fileId: number, link?: { key: string; expires: number }): Promise<{ url: string; fileName: string }> {
  return invokeProviderFunction<{ url: string; fileName: string }>(client, { action: "nexus-download", gameDomain, modId, fileId, ...(link ? { key: link.key, expires: link.expires } : {}) });
}

export type NexusRequirement = {
  modId: number; name: string; /** Domain of the requirement's game; undefined when Nexus did not tell and it is not the mod's own game. */ gameDomain?: string;
  /** True for a requirement outside Nexus (a framework's own site); `url` is where to get it. */
  external: boolean; url?: string; notes?: string;
};
type RawRequirement = { modId?: number | string; modName?: string; gameId?: number | string; url?: string; externalRequirement?: boolean; notes?: string };
const REQUIREMENTS_QUERY = "query($ids: [CompositeDomainWithIdInput!]!) { legacyModsByDomain(ids: $ids) { nodes { modId gameId modRequirements { nexusRequirements { nodes { modId modName gameId url externalRequirement notes } } } } } }";
const GAME_DOMAIN_QUERY = "query($id: ID!) { game(id: $id) { domainName } }";

/** The requirements the mod's author listed on Nexus ("Requirements" tab). Public GraphQL, no key. Requirements of other games get their own domain looked up. */
export async function getNexusRequirements(gameDomain: string, modId: number): Promise<NexusRequirement[]> {
  const domain = gameDomain.trim().replace(/[^a-z0-9_-]/gi, "");
  if (!domain || !Number.isSafeInteger(modId) || modId < 1) return [];
  const data = await nexusGraphql<{ legacyModsByDomain?: { nodes?: Array<{ gameId?: number | string; modRequirements?: { nexusRequirements?: { nodes?: RawRequirement[] } } } | null> } }>(REQUIREMENTS_QUERY, { ids: [{ gameDomain: domain, modId }] });
  const node = data.legacyModsByDomain?.nodes?.[0];
  const raw = node?.modRequirements?.nexusRequirements?.nodes ?? [];
  const domains = new Map<string, string | undefined>();
  const out: NexusRequirement[] = [];
  for (const requirement of raw.slice(0, 50)) {
    const id = Number(requirement.modId);
    const name = String(requirement.modName ?? "").trim();
    if (!Number.isSafeInteger(id) || id < 1 || !name) continue;
    const external = requirement.externalRequirement === true;
    const url = typeof requirement.url === "string" && /^https:\/\//i.test(requirement.url) ? requirement.url : undefined;
    let reqDomain: string | undefined = domain;
    if (!external && requirement.gameId != null && String(requirement.gameId) !== String(node?.gameId)) {
      const gameId = String(requirement.gameId);
      if (!domains.has(gameId)) domains.set(gameId, await nexusGraphql<{ game?: { domainName?: string } }>(GAME_DOMAIN_QUERY, { id: gameId }).then((reply) => reply.game?.domainName?.replace(/[^a-z0-9_-]/gi, "") || undefined, () => undefined));
      reqDomain = domains.get(gameId);
    }
    out.push({ modId: id, name, external, ...(url ? { url } : {}), ...(reqDomain && !external ? { gameDomain: reqDomain } : {}), ...(requirement.notes ? { notes: String(requirement.notes) } : {}) });
  }
  return out;
}

export const nexusModPageUrl = (gameDomain: string, modId: number, files = false) =>
  `https://www.nexusmods.com/${encodeURIComponent(gameDomain)}/mods/${modId}${files ? "?tab=files" : ""}`;

export type NexusMd5Match = { md5: string; modId: number; fileId: number; name: string; version: string; fileName: string; uploadedAt: number; pictureUrl?: string };
type RawMd5Match = { modId?: number; fileId?: number; name?: string; modVersion?: string; fileVersion?: string; fileName?: string; uploadedAt?: number | string; pictureUrl?: string };
/** Installed files identified by MD5 on Nexus Mods (the user's own key; one lookup per hash). Unknown hashes are simply missing. */
export async function nexusMd5Search(client: SupabaseClient, gameDomain: string, md5s: string[], limit = 200): Promise<NexusMd5Match[]> {
  const out: NexusMd5Match[] = [];
  for (const md5 of [...new Set(md5s.map((value) => value.toLowerCase()))].slice(0, limit)) {
    const data = await invokeProviderFunction<{ matches?: RawMd5Match[] }>(client, { action: "nexus-md5", gameDomain, md5 });
    const hit = (Array.isArray(data.matches) ? data.matches : []).find((match) => Number.isSafeInteger(match.modId) && Number.isSafeInteger(match.fileId));
    if (!hit) continue;
    const uploaded = typeof hit.uploadedAt === "number" ? (hit.uploadedAt > 1e11 ? Math.floor(hit.uploadedAt / 1000) : hit.uploadedAt) : hit.uploadedAt ? Math.floor(Date.parse(hit.uploadedAt) / 1000) || 0 : 0;
    out.push({ md5, modId: hit.modId as number, fileId: hit.fileId as number, name: hit.name ?? "", version: hit.fileVersion || hit.modVersion || "", fileName: hit.fileName ?? "", uploadedAt: uploaded, pictureUrl: hit.pictureUrl });
  }
  return out;
}
