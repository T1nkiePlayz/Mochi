// Real Modrinth / CurseForge calls for linked modpacks. CurseForge answers stay in memory (terms): only ids are saved on the Tofu.
import { CF_CLASS, CF_LOADER, CF_MINECRAFT_ID, cfFiles, cfMod, cfSearch, type CfFile } from "../curseforge";
import { getModrinthProjectInfo, getModrinthVersions, searchDiscover, type ModrinthVersion } from "../modrinth";
import type { Tofu, TofuPack } from "../../models";
import { tofuTarget } from "./compat";
import { releaseOf } from "./gameVersion";
import { limitedApi, pickPackUpdate, type PackApi, type PackUpdate, type PackVersion } from "./packMatch";

const CF_LOADER_CODE: Record<string, number> = { forge: CF_LOADER.forge, fabric: CF_LOADER.fabric, quilt: CF_LOADER.quilt, neoforge: CF_LOADER.neoForge };
const CF_CODE_LOADER = Object.fromEntries(Object.entries(CF_LOADER_CODE).map(([name, code]) => [code, name]));
const CF_RELEASE = { 1: "release", 2: "beta", 3: "alpha" } as const;

export const modrinthVersion = (version: ModrinthVersion): PackVersion => ({ id: version.id, name: version.name, number: version.version_number, date: version.date_published, channel: version.version_type });
export const curseforgeVersion = (file: CfFile): PackVersion => ({ id: String(file.id), name: file.displayName, date: file.fileDate, channel: CF_RELEASE[file.releaseType as 1 | 2 | 3] ?? "release" });

/** The live API behind the matcher (not throttled: wrap with `limitedApi`). */
export const rawPackApi: PackApi = {
  async searchModrinth(query, gameVersion) {
    const page = await searchDiscover({ projectType: "modpack", gameVersion, query, sort: "relevance", limit: 10 });
    return page.hits.map((hit) => ({ projectId: hit.project_id, title: hit.title, gameVersions: hit.versions, loaders: hit.categories }));
  },
  async modrinthVersions(projectId, gameVersion, loader) { return (await getModrinthVersions(projectId, gameVersion, loader)).map(modrinthVersion); },
  async searchCurseforge(query, gameVersion, loader) {
    const code = CF_LOADER_CODE[loader];
    if (!code) return [];
    const page = await cfSearch({ gameId: CF_MINECRAFT_ID, classId: CF_CLASS.modpacks, searchFilter: query, gameVersion, modLoaderType: code, pageSize: 10 });
    return page.data.map((mod) => ({
      projectId: String(mod.id), title: mod.name,
      gameVersions: [...new Set((mod.latestFilesIndexes ?? []).map((index) => index.gameVersion).filter((value): value is string => Boolean(value)))],
      loaders: [...new Set((mod.latestFilesIndexes ?? []).map((index) => CF_CODE_LOADER[index.modLoader ?? -1]).filter(Boolean))],
    }));
  },
};

/** The throttled API the app uses: at most two requests at once, across every instance. */
export const packApi: PackApi = limitedApi(rawPackApi);

/** What to show for a linked pack. `iconUrl`/`description` of a CurseForge pack are never saved. */
export type LinkedPackInfo = { name: string; iconUrl?: string; description?: string; pageUrl: string; update?: PackUpdate };

/** Modrinth keeps its cache on disk through the app; CurseForge answers live in this map for the session only. */
const cfLive = new Map<string, { at: number; promise: Promise<LinkedPackInfo> }>();
const CF_LIVE_MS = 10 * 60_000;

export async function loadLinkedPack(tofu: Pick<Tofu, "version" | "loader" | "name" | "runtime">, pack: TofuPack): Promise<LinkedPackInfo> {
  const target = tofuTarget(tofu);
  const gameVersion = releaseOf(tofu) ?? target.gameVersion;
  const loader = target.loader && target.loader !== "vanilla" ? target.loader : undefined;
  if (pack.source === "modrinth") {
    const project = await getModrinthProjectInfo(pack.projectId);
    let update: PackUpdate | undefined;
    if (pack.versionId && gameVersion && loader) {
      try { update = pickPackUpdate(pack.versionId, (await getModrinthVersions(pack.projectId, gameVersion, loader)).map(modrinthVersion)); } catch { /* shown without the update hint */ }
    }
    return { name: project.title, iconUrl: project.icon_url, description: project.description, pageUrl: `https://modrinth.com/modpack/${project.slug || pack.projectId}`, update };
  }
  const key = `${pack.projectId}:${pack.versionId ?? ""}:${gameVersion ?? ""}:${loader ?? ""}`;
  const known = cfLive.get(key);
  if (known && Date.now() - known.at < CF_LIVE_MS) return known.promise;
  const promise = (async () => {
    const mod = await cfMod(Number(pack.projectId));
    let update: PackUpdate | undefined;
    if (pack.versionId && gameVersion && loader && CF_LOADER_CODE[loader]) {
      try { update = pickPackUpdate(pack.versionId, (await cfFiles(mod.id, { gameVersion, modLoaderType: CF_LOADER_CODE[loader], pageSize: 50 })).data.map(curseforgeVersion)); } catch { /* shown without the update hint */ }
    }
    return { name: mod.name, iconUrl: mod.logo?.thumbnailUrl || mod.logo?.url, description: mod.summary, pageUrl: mod.links?.websiteUrl || `https://www.curseforge.com/minecraft/modpacks/${mod.slug}`, update };
  })();
  cfLive.set(key, { at: Date.now(), promise });
  promise.catch(() => { if (cfLive.get(key)?.promise === promise) cfLive.delete(key); });
  return promise;
}
