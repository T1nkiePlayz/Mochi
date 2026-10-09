// Matches a Minecraft instance to a Modrinth / CurseForge modpack. Pure logic over an injected API so it can be tested without a network.
// A wrong match is worse than none: only an exact (normalized) title with a pack version for the same game version and loader is accepted.
import type { TofuPack } from "../../models";
import type { MinecraftPackHint } from "../sources";
import { createLimiter } from "./limit";

/** The slices of Modrinth / CurseForge answers the matcher reads. */
export type PackHit = { projectId: string; title: string; gameVersions?: string[]; loaders?: string[] };
export type PackVersion = { id: string; name: string; number?: string; date?: string; channel?: "release" | "beta" | "alpha" };

export type PackApi = {
  /** Modrinth modpack search by text, narrowed to a game version. */
  searchModrinth(query: string, gameVersion: string): Promise<PackHit[]>;
  /** Modrinth pack versions for a game version and loader (newest first or not: callers sort). */
  modrinthVersions(projectId: string, gameVersion: string, loader: string): Promise<PackVersion[]>;
  /** CurseForge modpack search; hits list the game versions and loaders they have files for. */
  searchCurseforge(query: string, gameVersion: string, loader: string): Promise<PackHit[]>;
};

export type PackTarget = { name: string; gameVersion?: string; loader?: string };
export type PackSources = { modrinth: boolean; curseforge: boolean };

/** Lowercase letters and digits only, diacritics folded: "Better MC [FABRIC]" and "better-mc fabric" compare equal. */
export const normalizeTitle = (value: string) => value.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** The names an instance may go by: its own, and without a trailing game version or loader that it was labelled with. */
export function candidateNames(target: PackTarget): string[] {
  const names = new Set<string>();
  const base = normalizeTitle(target.name);
  if (!base) return [];
  names.add(base);
  for (const tail of [target.gameVersion, target.loader].map((value) => normalizeTitle(value ?? "")).filter(Boolean)) {
    if (base.endsWith(" " + tail) && base.length > tail.length + 1) names.add(base.slice(0, -tail.length - 1).trim());
  }
  return [...names];
}

const loaderMatches = (hit: PackHit, loader: string) => !hit.loaders || hit.loaders.some((value) => value.toLowerCase() === loader);

/** The one hit that is confidently the instance's pack, or undefined (no exact title, or two equally good ones). */
export function confidentHit(hits: readonly PackHit[], target: PackTarget): PackHit | undefined {
  if (!target.gameVersion || !target.loader || target.loader === "vanilla") return undefined;
  const names = candidateNames(target);
  const exact = hits.filter((hit) => names.includes(normalizeTitle(hit.title)) && hit.gameVersions?.includes(target.gameVersion!) && loaderMatches(hit, target.loader!));
  const ids = new Set(exact.map((hit) => hit.projectId));
  return ids.size === 1 ? exact[0] : undefined;
}

/** The installed version among a pack's versions, from the launcher's version number text. */
export const versionByNumber = (versions: readonly PackVersion[], text: string | null | undefined) =>
  text ? versions.find((version) => version.number === text || version.name === text)?.id : undefined;

async function matchModrinth(api: PackApi, target: PackTarget, versionText?: string | null): Promise<Pick<TofuPack, "projectId" | "versionId"> | undefined> {
  const names = candidateNames(target);
  if (!names.length || !target.gameVersion) return undefined;
  const hit = confidentHit(await api.searchModrinth(target.name, target.gameVersion), target);
  if (!hit) return undefined;
  const versions = await api.modrinthVersions(hit.projectId, target.gameVersion, target.loader!);
  if (!versions.length) return undefined;
  const versionId = versionByNumber(versions, versionText);
  return { projectId: hit.projectId, ...(versionId ? { versionId } : {}) };
}

async function matchCurseforge(api: PackApi, target: PackTarget): Promise<Pick<TofuPack, "projectId"> | undefined> {
  if (!target.gameVersion || !target.loader || target.loader === "vanilla" || !candidateNames(target).length) return undefined;
  const hit = confidentHit(await api.searchCurseforge(target.name, target.gameVersion, target.loader), target);
  return hit ? { projectId: hit.projectId } : undefined;
}

/**
 * Finds the pack of an instance, most reliable evidence first: the launcher's own record, a pack manifest in the instance, then
 * the instance's name (Modrinth, then CurseForge). Returns null when nothing is confident. Never throws on API errors:
 * a failing source counts as "no match" and `failed` tells the caller to try again later instead of remembering "no pack".
 */
export async function matchInstancePack(api: PackApi, instance: PackTarget, hint: MinecraftPackHint | null | undefined, sources: PackSources): Promise<{ pack: TofuPack | null; failed: boolean }> {
  if (hint?.pack?.projectId) {
    const { source, projectId, versionId } = hint.pack;
    return { pack: { source, projectId, ...(versionId ? { versionId } : {}), matchedBy: "managed" }, failed: false };
  }
  let failed = false;
  const attempt = async <T,>(task: () => Promise<T>): Promise<T | undefined> => { try { return await task(); } catch { failed = true; return undefined; } };
  const named: Array<{ target: PackTarget; matchedBy: "index" | "search"; source?: "modrinth" | "curseforge"; version?: string | null }> = [];
  if (hint?.index?.name) named.push({ target: { ...instance, name: hint.index.name }, matchedBy: "index", source: hint.index.source, version: hint.index.version });
  named.push({ target: instance, matchedBy: "search" });
  for (const { target, matchedBy, source, version } of named) {
    const order: Array<"modrinth" | "curseforge"> = source === "curseforge" ? ["curseforge", "modrinth"] : ["modrinth", "curseforge"];
    for (const which of order.filter((item) => sources[item])) {
      const found = which === "modrinth" ? await attempt(() => matchModrinth(api, target, version)) : await attempt(() => matchCurseforge(api, target));
      if (found) return { pack: { source: which, matchedBy, ...found }, failed };
    }
  }
  return { pack: null, failed };
}

/** An update for a linked pack: a newer release of the same pack for the instance's game version and loader. */
export type PackUpdate = { versionId: string; versionName: string };

const stamp = (value: string | undefined) => (value ? Date.parse(value) || 0 : 0);

/**
 * The newest release newer than the installed one. Needs the installed version among the listed ones (same game version and loader)
 * to compare dates; without it nothing proves the candidate is newer, so there is no update.
 */
export function pickPackUpdate(installedId: string | undefined, versions: readonly PackVersion[]): PackUpdate | undefined {
  const installed = versions.find((version) => version.id === installedId);
  if (!installed || !stamp(installed.date)) return undefined;
  const newest = versions.filter((version) => (version.channel ?? "release") === "release" && stamp(version.date) > stamp(installed.date)).sort((a, b) => stamp(b.date) - stamp(a.date))[0];
  return newest ? { versionId: newest.id, versionName: newest.number || newest.name } : undefined;
}

/** Matching is spaced out: at most two requests in flight across every instance, so a big library never floods Modrinth or the proxy. */
export const packLimiter = createLimiter(2);

/** Wraps an API so that each call goes through the shared limiter. */
export function limitedApi(api: PackApi, limiter: Pick<typeof packLimiter, "run"> = packLimiter): PackApi {
  return {
    searchModrinth: (query, gameVersion) => limiter.run(() => api.searchModrinth(query, gameVersion)),
    modrinthVersions: (projectId, gameVersion, loader) => limiter.run(() => api.modrinthVersions(projectId, gameVersion, loader)),
    searchCurseforge: (query, gameVersion, loader) => limiter.run(() => api.searchCurseforge(query, gameVersion, loader)),
  };
}
