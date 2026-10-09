import { cfMod } from "../curseforge";
import { isOnline } from "../offline";
import { analyzeModFiles, updateModFile } from "../modrinth";
import { nexusModPageUrl } from "../nexus";
import { supabase } from "../supabase";
import type { Piko, Tofu } from "../../models";
import { tofuTarget, type TofuTarget } from "./compat";
import { createCurseforgeSource, curseforgeItem } from "./curseforgeSource";
import { modSupportOf } from "./gameSupport";
import { listInstanceMods } from "./instances";
import { createNexusSource } from "./nexusSource";
import type { ModSourceSettings } from "./resolveSources";
import type { ModItem } from "./types";
import { pickUpdate, type ModUpdateItem, type UpdateCheck } from "./updates";

const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : typeof error === "string" ? error : fallback);

/** Runs `worker` over `items`, at most `limit` at a time. */
async function pool<T>(items: readonly T[], limit: number, worker: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const item = items[next]; next += 1; await worker(item); }
  }));
}

/**
 * Looks for newer versions of the mods in a Tofu's main mod folder. Modrinth identifies files by hash (works for any jar);
 * CurseForge and Nexus use the file ids Mochi saved when it installed the file, so only those are checked there.
 * Never throws: problems become `notes`. Nothing is cached on disk (CurseForge terms), the caller keeps results in memory.
 */
export async function checkTofuUpdates(tofu: Tofu, piko: Piko | undefined, modSources: ModSourceSettings): Promise<UpdateCheck> {
  const notes: string[] = [];
  const items: ModUpdateItem[] = [];
  const done = (): UpdateCheck => ({ checkedAt: Date.now(), items, notes });
  if (!tofu.path) return done();
  if (!isOnline()) { notes.push("You are offline. Updates need an internet connection."); return done(); }
  const minecraft = piko ? modSupportOf(piko) === "minecraft" : false;
  // Loader and version narrow Minecraft updates; for other games a version like "1.2.3" says nothing about mod compatibility.
  const target: TofuTarget = minecraft ? tofuTarget(tofu) : {};
  let files;
  // Files only another Tofu on the same folder owns are not this Tofu's to update.
  const siblings = piko && piko.tofus.length > 1 ? piko.tofus.map((other) => other.id) : undefined;
  try { files = (await listInstanceMods(tofu.id, tofu.path, undefined, siblings)).filter((file) => !file.foreign); } catch (error) { notes.push(errorText(error, "Could not read the mod folder.")); return done(); }
  if (!files.length) return done();

  const identified = new Set<string>();
  if (modSources.modrinth && (minecraft || !piko)) {
    try {
      const mine = new Set(files.map((file) => file.path));
      for (const found of await analyzeModFiles(tofu.path, target.gameVersion, target.loader)) {
        if (!mine.has(found.path)) continue;
        identified.add(found.path);
        if (!found.update) continue;
        items.push({
          path: found.path, filename: found.filename, title: found.title, iconUrl: found.iconUrl, source: "modrinth", enabled: found.enabled,
          currentVersion: found.currentVersion, newVersion: found.update.versionNumber,
          record: { source: "modrinth", projectId: found.projectId, fileId: found.update.versionId, version: found.update.versionNumber, title: found.title, iconUrl: found.iconUrl },
          apply: { kind: "download", provider: "modrinth", url: found.update.url, filename: found.update.filename, sha1: found.update.sha1 },
        });
      }
    } catch (error) { notes.push(`Modrinth: ${errorText(error, "update check failed")}`); }
  }

  const tracked = files.filter((file) => file.record && !identified.has(file.path) && file.record.fileDate && (file.record.source === "curseforge" || file.record.source === "nexus"));
  await pool(tracked, 3, async (file) => {
    const record = file.record!;
    try {
      let item: ModItem;
      let source;
      if (record.source === "curseforge") {
        if (!modSources.curseforge) return;
        const mod = await cfMod(Number(record.projectId));
        const scope = { gameId: mod.gameId, gameSlug: piko?.modLinks?.curseforge?.slug };
        source = createCurseforgeSource(scope);
        item = curseforgeItem(mod, scope);
      } else {
        const links = piko?.modLinks?.nexus;
        if (!modSources.nexus || !links || !supabase) return;
        source = createNexusSource(supabase, links);
        item = { source: "nexus", id: record.projectId, name: record.title, summary: "", pageUrl: nexusModPageUrl(links.domain, Number(record.projectId), true), native: {} };
      }
      const newest = pickUpdate({ fileId: record.fileId, fileDate: record.fileDate }, await source.files(item, { gameVersion: target.gameVersion, loader: target.loader }), target);
      if (!newest) return;
      const resolved = await source.resolveDownload(item, newest);
      items.push({
        path: file.path, filename: file.filename, title: record.title || item.name, iconUrl: record.iconUrl, source: record.source as "curseforge" | "nexus", enabled: file.enabled,
        currentVersion: record.version || file.filename, newVersion: newest.version ?? newest.name ?? newest.fileName,
        record: { source: record.source as "curseforge" | "nexus", projectId: record.projectId, fileId: newest.id, version: newest.version ?? newest.name, title: record.title, iconUrl: record.iconUrl, fileDate: newest.date },
        apply: resolved.url && !resolved.restricted && !resolved.needsPremium
          ? { kind: "download", provider: record.source as "curseforge" | "nexus", url: resolved.url, filename: resolved.fileName, sha1: resolved.sha1 }
          : { kind: "manual", pageUrl: resolved.pageUrl, reason: resolved.reason ?? "This file has to be downloaded on the site." },
      });
    } catch (error) {
      notes.push(`${record.title || file.filename}: ${errorText(error, "update check failed")}`);
    }
  });
  items.sort((a, b) => a.title.localeCompare(b.title));
  return done();
}

/** Installs one update: SHA-1 verified, the old file kept as a rollback copy, the Tofu's record updated. */
export async function applyModUpdate(tofu: Tofu, item: ModUpdateItem): Promise<void> {
  if (item.apply.kind !== "download") throw new Error(item.apply.reason);
  const { provider, url, filename, sha1 } = item.apply;
  await updateModFile(item.path, { url, filename, sha1 }, { provider, tofuId: tofu.id, record: { ...item.record, fileDate: item.record.fileDate } });
}
