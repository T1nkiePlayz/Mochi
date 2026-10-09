import { supabase } from "./supabase";
import { EdgeFunctionError, invokeEdgeFunction } from "./functions";
import { isNetworkError } from "./offline";
import { isPublicCurseforgeGame } from "./mods/resolveSources";

// CurseForge data is fetched through Mochi's own proxy (the API key never leaves the server). The API terms
// forbid saving or caching what it returns, so nothing here is persisted: identical in-flight requests share
// one promise and that is all. Callers keep results in React state for the view that shows them.

export const CF_MINECRAFT_ID = 432;
export const CF_CLASS = { mods: 6, modpacks: 4471, resourcePacks: 12, worlds: 17, shaders: 6552 } as const;
export const CF_SORT = { featured: 1, popularity: 2, lastUpdated: 3, name: 4, author: 5, totalDownloads: 6, releasedDate: 11, rating: 12 } as const;
export const CF_LOADER = { any: 0, forge: 1, cauldron: 2, liteLoader: 3, fabric: 4, quilt: 5, neoForge: 6 } as const;
export const CF_SITE = "https://www.curseforge.com";

export type CfGame = { id: number; name: string; slug: string; status?: number; apiStatus?: number; assets?: { iconUrl?: string; tileUrl?: string; coverUrl?: string } };
export type CfCategory = { id: number; gameId: number; name: string; slug: string; iconUrl?: string; isClass?: boolean; classId?: number; parentCategoryId?: number };
export type CfAuthor = { id: number; name: string; url?: string };
export type CfHash = { value: string; algo: number };
export type CfDependency = { modId: number; relationType: number };
export type CfFile = {
  id: number; modId: number; displayName: string; fileName: string; releaseType: number; fileDate?: string; fileLength?: number;
  downloadUrl?: string | null; gameVersions?: string[]; hashes?: CfHash[]; dependencies?: CfDependency[]; isAvailable?: boolean; downloadCount?: number;
};
export type CfMod = {
  id: number; gameId: number; name: string; slug: string; summary: string; downloadCount: number; classId?: number;
  links?: { websiteUrl?: string }; authors?: CfAuthor[]; logo?: { thumbnailUrl?: string; url?: string } | null;
  categories?: Array<{ id: number; name: string }>; latestFiles?: CfFile[]; allowModDistribution?: boolean | null;
  dateModified?: string; dateCreated?: string; status?: number;
  /** Newest file per game version and loader (modLoader: 1 Forge, 4 Fabric, 5 Quilt, 6 NeoForge). */
  latestFilesIndexes?: Array<{ gameVersion?: string; modLoader?: number }>;
};
export type CfPagination = { index: number; pageSize: number; resultCount: number; totalCount: number };
export type CfPage<T> = { data: T[]; pagination: CfPagination };

export type CfFailureKind = "offline" | "not_configured" | "rate_limited" | "upstream" | "bad_request" | "unavailable";
export class CurseforgeError extends Error {
  constructor(message: string, readonly kind: CfFailureKind) { super(message); this.name = "CurseforgeError"; }
}

function toError(error: unknown): CurseforgeError {
  if (error instanceof CurseforgeError) return error;
  if (error instanceof EdgeFunctionError) {
    switch (error.code) {
      case "not_configured": return new CurseforgeError("CurseForge is not set up on the Mochi server yet.", "not_configured");
      case "rate_limited": return new CurseforgeError("CurseForge is busy right now. Try again in a minute.", "rate_limited");
      case "bad_request": return new CurseforgeError(error.message || "That request was not valid.", "bad_request");
      default: return new CurseforgeError(error.message || "CurseForge could not be reached.", "upstream");
    }
  }
  if (isNetworkError(error)) return new CurseforgeError("You appear to be offline. CurseForge content needs a connection.", "offline");
  return new CurseforgeError(error instanceof Error && error.message ? error.message : "CurseForge could not be reached.", "upstream");
}

const inflight = new Map<string, Promise<unknown>>();

async function call<T>(body: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new CurseforgeError("Mochi cloud features are not configured in this build.", "unavailable");
  const client = supabase;
  const key = JSON.stringify(body);
  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;
  const request = invokeEdgeFunction<T>(client, "curseforge-proxy", body).catch((error) => { throw toError(error); }).finally(() => inflight.delete(key));
  inflight.set(key, request);
  return request;
}

const clean = <T extends Record<string, unknown>>(value: T) => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== "" && item !== null)) as Partial<T>;

export async function cfGames(index = 0, pageSize = 50): Promise<CfPage<CfGame>> {
  return normalizePage(await call<{ data?: CfGame[]; pagination?: CfPagination }>({ route: "games", index, pageSize }));
}

export async function cfCategories(gameId: number, classId?: number): Promise<CfCategory[]> {
  const result = await call<{ data?: CfCategory[] }>({ route: "categories", ...clean({ gameId, classId }) });
  return Array.isArray(result.data) ? result.data : [];
}

export type CfSearch = {
  gameId: number; classId?: number; categoryId?: number; gameVersion?: string; searchFilter?: string;
  sortField?: number; sortOrder?: "asc" | "desc"; modLoaderType?: number; index?: number; pageSize?: number;
};
export async function cfSearch(query: CfSearch): Promise<CfPage<CfMod>> {
  const pageSize = Math.min(50, Math.max(1, query.pageSize ?? 30));
  const index = Math.max(0, query.index ?? 0);
  const body = clean({ ...query, searchFilter: query.searchFilter?.trim(), pageSize, index, modLoaderType: query.gameVersion && query.modLoaderType ? query.modLoaderType : undefined });
  return normalizePage(await call<{ data?: CfMod[]; pagination?: CfPagination }>({ route: "search", ...body }));
}

export async function cfMod(modId: number): Promise<CfMod> {
  const result = await call<{ data?: CfMod }>({ route: "mod", modId });
  if (!result.data) throw new CurseforgeError("CurseForge did not return this mod.", "upstream");
  return result.data;
}

/** HTML written by the mod author. Untrusted: render it only through `sanitizeHtml`. */
export async function cfDescription(modId: number): Promise<string> {
  const result = await call<{ data?: string }>({ route: "description", modId });
  return typeof result.data === "string" ? result.data : "";
}

export async function cfFiles(modId: number, options: { gameVersion?: string; modLoaderType?: number; index?: number; pageSize?: number } = {}): Promise<CfPage<CfFile>> {
  const body = clean({ modId, gameVersion: options.gameVersion, modLoaderType: options.gameVersion && options.modLoaderType ? options.modLoaderType : undefined, index: options.index ?? 0, pageSize: Math.min(50, options.pageSize ?? 30) });
  return normalizePage(await call<{ data?: CfFile[]; pagination?: CfPagination }>({ route: "files", ...body }));
}

/** `url` is null when the author disabled third-party downloads. Mochi never builds CDN URLs itself. */
export async function cfDownloadUrl(modId: number, fileId: number): Promise<{ url: string | null; restricted: boolean }> {
  const result = await call<{ data?: string | null; restricted?: boolean }>({ route: "download-url", modId, fileId });
  const url = typeof result.data === "string" && result.data ? result.data : null;
  return { url, restricted: result.restricted === true || !url };
}

function normalizePage<T>(result: { data?: T[]; pagination?: CfPagination }): CfPage<T> {
  const data = Array.isArray(result.data) ? result.data : [];
  const pagination = result.pagination ?? { index: 0, pageSize: data.length, resultCount: data.length, totalCount: data.length };
  return { data, pagination };
}

export function cfSha1(file: Pick<CfFile, "hashes">): string | undefined {
  return file.hashes?.find((hash) => hash.algo === 1)?.value?.toLowerCase();
}

export function cfModUrl(mod: Pick<CfMod, "links" | "slug" | "classId">, gameSlug?: string): string {
  return mod.links?.websiteUrl || (gameSlug && mod.slug ? `${CF_SITE}/${gameSlug}/mods/${mod.slug}` : CF_SITE);
}

/** Every game CurseForge lists, fetched page by page. Kept only in memory for the running session. */
let allGames: { at: number; promise: Promise<CfGame[]> } | null = null;
export function cfAllGames(): Promise<CfGame[]> {
  if (allGames && Date.now() - allGames.at < 10 * 60_000) return allGames.promise;
  const promise = (async () => {
    const games: CfGame[] = [];
    for (let index = 0; index < 400; index += 50) {
      const page = await cfGames(index, 50);
      games.push(...page.data.filter(isPublicCurseforgeGame));
      if (index + 50 >= page.pagination.totalCount || page.data.length === 0) break;
    }
    return games;
  })();
  allGames = { at: Date.now(), promise };
  promise.catch(() => { if (allGames?.promise === promise) allGames = null; });
  return promise;
}
