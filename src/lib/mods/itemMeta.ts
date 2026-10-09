// Pure helpers: no runtime imports so they can be unit tested with plain `node --test` or vitest.
import { metaFromModFile, parseLoader, type ModVersionMeta } from "./compat.ts";

const CF_LOADER_IDS: Record<number, string> = { 1: "forge", 4: "fabric", 5: "quilt", 6: "neoforge" };

type Native = {
  // Modrinth search hit
  versions?: string[]; loaders?: string[]; categories?: Array<string | { name?: string }>;
  // CurseForge mod
  latestFiles?: Array<{ gameVersions?: string[] }>; latestFilesIndexes?: Array<{ gameVersion?: string; modLoader?: number }>;
};

/**
 * What a listed mod says it supports, before any file is chosen, so the Tofu picker can badge instances. One entry per
 * newest file; `[]` means the list does not say. Resource packs and shaders name no loader and so fit every Tofu by loader.
 */
export function metasOfItem(item: { source: string; native: unknown }): ModVersionMeta[] {
  const native = (item.native ?? {}) as Native;
  if (item.source === "modrinth") {
    const loaders = (native.loaders ?? native.categories?.map((entry) => typeof entry === "string" ? entry : entry.name ?? "") ?? []).filter((name) => parseLoader(name) !== undefined);
    return native.versions?.length || loaders.length ? [{ gameVersions: native.versions ?? [], loaders }] : [];
  }
  if (item.source === "curseforge") {
    const files = (native.latestFiles ?? []).map((file) => metaFromModFile({ gameVersions: file.gameVersions })).filter((meta) => meta.gameVersions?.length || meta.loaders?.length);
    if (files.length) return files;
    const indexes = native.latestFilesIndexes ?? [];
    return indexes.length ? indexes.map((entry) => ({ gameVersions: entry.gameVersion ? [entry.gameVersion] : [], loaders: entry.modLoader && CF_LOADER_IDS[entry.modLoader] ? [CF_LOADER_IDS[entry.modLoader]] : [] })) : [];
  }
  return [];
}
