import {
  CF_CLASS, CF_LOADER, CF_MINECRAFT_ID, CF_SORT, cfCategories, cfDescription, cfDownloadUrl, cfFiles, cfMod, cfModUrl, cfSearch, cfSha1, CF_SITE,
  type CfFile, type CfMod,
} from "../curseforge";
import { RESTRICTED_MESSAGE, restrictedReason } from "./helpers";
import type { ModCategory, ModDetails, ModFile, ModItem, ModSearchOptions, ModSource } from "./types";

export type CurseforgeScope = { gameId: number; gameSlug?: string; classId?: number; kind?: string };

const loaderIds: Record<string, number> = { forge: CF_LOADER.forge, fabric: CF_LOADER.fabric, quilt: CF_LOADER.quilt, neoforge: CF_LOADER.neoForge };
/** CurseForge `relationType` values of a file's dependencies. */
export const CF_RELATION = { embedded: 1, optional: 2, required: 3, tool: 4, incompatible: 5, include: 6 } as const;
/** Minecraft class ids to the kind label that decides the install folder. */
const minecraftKinds: Record<number, string> = { [CF_CLASS.mods]: "Mods", [CF_CLASS.resourcePacks]: "Resource Packs", [CF_CLASS.shaders]: "Shaders" };
const channels = ["release", "beta", "alpha"] as const;

export function curseforgeItem(mod: CfMod, scope: CurseforgeScope): ModItem {
  return {
    source: "curseforge", id: String(mod.id), name: mod.name, summary: mod.summary ?? "", author: mod.authors?.[0]?.name,
    iconUrl: mod.logo?.thumbnailUrl || mod.logo?.url, downloads: mod.downloadCount, pageUrl: cfModUrl(mod, scope.gameSlug), kind: scope.kind, native: mod,
  };
}

const modOf = (item: ModItem) => item.native as CfMod;

export function curseforgeFile(file: CfFile, mod: CfMod): ModFile {
  // relationType: 3 required, 5 incompatible. Embedded (1), optional (2), tool (4) and include (6) are never installed.
  const required = (file.dependencies ?? []).filter((dependency) => dependency.relationType === CF_RELATION.required);
  const incompatible = (file.dependencies ?? []).filter((dependency) => dependency.relationType === CF_RELATION.incompatible);
  return {
    id: String(file.id), name: file.displayName || file.fileName, fileName: file.fileName, version: file.displayName,
    channel: channels[(file.releaseType ?? 1) - 1], size: file.fileLength, date: file.fileDate, gameVersions: file.gameVersions,
    dependencies: required.map((dependency) => ({ id: String(dependency.modId), url: `${CF_SITE}/projects/${dependency.modId}`, required: true })),
    incompatibles: incompatible.map((dependency) => ({ id: String(dependency.modId), url: `${CF_SITE}/projects/${dependency.modId}`, required: false })),
    native: { file, mod },
  };
}

export function createCurseforgeSource(scope: CurseforgeScope): ModSource {
  const sorts = [
    { value: String(CF_SORT.popularity), label: "Popular" }, { value: String(CF_SORT.totalDownloads), label: "Most downloaded" },
    { value: String(CF_SORT.lastUpdated), label: "Recently updated" }, { value: String(CF_SORT.releasedDate), label: "Newest" },
    { value: String(CF_SORT.featured), label: "Featured" }, { value: String(CF_SORT.name), label: "Name (A-Z)" },
  ];
  return {
    id: "curseforge", label: "CurseForge", siteUrl: CF_SITE, sorts, defaultSort: sorts[0].value, searchesServerSide: true,
    async categories(): Promise<ModCategory[]> {
      const list = await cfCategories(scope.gameId, scope.classId);
      return list.filter((category) => !category.isClass && category.id !== scope.classId)
        .map((category) => ({ id: String(category.id), name: category.name, parentId: category.parentCategoryId && category.parentCategoryId !== scope.classId ? String(category.parentCategoryId) : undefined }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    async search(options: ModSearchOptions) {
      const sortField = Number(options.sort) || CF_SORT.popularity;
      const page = await cfSearch({
        gameId: scope.gameId, classId: scope.classId, categoryId: options.categoryId ? Number(options.categoryId) : undefined,
        gameVersion: options.gameVersion, modLoaderType: options.loader ? loaderIds[options.loader] : undefined, searchFilter: options.query,
        sortField, sortOrder: sortField === CF_SORT.name ? "asc" : "desc", index: options.offset, pageSize: options.limit,
      });
      const nextOffset = page.pagination.index + page.data.length;
      // CurseForge refuses to page past 10,000 results.
      const cap = Math.min(page.pagination.totalCount, 10_000);
      return { items: page.data.map((mod) => curseforgeItem(mod, scope)), total: page.pagination.totalCount, nextOffset, hasMore: page.data.length > 0 && nextOffset < cap };
    },
    async details(item): Promise<ModDetails> {
      const mod = modOf(item);
      const [html, full] = await Promise.all([cfDescription(mod.id).catch(() => ""), cfMod(mod.id).catch(() => mod)]);
      const facts = [
        { label: "Downloads", value: (full.downloadCount ?? 0).toLocaleString() },
        ...(full.categories?.length ? [{ label: "Categories", value: full.categories.map((category) => category.name).join(", ") }] : []),
        ...(full.authors?.length ? [{ label: "Authors", value: full.authors.map((author) => author.name).join(", ") }] : []),
        ...(full.dateModified ? [{ label: "Updated", value: new Date(full.dateModified).toLocaleDateString() }] : []),
        ...(full.allowModDistribution === false ? [{ label: "Distribution", value: "Downloads only on CurseForge" }] : []),
      ];
      return { body: html ? { kind: "html", text: html } : full.summary ? { kind: "markdown", text: full.summary } : null, facts };
    },
    async files(item, filter) {
      const mod = modOf(item);
      const page = await cfFiles(mod.id, { gameVersion: filter?.gameVersion, modLoaderType: filter?.loader ? loaderIds[filter.loader] : undefined, pageSize: 30 });
      return page.data.filter((file) => file.isAvailable !== false).map((file) => curseforgeFile(file, mod));
    },
    async dependencyItem(dependency) {
      const mod = await cfMod(Number(dependency.id));
      return curseforgeItem(mod, { ...scope, kind: (scope.gameId === CF_MINECRAFT_ID && mod.classId ? minecraftKinds[mod.classId] : undefined) ?? scope.kind });
    },
    async resolveDownload(_item, modFile) {
      const { file, mod } = modFile.native as { file: CfFile; mod: CfMod };
      const pageUrl = cfModUrl(mod, scope.gameSlug);
      const base = { fileName: file.fileName, sha1: cfSha1(file), size: file.fileLength, pageUrl };
      if (mod.allowModDistribution === false) return { ...base, restricted: true, reason: RESTRICTED_MESSAGE };
      let url = file.downloadUrl ?? null;
      if (!url) url = (await cfDownloadUrl(mod.id, file.id)).url;
      const reason = restrictedReason(mod, { downloadUrl: url });
      return reason || !url ? { ...base, restricted: true, reason: reason ?? RESTRICTED_MESSAGE } : { ...base, url };
    },
  };
}
