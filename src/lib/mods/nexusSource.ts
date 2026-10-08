import type { SupabaseClient } from "@supabase/supabase-js";
import { EdgeFunctionError } from "../functions";
import {
  getNexusDownload, getNexusFiles, getNexusModDetail, getNexusMods, getNexusStatus, nexusModId, nexusModPageUrl,
  type NexusMod, type NexusStatus,
} from "../nexus";
import type { ModDetails, ModFile, ModItem, ModPage, ModSearchOptions, ModSource } from "./types";

export type NexusScope = { domain: string; name: string };

const sorts = [{ value: "catalog", label: "All mods" }, { value: "trending", label: "Trending" }];
/** Nexus lists are capped at 500 entries per search so a text filter never scans without end. */
const SCAN_CAP = 500;

let statusPromise: { client: SupabaseClient; at: number; promise: Promise<NexusStatus> } | null = null;
/** The user's own Nexus membership; remembered in memory for a minute so each click does not re-validate the key. */
export function nexusStatus(client: SupabaseClient, force = false): Promise<NexusStatus> {
  if (!force && statusPromise && statusPromise.client === client && Date.now() - statusPromise.at < 60_000) return statusPromise.promise;
  const promise = getNexusStatus(client);
  statusPromise = { client, at: Date.now(), promise };
  promise.catch(() => { if (statusPromise?.promise === promise) statusPromise = null; });
  return promise;
}

export function nexusItem(mod: NexusMod, scope: NexusScope): ModItem {
  const modId = nexusModId(mod);
  return {
    source: "nexus", id: String(modId ?? mod.id), name: mod.name, summary: mod.summary ?? "", author: mod.author, iconUrl: mod.pictureUrl,
    pageUrl: mod.modPageUrl || (modId ? nexusModPageUrl(scope.domain, modId) : "https://www.nexusmods.com"), native: mod,
  };
}

/** Nexus descriptions mix HTML with BBCode; drop the BBCode markers so the text reads cleanly. */
export const stripBbcode = (text: string) => text.replace(/\[\/?(?:b|i|u|s|url|img|quote|code|list|size|color|font|center|line|spoiler|youtube|heading|\*)(?:=[^\]]*)?\]/gi, "").replace(/\r?\n/g, "<br>");

export function createNexusSource(client: SupabaseClient, scope: NexusScope): ModSource {
  const numericId = (item: ModItem) => { const id = Number(item.id); if (!Number.isSafeInteger(id) || id < 1) throw new Error("This Nexus mod has no usable id."); return id; };
  return {
    id: "nexus", label: "Nexus Mods", siteUrl: `https://www.nexusmods.com/${scope.domain}`, sorts, defaultSort: "catalog", searchesServerSide: false,
    async categories() { return []; },
    async search(options: ModSearchOptions): Promise<ModPage> {
      const sort = options.sort === "trending" ? "trending" : "catalog";
      const query = options.query.trim().toLowerCase();
      const matches = (mod: NexusMod) => !query || mod.name.toLowerCase().includes(query) || (mod.summary ?? "").toLowerCase().includes(query) || (mod.author ?? "").toLowerCase().includes(query);
      if (sort === "trending") {
        const page = await getNexusMods(client, scope.domain, { sort, offset: 0, limit: 100 });
        const items = page.mods.filter(matches).map((mod) => nexusItem(mod, scope));
        return { items, total: items.length, nextOffset: items.length, hasMore: false };
      }
      const found: ModItem[] = [];
      let offset = options.offset;
      let total = 0;
      let hasMore = true;
      while (hasMore && found.length < options.limit && offset < SCAN_CAP + options.offset) {
        const page = await getNexusMods(client, scope.domain, { sort, offset, limit: query ? 100 : Math.max(8, options.limit) });
        total = page.total;
        found.push(...page.mods.filter(matches).map((mod) => nexusItem(mod, scope)));
        offset += page.mods.length;
        hasMore = page.mods.length > 0 && offset < page.total;
        if (!query) break;
      }
      return { items: found, total: query ? Math.max(total, found.length) : total, nextOffset: offset, hasMore };
    },
    async details(item): Promise<ModDetails> {
      const detail = await getNexusModDetail(client, scope.domain, numericId(item));
      const facts = [
        ...(detail.author ? [{ label: "Author", value: detail.author }] : []),
        ...(detail.version ? [{ label: "Version", value: detail.version }] : []),
        ...(detail.endorsements != null ? [{ label: "Endorsements", value: detail.endorsements.toLocaleString() }] : []),
      ];
      const text = detail.description || detail.summary || "";
      return { body: text ? { kind: "html", text: stripBbcode(text) } : null, facts };
    },
    async files(item): Promise<ModFile[]> {
      const files = await getNexusFiles(client, scope.domain, numericId(item));
      const channelOf = (category?: string): ModFile["channel"] => /optional|misc|old/i.test(category ?? "") ? "beta" : "release";
      return files.map((file) => ({
        id: String(file.fileId), name: file.name || file.fileName, fileName: file.fileName, version: file.version, channel: channelOf(file.category),
        size: file.sizeKb ? Math.round(file.sizeKb * 1024) : undefined, date: file.uploadedAt, primary: file.primary, native: file,
      })).sort((a, b) => Number(b.primary === true) - Number(a.primary === true));
    },
    async resolveDownload(item, file) {
      const modId = numericId(item);
      const pageUrl = nexusModPageUrl(scope.domain, modId, true);
      const base = { fileName: file.fileName, size: file.size, pageUrl };
      const status = await nexusStatus(client).catch(() => null);
      if (!status?.premium) return { ...base, needsPremium: true, reason: "Direct downloads need Nexus Mods Premium. Download the file on Nexus instead." };
      try {
        const link = await getNexusDownload(client, scope.domain, modId, Number(file.id));
        return { ...base, url: link.url, fileName: link.fileName || file.fileName };
      } catch (error) {
        if (error instanceof EdgeFunctionError && error.code === "premium_required") return { ...base, needsPremium: true, reason: error.message };
        throw error;
      }
    },
  };
}
