// Import planning for a `.mochipack`: which mods can be downloaded, which need the user, which are gone. Pure (the provider
// lookups are passed in), so it is unit tested without Tauri. Downloads only ever use what the provider resolution returns.
import type { ModLoader, Piko, Tofu } from "../../models";
import { modSupportOf } from "./gameSupport";
import type { MochiPack, PackMod } from "./mochipack";
import type { ResolvedDownload } from "./types";

export type Availability =
  | { status: "ready"; url: string; fileName: string; sha1?: string }
  /** The user has to download this one on the site (author restriction, no API key, Nexus without Premium). */
  | { status: "manual"; reason: string; pageUrl?: string }
  /** The provider no longer has that file, or the source is off or unreachable. */
  | { status: "unavailable"; reason: string }
  /** The provider's file is not the file in the pack (its SHA-1 differs): refused instead of installing something else. */
  | { status: "changed"; reason: string };
export type PlanItem = { mod: PackMod; availability: Availability };

/** Turns what a provider resolved for one file into an availability, checking the pack's SHA-1 when both sides have one. */
export function availabilityFromResolved(mod: PackMod, resolved: ResolvedDownload): Availability {
  if (resolved.restricted) return { status: "manual", reason: resolved.reason ?? "The author only allows downloads on the provider's site.", pageUrl: resolved.pageUrl };
  if (resolved.needsPremium || !resolved.url) return { status: "manual", reason: resolved.reason ?? "This file has to be downloaded on the site.", pageUrl: resolved.pageUrl };
  const expected = mod.sha1?.toLowerCase();
  const actual = resolved.sha1?.toLowerCase();
  if (expected && actual && expected !== actual) return { status: "changed", reason: "The file on the site is not the one in the pack (checksum differs)." };
  return { status: "ready", url: resolved.url, fileName: resolved.fileName || mod.fileName, sha1: expected ?? actual };
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : typeof error === "string" ? error : "lookup failed");

/**
 * Resolves every mod through `resolve` (which throws for lookup failures and returns null for "that file no longer exists"),
 * at most `concurrency` at a time. Never throws; a failed lookup is just that mod's "unavailable". Calls `onProgress` after each one.
 */
export async function planImport(
  mods: readonly PackMod[], resolve: (mod: PackMod) => Promise<ResolvedDownload | null>, options: { concurrency?: number; signal?: { aborted: boolean }; onProgress?: (done: number, total: number) => void } = {},
): Promise<PlanItem[]> {
  const items: PlanItem[] = new Array(mods.length);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < mods.length && !options.signal?.aborted) {
      const index = next; next += 1;
      const mod = mods[index];
      let availability: Availability;
      try {
        const resolved = await resolve(mod);
        availability = resolved ? availabilityFromResolved(mod, resolved) : { status: "unavailable", reason: "This file is no longer listed by the provider." };
      } catch (error) { availability = { status: "unavailable", reason: errorText(error) }; }
      items[index] = { mod, availability };
      done += 1;
      options.onProgress?.(done, mods.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, options.concurrency ?? 4), mods.length) }, worker));
  return items.filter(Boolean);
}

export type PlanSummary = { ready: number; manual: number; unavailable: number; changed: number; skippedDisabled: number };

/** What will be downloaded: ready mods, minus the ones switched off in the pack unless asked for. */
export function downloadable(items: readonly PlanItem[], includeDisabled: boolean): PlanItem[] {
  return items.filter((item) => item.availability.status === "ready" && (includeDisabled || item.mod.enabled));
}

export function summarizePlan(items: readonly PlanItem[], includeDisabled: boolean): PlanSummary {
  const summary: PlanSummary = { ready: 0, manual: 0, unavailable: 0, changed: 0, skippedDisabled: 0 };
  for (const item of items) {
    if (item.availability.status === "ready") { if (includeDisabled || item.mod.enabled) summary.ready += 1; else summary.skippedDisabled += 1; }
    else summary[item.availability.status] += 1;
  }
  return summary;
}

type GameRef = Pick<Piko, "name"> & Partial<Pick<Piko, "igdbId" | "modLinks" | "kind">>;

/** Does the pack belong to this game? Minecraft packs only fit Minecraft: Java; others must agree on the linked CurseForge game or Nexus domain. */
export function gameMismatch(pack: Pick<MochiPack, "game">, piko: GameRef): string | null {
  const minecraft = modSupportOf(piko) === "minecraft";
  if (pack.game.minecraft === true && !minecraft) return `This pack is for Minecraft, but ${piko.name} is not Minecraft: Java Edition.`;
  if (pack.game.minecraft === false && minecraft) return `This pack is for ${pack.game.name}, not Minecraft.`;
  if (!minecraft) {
    const cf = piko.modLinks?.curseforge?.gameId;
    const nexus = piko.modLinks?.nexus?.domain;
    if (pack.game.cfGameId && cf && pack.game.cfGameId !== cf) return `This pack is for ${pack.game.name} (a different CurseForge game than ${piko.name}).`;
    if (pack.game.nexusDomain && nexus && pack.game.nexusDomain !== nexus) return `This pack is for ${pack.game.name} (a different Nexus Mods game than ${piko.name}).`;
  }
  return null;
}

/** Soft warnings (never blocking): the pack's loader or game version differs from the Tofu it is installed into. */
export function compatibilityNotes(pack: Pick<MochiPack, "loader" | "gameVersion">, tofu: Pick<Tofu, "loader" | "version">, minecraft: boolean): string[] {
  if (!minecraft) return [];
  const notes: string[] = [];
  const loader = tofu.loader as ModLoader | undefined;
  if (pack.loader && loader && pack.loader !== loader) notes.push(`The pack is for ${pack.loader}, this Tofu uses ${loader}.`);
  if (pack.gameVersion && tofu.version && pack.gameVersion !== tofu.version) notes.push(`The pack is for ${pack.gameVersion}, this Tofu is on ${tofu.version}.`);
  return notes;
}

/** The report shown after the downloads were queued. */
export type ImportReport = { queued: number; manual: PlanItem[]; unavailable: PlanItem[]; changed: PlanItem[]; failed: Array<{ item: PlanItem; error: string }>; unknownFiles: number };

export function buildReport(items: readonly PlanItem[], queued: number, failed: ImportReport["failed"], unknownFiles: number): ImportReport {
  const pick = (status: Availability["status"]) => items.filter((item) => item.availability.status === status);
  return { queued, manual: pick("manual"), unavailable: pick("unavailable"), changed: pick("changed"), failed, unknownFiles };
}

/** Splits the pack's mods into those Mochi still has to look up and those the Tofu already has (same provider, project and file). */
export function splitInstalled(mods: readonly PackMod[], records: ReadonlyArray<{ source: string; projectId: string; fileId: string }>): { todo: PackMod[]; installed: PackMod[] } {
  const have = new Set(records.map((record) => `${record.source}:${record.projectId}:${record.fileId}`));
  const todo: PackMod[] = [];
  const installed: PackMod[] = [];
  for (const mod of mods) (have.has(`${mod.provider}:${mod.projectId}:${mod.fileId}`) ? installed : todo).push(mod);
  return { todo, installed };
}

/** Starts each download with `start` (at most `concurrency` at a time); a failing start is collected, it never stops the others. */
export async function queueDownloads(items: readonly PlanItem[], start: (item: PlanItem) => Promise<void>, concurrency = 3): Promise<{ queued: number; failed: ImportReport["failed"] }> {
  const failed: ImportReport["failed"] = [];
  let queued = 0;
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next]; next += 1;
      try { await start(item); queued += 1; } catch (error) { failed.push({ item, error: errorText(error) }); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return { queued, failed };
}
