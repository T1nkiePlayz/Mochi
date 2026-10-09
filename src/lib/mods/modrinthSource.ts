import {
  getModrinthProject, getModrinthProjectInfo, getModrinthVersions, searchDiscover,
  type DiscoverSort, type ModrinthProject, type ModrinthProjectType, type ModrinthVersion,
} from "../modrinth";
import type { ModDetails, ModFile, ModItem, ModSearchOptions, ModSource } from "./types";

const kinds: Record<ModrinthProjectType, string> = { mod: "Mods", modpack: "Modpacks", resourcepack: "Resource Packs", shader: "Shaders" };
const sorts = [
  { value: "downloads", label: "Most downloaded" }, { value: "follows", label: "Most followed" }, { value: "relevance", label: "Best match" },
  { value: "newest", label: "Newest" }, { value: "updated", label: "Recently updated" },
];

export function modrinthItem(project: ModrinthProject): ModItem {
  return {
    source: "modrinth", id: project.project_id, name: project.title, summary: project.description, author: project.author, iconUrl: project.icon_url,
    downloads: project.downloads, pageUrl: `https://modrinth.com/${project.project_type}/${project.slug || project.project_id}`, kind: kinds[project.project_type], native: project,
  };
}

export function modrinthFile(version: ModrinthVersion): ModFile | null {
  const file = version.files.find((candidate) => candidate.primary) ?? version.files[0];
  if (!file) return null;
  return {
    id: version.id, name: version.name || version.version_number, fileName: file.filename, version: version.version_number, channel: version.version_type,
    size: file.size, date: version.date_published, gameVersions: version.game_versions, loaders: version.loaders, primary: version.featured,
    dependencies: version.dependencies.filter((dependency) => dependency.dependency_type === "required" && dependency.project_id)
      .map((dependency) => ({ id: dependency.project_id!, url: `https://modrinth.com/project/${dependency.project_id}`, required: true, ...(dependency.version_id ? { versionId: dependency.version_id } : {}) })),
    incompatibles: version.dependencies.filter((dependency) => dependency.dependency_type === "incompatible" && dependency.project_id)
      .map((dependency) => ({ id: dependency.project_id!, url: `https://modrinth.com/project/${dependency.project_id}`, required: false })),
    native: { url: file.url, sha1: file.hashes.sha1, size: file.size },
  };
}

/** The existing Modrinth client behind the common `ModSource` face. */
export function createModrinthSource(projectType: ModrinthProjectType): ModSource {
  return {
    id: "modrinth", label: "Modrinth", siteUrl: "https://modrinth.com", sorts, defaultSort: "downloads", searchesServerSide: true,
    async categories() { return []; },
    async search(options: ModSearchOptions) {
      const page = await searchDiscover({ projectType, gameVersion: options.gameVersion, loader: options.loader, query: options.query, sort: options.sort as DiscoverSort, offset: options.offset, limit: options.limit });
      const nextOffset = page.offset + page.hits.length;
      return { items: page.hits.map(modrinthItem), total: page.total, nextOffset, hasMore: page.hits.length > 0 && nextOffset < page.total };
    },
    async details(item): Promise<ModDetails> {
      const project = await getModrinthProject(item.id);
      return { body: { kind: "markdown", text: project.body || project.description }, facts: [{ label: "Downloads", value: (project.downloads ?? 0).toLocaleString() }] };
    },
    async files(item, filter) {
      const versions = await getModrinthVersions(item.id, filter?.gameVersion, projectType === "mod" ? filter?.loader : undefined);
      return versions.map(modrinthFile).filter((file): file is ModFile => file !== null);
    },
    async dependencyItem(dependency) { return modrinthItem(await getModrinthProjectInfo(dependency.id)); },
    async resolveDownload(item, file) {
      const native = file.native as { url: string; sha1?: string; size?: number };
      return { url: native.url, fileName: file.fileName, sha1: native.sha1, size: native.size, pageUrl: item.pageUrl };
    },
  };
}
