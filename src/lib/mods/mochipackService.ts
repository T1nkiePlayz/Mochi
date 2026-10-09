// Glue between `.mochipack` files and the app: export from a Tofu, read a file, resolve each mod through its provider's source
// and queue the downloads through the normal verified pipeline (`startModDownload`: allow-listed hosts, SHA-1 check).
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { cfFiles, cfMod, CF_MINECRAFT_ID, CF_SITE } from "../curseforge";
import { startModDownload } from "../downloads";
import { getModrinthVersions } from "../modrinth";
import { nexusModPageUrl } from "../nexus";
import { supabase } from "../supabase";
import type { Piko, Tofu } from "../../models";
import { createCurseforgeSource, curseforgeFile, curseforgeItem } from "./curseforgeSource";
import { isMinecraftJava } from "./gameSupport";
import { hashModFiles, listInstanceMods, listInstanceRecords, type InstanceMod } from "./instances";
import { titleFromFile } from "./identify";
import { buildMochipack, type BuildResult, type ExportFile, type MochiPack, type PackFolder, type PackGame, type PackMod } from "./mochipack";
import { buildReport, downloadable, planImport, queueDownloads, splitInstalled, type ImportReport, type PlanItem } from "./mochipackPlan";
import { createModrinthSource, modrinthFile } from "./modrinthSource";
import { createNexusSource, nexusStatus } from "./nexusSource";
import type { ModSourceSettings } from "./resolveSources";
import { withSnapshot } from "./snapshots";
import { contentFolder, type ContentKind, type Subdir } from "./targets";
import type { ModItem, ResolvedDownload } from "./types";

const FOLDER_KIND: Record<PackFolder, ContentKind> = { mods: "mod", resourcepacks: "resourcepack", shaderpacks: "shader" };
const FOLDER_SUBDIR: Record<PackFolder, Subdir | undefined> = { mods: undefined, resourcepacks: "resourcepacks", shaderpacks: "shaderpacks" };

export const gameOf = (piko: Piko): PackGame => {
  const minecraft = isMinecraftJava(piko);
  return {
    name: piko.name, pikoId: piko.id, ...(minecraft ? { minecraft: true, cfGameId: CF_MINECRAFT_ID } : { minecraft: false, ...(piko.modLinks?.curseforge ? { cfGameId: piko.modLinks.curseforge.gameId } : {}) }),
    ...(piko.modLinks?.nexus ? { nexusDomain: piko.modLinks.nexus.domain } : {}),
  };
};

/** Every file of the Tofu (mods, plus resource and shader packs for Minecraft) with the folder it lives in. */
export async function listTofuFiles(piko: Piko, tofu: Tofu): Promise<Array<{ folder: PackFolder; file: InstanceMod }>> {
  if (!tofu.path) return [];
  const siblings = piko.tofus.map((other) => other.id);
  const lanes: PackFolder[] = ["mods", ...(tofu.contentRoot ? (["resourcepacks", "shaderpacks"] as PackFolder[]) : [])];
  const out: Array<{ folder: PackFolder; file: InstanceMod }> = [];
  for (const folder of lanes) {
    const base = (folder === "mods" ? undefined : contentFolder(tofu, FOLDER_KIND[folder])?.path) ?? tofu.path;
    const files = await listInstanceMods(tofu.id, base, FOLDER_SUBDIR[folder], siblings).catch(() => []);
    for (const file of files) if (!file.foreign) out.push({ folder, file });
  }
  return out;
}

/** Files Mochi cannot match to a provider yet (the count behind "Identify unknown files first"). */
export const countUnidentified = (files: ReadonlyArray<{ file: InstanceMod }>) => files.filter(({ file }) => !file.record || file.record.source === "manual" || !file.record.projectId).length;

/** Builds the pack from the Tofu's records, hashing files that have no SHA-1 yet (hashes are read locally; nothing is uploaded). */
export async function exportTofuPack(piko: Piko, tofu: Tofu): Promise<BuildResult> {
  const files = await listTofuFiles(piko, tofu);
  const needHash = files.filter(({ file }) => !file.record?.sha1 && (!file.record || file.record.source === "manual" || !file.record.projectId || file.record.source !== "curseforge"));
  const hashes = needHash.length ? await hashModFiles(needHash.map(({ file }) => file.path)).catch(() => []) : [];
  const byPath = new Map(hashes.map((hash) => [hash.path, hash.sha1]));
  const exportFiles: ExportFile[] = files.map(({ folder, file }) => ({
    folder, filename: file.filename, enabled: file.enabled, sha1: file.record?.sha1 ?? byPath.get(file.path),
    record: file.record ? { source: file.record.source, projectId: file.record.projectId, fileId: file.record.fileId, sha1: file.record.sha1 } : undefined,
  }));
  return buildMochipack({ name: tofu.name, game: gameOf(piko), loader: tofu.loader, gameVersion: tofu.version, files: exportFiles });
}

const safeName = (name: string) => name.replace(/[^A-Za-z0-9._ -]+/g, "").trim().slice(0, 60) || "modpack";

/** Asks where to save and writes the pack. Resolves to the saved path, or null when cancelled. */
export async function savePackFile(text: string, name: string): Promise<string | null> {
  const destination = await save({ title: "Export modpack", defaultPath: `${safeName(name)}.mochipack`, filters: [{ name: "Mochi modpack", extensions: ["mochipack"] }] });
  if (!destination) return null;
  return invoke<string>("write_mochipack_file", { path: destination, content: text });
}

/** Asks for a pack file and returns its text, or null when cancelled. */
export async function pickPackFile(): Promise<string | null> {
  const selected = await open({ multiple: false, title: "Import modpack", filters: [{ name: "Mochi modpack", extensions: ["mochipack", "json"] }] });
  if (!selected || Array.isArray(selected)) return null;
  return invoke<string>("read_mochipack_file", { path: selected });
}

export type ResolveContext = { piko: Piko; sources: ModSourceSettings; nexusKey: boolean; pack: Pick<MochiPack, "game"> };

const placeholder = (source: "modrinth" | "curseforge" | "nexus", mod: PackMod, pageUrl: string): ModItem => ({ source, id: mod.projectId, name: titleFromFile(mod.fileName), summary: "", pageUrl, native: {} });

/** Where the user can get a file by hand; built from Mochi's own site constants and the validated ids, never from the pack's text. */
export function manualPageUrl(mod: PackMod, nexusDomain?: string): string {
  if (mod.provider === "modrinth") return `https://modrinth.com/project/${mod.projectId}`;
  if (mod.provider === "curseforge") return `${CF_SITE}/projects/${mod.projectId}`;
  return nexusDomain ? nexusModPageUrl(nexusDomain, Number(mod.projectId), true) : "https://www.nexusmods.com";
}
const manual = (mod: PackMod, reason: string, nexusDomain?: string): ResolvedDownload => ({ fileName: mod.fileName, needsPremium: true, reason, pageUrl: manualPageUrl(mod, nexusDomain) });

/** Looks the file up through its provider's source. Returns null when the provider has no such file; throws for lookups that cannot run. */
export async function resolvePackMod(mod: PackMod, ctx: ResolveContext): Promise<ResolvedDownload | null> {
  if (mod.provider === "modrinth") {
    if (!ctx.sources.modrinth) return manual(mod, "Modrinth is turned off in Settings. Download this file on the site.");
    const projectType = mod.folder === "resourcepacks" ? "resourcepack" : mod.folder === "shaderpacks" ? "shader" : "mod";
    const source = createModrinthSource(projectType);
    const item = placeholder("modrinth", mod, `https://modrinth.com/project/${mod.projectId}`);
    const version = (await getModrinthVersions(mod.projectId)).find((candidate) => candidate.id === mod.fileId);
    const file = version ? modrinthFile(version) : null;
    return file ? source.resolveDownload(item, file) : null;
  }
  if (mod.provider === "curseforge") {
    if (!ctx.sources.curseforge || !supabase) return manual(mod, "CurseForge is turned off or not available. Download this file on the site.");
    const record = await cfMod(Number(mod.projectId));
    const scope = { gameId: record.gameId, gameSlug: ctx.piko.modLinks?.curseforge?.slug };
    if (ctx.pack.game.cfGameId && record.gameId !== ctx.pack.game.cfGameId) throw new Error("This CurseForge project belongs to another game.");
    const source = createCurseforgeSource(scope);
    const item = curseforgeItem(record, scope);
    for (let index = 0; index < 150; index += 50) {
      const page = await cfFiles(record.id, { index, pageSize: 50 });
      const found = page.data.find((file) => String(file.id) === mod.fileId);
      if (found) return source.resolveDownload(item, curseforgeFile(found, record));
      if (page.data.length < 50) break;
    }
    return null;
  }
  const links = ctx.piko.modLinks?.nexus;
  const domain = links?.domain ?? ctx.pack.game.nexusDomain;
  if (!ctx.sources.nexus || !ctx.nexusKey || !supabase) return manual(mod, "Nexus Mods needs your API key in Settings. Download this file on the site.", domain);
  if (!links || (ctx.pack.game.nexusDomain && links.domain !== ctx.pack.game.nexusDomain)) return manual(mod, "This game is not linked to the pack's Nexus Mods game. Download this file on the site.", domain);
  const source = createNexusSource(supabase, links);
  const item: ModItem = { ...placeholder("nexus", mod, nexusModPageUrl(links.domain, Number(mod.projectId), true)), native: {} };
  const file = (await source.files(item)).find((candidate) => candidate.id === mod.fileId);
  if (!file) return null;
  await nexusStatus(supabase).catch(() => null);
  return source.resolveDownload(item, file);
}

export type ImportPlan = { items: PlanItem[]; alreadyInstalled: PackMod[] };

/** Looks up every mod of the pack that the Tofu does not have yet. Bounded concurrency; `signal.aborted` stops it. */
export async function buildImportPlan(pack: MochiPack, tofu: Tofu | null, ctx: ResolveContext, options: { signal?: { aborted: boolean }; onProgress?: (done: number, total: number) => void } = {}): Promise<ImportPlan> {
  const records = tofu ? await listInstanceRecords(tofu.id).catch(() => []) : [];
  const { todo, installed } = splitInstalled(pack.mods, records);
  const items = await planImport(todo, (mod) => resolvePackMod(mod, ctx), { concurrency: 4, ...options });
  return { items, alreadyInstalled: installed };
}

/** Queues the ready downloads into `tofu` (a snapshot is saved first). Everything goes through `startModDownload`, which re-checks hosts and SHA-1. */
export async function runImport(plan: ImportPlan, tofu: Tofu, pack: MochiPack, includeDisabled: boolean): Promise<ImportReport> {
  const chosen = downloadable(plan.items, includeDisabled);
  const start = async (item: PlanItem) => {
    if (item.availability.status !== "ready") return;
    const { mod, availability } = item;
    const folder = contentFolder(tofu, FOLDER_KIND[mod.folder]);
    if (!folder) throw new Error(mod.folder === "mods" ? "This Tofu does not have a folder yet." : "This Tofu has no folder for resource or shader packs.");
    await startModDownload({
      provider: mod.provider, url: availability.url, path: folder.path, subdir: folder.subdir, tofuId: tofu.id, tofuName: tofu.name, itemName: titleFromFile(mod.fileName),
      filename: availability.fileName, sha1: availability.sha1, extract: mod.folder === "mods" && tofu.extractArchives === true,
      record: { source: mod.provider, projectId: mod.projectId, fileId: mod.fileId, version: mod.fileName, title: titleFromFile(mod.fileName) },
    });
  };
  const { queued, failed } = chosen.length ? await withSnapshot(tofu, "Before importing a modpack", () => queueDownloads(chosen, start)) : { queued: 0, failed: [] };
  return buildReport(plan.items, queued, failed, pack.unknown.length);
}
