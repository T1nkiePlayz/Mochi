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
async function get<T>(url: string): Promise<T> {
  return invoke<T>("get_public_api", { url });
}
export async function searchModrinth(query: string, projectType: ModrinthProjectType = "mod"): Promise<ModrinthProject[]> {
  const params = new URLSearchParams({ query: query.trim(), limit: "24", index: "relevance", facets: JSON.stringify([["project_type:" + projectType]]) });
  const result = await get<{ hits: ModrinthProject[] }>(API + "/search?" + params);
  return result.hits;
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

export async function getPopularModrinth(
  projectType: ModrinthProjectType,
  gameVersion?: string,
  sort: "downloads" | "follows" = "downloads",
  offset = 0,
): Promise<ModrinthProject[]> {
  const facets: string[][] = [["project_type:" + projectType]];
  if (gameVersion?.trim()) facets.push(["versions:" + gameVersion.trim()]);
  const params = new URLSearchParams({
    query: "",
    limit: "100",
    offset: String(Math.max(0, offset)),
    index: sort,
    facets: JSON.stringify(facets),
  });
  const result = await get<{ hits: ModrinthProject[] }>(API + "/search?" + params);
  return result.hits;
}
export async function getModrinthVersions(projectId: string, gameVersion?: string, loader?: string): Promise<ModrinthVersion[]> {
  const all: ModrinthVersion[] = [];
  let offset = 0;
  const limit = 100;
  while (true) {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (gameVersion) params.set("game_versions", JSON.stringify([gameVersion]));
    if (loader) params.set("loaders", JSON.stringify([loader]));
    const page = await get<ModrinthVersion[]>(API + "/project/" + encodeURIComponent(projectId) + "/version?" + params);
    all.push(...page);
    if (page.length < limit) break;
    offset += limit;
  }
  return all;
}

export async function getModrinthGameVersions(): Promise<string[]> {
  const versions = await get<Array<{ version: string; version_type: string }>>(API + "/tag/game_version");
  return versions.map(item => item.version);
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

export async function getDownloads(): Promise<Array<{
  id: string;
  tofuId: string;
  tofuName: string;
  itemName: string;
  filename: string;
  downloaded: number;
  total?: number;
  status: "downloading" | "completed" | "failed";
  error?: string;
  createdAt: number;
  finishedAt?: number;
}>> {
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

export type ModUpdate = { versionId: string; versionNumber: string; filename: string; url: string; size: number };
export type ModAnalysis = {
  filename: string; path: string; enabled: boolean; projectId: string; title: string;
  iconUrl?: string; currentVersion: string; update?: ModUpdate;
};
export async function analyzeModFiles(path: string, gameVersion?: string, loader?: string): Promise<ModAnalysis[]> {
  return invoke<ModAnalysis[]>("analyze_mod_files", { path, gameVersion: gameVersion || null, loader: loader || null });
}
export async function updateModFile(path: string, update: ModUpdate): Promise<void> {
  await invoke("update_mod_file", { path, url: update.url, filename: update.filename });
}
