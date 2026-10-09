import { invoke } from "@tauri-apps/api/core";

export type ModrinthProjectType = "mod" | "modpack" | "resourcepack" | "shader";
export type ModrinthTeamMember = {
  team_id: string;
  user: {
    id: string;
    username: string;
    name?: string | null;
    avatar_url: string;
    bio?: string;
  };
  role: string;
  permissions?: number;
  accepted?: boolean;
  ordering?: number;
};
export type ModrinthProjectDetails = ModrinthProject & {
  body?: string;
  published?: string;
  updated?: string;
  followers?: number;
  license?: { id?: string; name?: string; url?: string };
  issues_url?: string;
  source_url?: string;
  wiki_url?: string;
  discord_url?: string;
  donation_urls?: Array<{ id: string; platform: string; url: string }>;
  gallery?: Array<{ url: string; raw_url?: string; title?: string; description?: string }>;
  team?: string;
  author_id?: string;
  members?: ModrinthTeamMember[];
};
export type ModrinthProject = {
  project_id: string; slug: string; title: string; description: string; project_type: ModrinthProjectType;
  downloads: number; icon_url?: string; author?: string; latest_version?: string; categories?: string[]; loaders?: string[];
};
export type ModrinthDependency = { version_id?: string | null; project_id?: string | null; file_name?: string | null; dependency_type: "required" | "optional" | "incompatible" | "embedded"; };
export type ModrinthFile = { hashes: { sha1?: string; sha512?: string }; url: string; filename: string; primary: boolean; size: number; file_type?: string | null; };
export type ModrinthVersion = {
  id: string; project_id: string; name: string; version_number: string; game_versions: string[]; loaders: string[];
  featured: boolean; date_published: string; date_modified?: string; version_type?: "release" | "beta" | "alpha";
  changelog?: string | null; status?: string; dependencies: ModrinthDependency[]; files: ModrinthFile[];
};
export type InstalledModrinthFile = { filename: string; path: string; enabled: boolean; size: number; };

const API = "https://api.modrinth.com/v2";

/** What `get_public_api` returns: the payload plus where it came from. */
export type ApiResult<T> = { data: T; cached: boolean; stale: boolean; fetchedAt: number };

async function getResult<T>(url: string): Promise<ApiResult<T>> {
  try {
    return await invoke<ApiResult<T>>("get_public_api", { url });
  } catch (error) {
    throw new Error(typeof error === "string" ? error : error instanceof Error ? error.message : "Unable to reach Modrinth.");
  }
}
async function get<T>(url: string): Promise<T> {
  return (await getResult<T>(url)).data;
}

export async function searchModrinth(query: string, projectType: ModrinthProjectType = "mod"): Promise<ModrinthProject[]> {
  const params = new URLSearchParams({ query: query.trim(), limit: "24", index: "relevance", facets: JSON.stringify([["project_type:" + projectType]]) });
  const result = await get<{ hits: ModrinthProject[] }>(API + "/search?" + params);
  return Array.isArray(result.hits) ? result.hits : [];
}

export async function getModrinthProject(projectId: string): Promise<ModrinthProjectDetails> {
  const project = await get<ModrinthProjectDetails>(API + "/project/" + encodeURIComponent(projectId));
  try {
    const members = await get<ModrinthTeamMember[]>(API + "/project/" + encodeURIComponent(projectId) + "/members");
    return { ...project, members: members.sort((a, b) => (a.ordering ?? 0) - (b.ordering ?? 0)) };
  } catch {
    // Project details remain usable if the public members endpoint is unavailable.
  }
  return project;
}

export type DiscoverSort = "relevance" | "downloads" | "follows" | "newest" | "updated";
export type DiscoverQuery = {
  projectType: ModrinthProjectType;
  gameVersion?: string;
  loader?: string;
  query?: string;
  sort?: DiscoverSort;
  offset?: number;
  limit?: number;
};
export type DiscoverPage = { hits: ModrinthProject[]; total: number; offset: number; cached: boolean; stale: boolean; fetchedAt: number };

/** Facets are AND-ed across the outer array; every value is `field:value`. */
export function buildDiscoverFacets({ projectType, gameVersion, loader }: Pick<DiscoverQuery, "projectType" | "gameVersion" | "loader">): string[][] {
  const facets: string[][] = [["project_type:" + projectType]];
  if (gameVersion?.trim()) facets.push(["versions:" + gameVersion.trim()]);
  if (loader?.trim() && projectType === "mod") facets.push(["categories:" + loader.trim()]);
  return facets;
}

/** One page of Modrinth search results. Pages are small (default 30) and fetched on demand. */
export async function searchDiscover(query: DiscoverQuery): Promise<DiscoverPage> {
  const limit = Math.min(50, Math.max(1, query.limit ?? 30));
  const params = new URLSearchParams({
    query: (query.query ?? "").trim(),
    limit: String(limit),
    offset: String(Math.max(0, query.offset ?? 0)),
    index: query.sort ?? "downloads",
    facets: JSON.stringify(buildDiscoverFacets(query)),
  });
  const result = await getResult<{ hits?: ModrinthProject[]; total_hits?: number; offset?: number }>(API + "/search?" + params);
  const hits = Array.isArray(result.data.hits) ? result.data.hits : [];
  return { hits, total: result.data.total_hits ?? hits.length, offset: result.data.offset ?? query.offset ?? 0, cached: result.cached, stale: result.stale, fetchedAt: result.fetchedAt };
}

export async function getModrinthVersions(projectId: string, gameVersion?: string, loader?: string): Promise<ModrinthVersion[]> {
  const all: ModrinthVersion[] = [];
  let offset = 0;
  const limit = 100;
  // A misbehaving server that ignores `offset` and keeps returning full pages must not loop forever.
  for (let pages = 0; pages < 50; pages += 1) {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (gameVersion) params.set("game_versions", JSON.stringify([gameVersion]));
    if (loader) params.set("loaders", JSON.stringify([loader]));
    const page = await get<ModrinthVersion[]>(API + "/project/" + encodeURIComponent(projectId) + "/version?" + params);
    if (!Array.isArray(page)) break;
    all.push(...page);
    if (page.length < limit) break;
    offset += limit;
  }
  return all;
}

export type ModrinthGameVersion = { version: string; version_type: "release" | "snapshot" | "alpha" | "beta" | string; date: string; major: boolean };
export async function getModrinthGameVersionTags(): Promise<ApiResult<ModrinthGameVersion[]>> {
  return getResult<ModrinthGameVersion[]>(API + "/tag/game_version");
}
export async function getModrinthGameVersions(): Promise<string[]> {
  return (await getModrinthGameVersionTags()).data.map(item => item.version);
}
export async function listInstalledMods(path: string): Promise<InstalledModrinthFile[]> {
  return invoke<InstalledModrinthFile[]>("list_mod_files", { path });
}
export async function startModrinthDownload(
  url: string,
  path: string,
  tofuId: string,
  tofuName: string,
  itemName: string,
  filename: string,
): Promise<string> {
  return invoke<string>("start_modrinth_download", { url, path, tofuId, tofuName, itemName, filename });
}

export type DownloadEntry = {
  id: string;
  tofuId: string;
  tofuName: string;
  itemName: string;
  filename: string;
  downloaded: number;
  total?: number;
  status: "downloading" | "completed" | "failed" | "cancelled";
  error?: string;
  createdAt: number;
  finishedAt?: number;
  provider: "modrinth" | "curseforge" | "nexus";
  /** Folder the file lands in. */
  dir: string;
};

export async function getDownloads(): Promise<DownloadEntry[]> {
  return invoke("get_downloads");
}

export async function setModFileEnabled(path: string, enabled: boolean): Promise<void> {
  await invoke("set_mod_file_enabled", { path, enabled });
}
export async function deleteModFile(path: string): Promise<void> {
  await invoke("delete_mod_file", { path });
}
export async function applyModProfile(path: string, enabledFiles: string[]): Promise<void> {
  await invoke("apply_mod_profile", { path, enabledFiles });
}

export type ModUpdate = { versionId: string; versionNumber: string; filename: string; url: string; size: number; sha1?: string };
export type ModAnalysis = {
  filename: string; path: string; enabled: boolean; projectId: string; title: string;
  iconUrl?: string; currentVersion: string; update?: ModUpdate;
};
export async function analyzeModFiles(path: string, gameVersion?: string, loader?: string): Promise<ModAnalysis[]> {
  return invoke<ModAnalysis[]>("analyze_mod_files", { path, gameVersion: gameVersion || null, loader: loader || null });
}
export type UpdateExtras = { provider?: "modrinth" | "curseforge" | "nexus"; tofuId?: string; record?: import("./downloads").ModRecordInput };
/** Downloads the new file (SHA-1 checked), keeps the old one as a rollback copy, then replaces it. */
export async function updateModFile(path: string, update: Pick<ModUpdate, "url" | "filename" | "sha1"> & Partial<ModUpdate>, extras: UpdateExtras = {}): Promise<void> {
  await invoke("update_mod_file", { path, url: update.url, filename: update.filename, sha1: update.sha1 ?? null, provider: extras.provider ?? null, tofuId: extras.tofuId ?? null, record: extras.record ?? null });
}
