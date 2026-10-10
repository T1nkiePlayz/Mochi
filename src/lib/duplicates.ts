import type { LaunchSource, Piko } from "../models";
import { isExtra } from "./library";
import { MINECRAFT_PIKO_ID, isInstanceTarget } from "./minecraftPiko";
import { mergedIds } from "./launchSources";
import { platformLabel } from "./importMapping";
import { readJson, storageKeys, writeJson } from "./storage";

/**
 * Finding the same game imported from several places (Steam + Heroic + Flatpak + a desktop entry) and folding the copies
 * into one Piko with a "Play via" choice. Pure and reversible: the folded Pikos are kept whole in `mergedFrom`, so
 * `unmergeGame` restores them exactly. Nothing on disk is touched. Not synced to the cloud (the cloud schema has no such columns).
 */

export type DuplicateGroup = { key: string; members: Piko[]; reason: "id" | "name" };

const ROMAN: Record<string, string> = { ii: "2", iii: "3", iv: "4", vi: "6", vii: "7", viii: "8", ix: "9", xi: "11", xii: "12", xiii: "13", xiv: "14", xv: "15", xvi: "16" };

/**
 * Lower-case, accent-free, no trademark signs or punctuation, no leading "the", a trailing "(2016)" dropped and a trailing
 * roman numeral II..XVI written as digits. Editions and plain numbers stay, so "Portal" and "Portal 2" never match.
 */
export function normalizeName(name: string): string {
  let text = name.replace(/[\u2122\u00ae\u00a9\u2120]/g, "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  text = text.replace(/\(\s*(19|20)\d\d\s*\)\s*$/, "").replace(/&/g, " and ");
  text = text.replace(/[^a-z0-9]+/g, " ").trim().replace(/^the\s+/, "");
  const words = text.split(" ").filter(Boolean);
  const last = words[words.length - 1];
  if (words.length > 1 && last && ROMAN[last]) words[words.length - 1] = ROMAN[last];
  return words.join(" ");
}

/** A store id read from the launch target (`steam:620`, `epic:Sugar`, `gog:1207`...), or null when the target carries none. */
export function storeKey(target: string | undefined): string | null {
  const text = (target ?? "").trim();
  const steam = /^steam:\/\/(?:rungameid|run)\/(\d+)/i.exec(text);
  if (steam) return `steam:${steam[1]}`;
  const heroic = /^heroic:\/\/launch\?(.*)$/i.exec(text);
  if (heroic) {
    const params = new URLSearchParams(heroic[1]);
    const app = params.get("appName"), runner = (params.get("runner") ?? "").toLowerCase();
    if (!app) return null;
    return `${runner === "legendary" ? "epic" : runner || "heroic"}:${app}`;
  }
  const flatpak = /^flatpak:\/\/(.+)$/i.exec(text);
  return flatpak ? `flatpak:${flatpak[1].toLowerCase()}` : null;
}

const isCandidate = (piko: Piko) =>
  piko.id !== "__empty" && piko.id !== MINECRAFT_PIKO_ID && piko.importKey !== MINECRAFT_PIKO_ID && piko.kind !== "launcher" && !isExtra(piko)
  && Boolean(piko.executablePath?.trim()) && !isInstanceTarget(piko.executablePath) && !piko.tofus.some((tofu) => isInstanceTarget(tofu.launchTarget));

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Every source's store ids: the Piko's own target plus the targets of sources it already absorbed. */
const keysOf = (piko: Piko) => new Set([piko.executablePath, ...(piko.launchSources ?? []).map((source) => source.executablePath)].map(storeKey).filter((key): key is string => Boolean(key)));

/**
 * Groups of Pikos that are the same game: same store id, or the same normalised name. `dismissed` holds pair keys
 * (`pairKey`) the user said are different games; those are never joined. Groups keep library order.
 */
export function findDuplicates(library: Piko[], dismissed: ReadonlySet<string> = new Set()): DuplicateGroup[] {
  const candidates = library.filter(isCandidate);
  const parent = new Map(candidates.map((piko) => [piko.id, piko.id]));
  const find = (id: string): string => { let root = id; while (parent.get(root) !== root) root = parent.get(root)!; parent.set(id, root); return root; };
  const viaId = new Set<string>();
  const buckets = new Map<string, Piko[]>();
  const add = (bucket: string, piko: Piko) => { const list = buckets.get(bucket); if (list) list.push(piko); else buckets.set(bucket, [piko]); };
  for (const piko of candidates) {
    const name = normalizeName(piko.name);
    if (name.length >= 2) add(`n:${name}`, piko);
    for (const key of keysOf(piko)) add(`k:${key}`, piko);
  }
  for (const [bucket, list] of buckets) {
    if (list.length < 2) continue;
    const anchor = list[0];
    for (const piko of list.slice(1)) {
      if (dismissed.has(pairKey(anchor.id, piko.id))) continue;
      parent.set(find(piko.id), find(anchor.id));
      if (bucket.startsWith("k:")) viaId.add(anchor.id);
    }
  }
  const groups = new Map<string, Piko[]>();
  for (const piko of candidates) { const root = find(piko.id); const list = groups.get(root); if (list) list.push(piko); else groups.set(root, [piko]); }
  return [...groups.values()].filter((members) => members.length > 1).map((members) => ({
    key: members.map((piko) => piko.id).sort().join("|"), members, reason: members.some((piko) => viaId.has(piko.id)) ? "id" : "name",
  }));
}

export const readDismissed = (): Set<string> => {
  const value = readJson<unknown>(storageKeys.duplicateDismissed, []);
  return new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
};
export const writeDismissed = (dismissed: ReadonlySet<string>) => writeJson(storageKeys.duplicateDismissed, [...dismissed]);

/** Pair keys for every two members of a group, to remember "not the same game". */
export function dismissPairs(dismissed: ReadonlySet<string>, ids: string[]): Set<string> {
  const next = new Set(dismissed);
  for (let i = 0; i < ids.length; i += 1) for (let j = i + 1; j < ids.length; j += 1) next.add(pairKey(ids[i], ids[j]));
  return next;
}

const sourceLabelOf = (piko: Piko) => piko.platformCategory || (piko.sourceId ? platformLabel(piko.sourceId) : "") || "Custom";

/** The launch source a Piko itself is. */
export function launchSourceOf(piko: Piko, label = sourceLabelOf(piko)): LaunchSource {
  return { id: piko.id, label, ...(piko.sourceId ? { sourceId: piko.sourceId } : {}), executablePath: piko.executablePath ?? "",
    ...(piko.installPath ? { installPath: piko.installPath } : {}), ...(piko.importKey ? { importKey: piko.importKey } : {}) };
}

/** The member that keeps its id and metadata: the one with the best metadata (IGDB match, then a cover), else the first. */
export function pickPrimary(members: Piko[]): Piko {
  const score = (piko: Piko) => (piko.igdbId ? 4 : 0) + (piko.artworkUrl || piko.artworkSource === "custom" ? 2 : 0) + (piko.launchSources?.length ? 1 : 0);
  return members.reduce((best, piko) => (score(piko) > score(best) ? piko : best), members[0]);
}

/** Labels that repeat get " (2)", " (3)" so the picker can tell them apart. */
const uniqueLabels = (sources: LaunchSource[]): LaunchSource[] => {
  const seen = new Map<string, number>();
  return sources.map((source) => { const n = (seen.get(source.label) ?? 0) + 1; seen.set(source.label, n); return n > 1 ? { ...source, label: `${source.label} (${n})` } : source; });
};

/**
 * Folds `memberIds` into the Piko `primaryId`. The primary keeps its id, metadata, tags and Tofus; the others leave the
 * library but stay whole inside `mergedFrom`. Returns the same array when nothing applies.
 */
export function mergeGame(library: Piko[], primaryId: string, memberIds: string[]): Piko[] {
  const primary = library.find((piko) => piko.id === primaryId);
  const ids = new Set(memberIds.filter((id) => id !== primaryId));
  const members = library.filter((piko) => ids.has(piko.id));
  if (!primary || !members.length) return library;
  const own = primary.launchSources?.length ? primary.launchSources : [launchSourceOf(primary)];
  const absorbed = members.flatMap((piko) => (piko.launchSources?.length ? piko.launchSources : [launchSourceOf(piko)]));
  const taken = new Set(own.map((source) => source.id));
  const sources = uniqueLabels([...own, ...absorbed.filter((source) => !taken.has(source.id))]);
  const merged: Piko = { ...primary, launchSources: sources, preferredSource: primary.preferredSource ?? primary.id, mergedFrom: [...(primary.mergedFrom ?? []), ...members] };
  return library.filter((piko) => !ids.has(piko.id)).map((piko) => (piko.id === primaryId ? merged : piko));
}

/**
 * Undoes a merge: `sourceId` restores that one folded Piko, none restores all. Restored Pikos are exact copies and follow
 * the primary in the library. Once nothing is folded the primary loses its merge fields and is the Piko it was before.
 */
export function unmergeGame(library: Piko[], primaryId: string, sourceId?: string): Piko[] {
  const primary = library.find((piko) => piko.id === primaryId);
  if (!primary?.mergedFrom?.length) return library;
  const restored = sourceId ? primary.mergedFrom.filter((piko) => piko.id === sourceId) : primary.mergedFrom;
  if (!restored.length) return library;
  const left = primary.mergedFrom.filter((piko) => !restored.includes(piko));
  const gone = new Set(restored.flatMap((piko) => [piko.id, ...mergedIds(piko)]));
  // A restored Piko that was itself merged brings its own sources back with it.
  const sources = (primary.launchSources ?? []).filter((source) => !gone.has(source.id));
  const next: Piko = { ...primary };
  if (left.length) { next.mergedFrom = left; next.launchSources = sources; if (!sources.some((source) => source.id === next.preferredSource)) next.preferredSource = primary.id; }
  else { delete next.mergedFrom; delete next.launchSources; delete next.preferredSource; }
  const out: Piko[] = [];
  for (const piko of library) { out.push(piko.id === primaryId ? next : piko); if (piko.id === primaryId) out.push(...restored); }
  return out;
}
