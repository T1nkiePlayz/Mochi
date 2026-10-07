import { invoke } from "@tauri-apps/api/core";

export type ModrinthProjectType = "mod" | "modpack" | "resourcepack" | "shader";
export type ModrinthProject = {
  project_id: string; slug: string; title: string; description: string; project_type: ModrinthProjectType;
  downloads: number; icon_url?: string; author?: string; latest_version?: string; categories?: string[]; loaders?: string[];
};
export type ModrinthDependency = { version_id?: string | null; project_id?: string | null; file_name?: string | null; dependency_type: "required" | "optional" | "incompatible" | "embedded"; };
export type ModrinthFile = { hashes: { sha1?: string; sha512?: string }; url: string; filename: string; primary: boolean; size: number; file_type?: string | null; };
export type ModrinthVersion = {
  id: string; project_id: string; name: string; version_number: string; game_versions: string[]; loaders: string[];
  featured: boolean; date_published: string; dependencies: ModrinthDependency[]; files: ModrinthFile[];
};
export type InstalledModrinthFile = { filename: string; path: string; enabled: boolean; size: number; };

const API = "https://api.modrinth.com/v2";
async function get<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("Modrinth request failed (" + response.status + ")");
  return response.json() as Promise<T>;
}
export async function searchModrinth(query: string, projectType: ModrinthProjectType = "mod"): Promise<ModrinthProject[]> {
  const params = new URLSearchParams({ query: query.trim(), limit: "24", index: "relevance", facets: JSON.stringify([["project_type:" + projectType]]) });
  const result = await get<{ hits: ModrinthProject[] }>(API + "/search?" + params);
  return result.hits;
}

export async function getPopularModrinth(projectType: ModrinthProjectType, gameVersion?: string): Promise<ModrinthProject[]> {
  const facets: string[][] = [["project_type:" + projectType]];
  if (gameVersion?.trim()) facets.push(["versions:" + gameVersion.trim()]);
  const params = new URLSearchParams({
    query: "",
    limit: "12",
    index: "downloads",
    facets: JSON.stringify(facets),
  });
  const result = await get<{ hits: ModrinthProject[] }>(API + "/search?" + params);
  return result.hits;
}
export async function getModrinthVersions(projectId: string, gameVersion?: string, loader?: string): Promise<ModrinthVersion[]> {
  const params = new URLSearchParams({ limit: "100" });
  if (gameVersion) params.set("game_versions", JSON.stringify([gameVersion]));
  if (loader) params.set("loaders", JSON.stringify([loader]));
  return get<ModrinthVersion[]>(API + "/project/" + encodeURIComponent(projectId) + "/version?" + params);
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

export async function downloadModrinthFile(url: string, path: string): Promise<void> {
  await invoke("download_modrinth_file", { url, path });
}
export async function setModFileEnabled(path: string, enabled: boolean): Promise<void> {
  await invoke("set_mod_file_enabled", { path, enabled });
}
export async function deleteModFile(path: string): Promise<void> {
  await invoke("delete_mod_file", { path });
}
