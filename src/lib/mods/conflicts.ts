// Offline mod conflict check for one Tofu. Pure: no Tauri, React or network; it only reads what Mochi already stored
// (install records + the file list), so it is cheap enough to run before every launch.
import { compatibility, tofuTarget, type TofuTarget } from "./compat";
import type { Tofu } from "../../models";

/** The record facts the check uses; `ModRecord` fits. */
export type CheckRecord = {
  file: string; subdir?: string; source: string; projectId: string; title?: string; version?: string;
  installedAt?: number; fileDate?: string; extracted?: boolean;
  gameVersions?: readonly string[]; loaders?: readonly string[]; requires?: readonly string[]; incompatible?: readonly string[];
};
/** A file of the Tofu's mod folder; `InstanceMod` fits. */
export type CheckEntry = { filename: string; path?: string; enabled: boolean; foreign?: boolean; modifiedMs?: number; record?: CheckRecord };

export type IssueKind = "duplicate-file" | "duplicate-project" | "wrong-version" | "wrong-loader" | "missing-dependency" | "incompatible";
export type IssueAction =
  | { kind: "disable"; label: string; paths: string[] }
  | { kind: "enable"; label: string; paths: string[] }
  | { kind: "install-dependency"; label: string; source: string; projectId: string; name: string }
  | { kind: "open-page"; label: string; source: string; projectId: string };

export type Issue = {
  /** Stable for the same problem, so a re-check can tell what was fixed. */
  id: string;
  kind: IssueKind;
  severity: "warning" | "info";
  title: string;
  detail: string;
  /** File names involved. */
  files: string[];
  actions: IssueAction[];
};

export type CheckOptions = { /** Overrides what is read from the Tofu (tests, games without a version). */ target?: TofuTarget };

const idKey = (source: string, projectId: string) => `${source}:${projectId}`;
const baseName = (name: string) => name.replace(/\.disabled$/i, "");
const nameOf = (record: CheckRecord | undefined, fallback: string) => (record?.title?.trim() || baseName(fallback));
const known = (record: CheckRecord | undefined): record is CheckRecord => Boolean(record && record.source !== "manual" && record.projectId && !record.extracted);
const normalizeTitle = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, "");
const sortKey = (entry: CheckEntry) => entry.record?.fileDate ?? "";

/** Newest first: file date, then install time, then file time, then name (so the result never depends on input order). */
function newestFirst(a: CheckEntry, b: CheckEntry): number {
  return sortKey(b).localeCompare(sortKey(a)) || (b.record?.installedAt ?? 0) - (a.record?.installedAt ?? 0) || (b.modifiedMs ?? 0) - (a.modifiedMs ?? 0) || a.filename.localeCompare(b.filename);
}

const paths = (entries: readonly CheckEntry[]) => entries.flatMap((entry) => (entry.path ? [entry.path] : []));
const pageAction = (record: CheckRecord, label: string): IssueAction[] => (modPageUrl(record.source, record.projectId) ? [{ kind: "open-page", label, source: record.source, projectId: record.projectId }] : []);
const list = (names: readonly string[], max = 3) => (names.length > max ? `${names.slice(0, max).join(", ")} and ${names.length - max} more` : names.join(", "));

/**
 * Finds what is likely to stop a Tofu's mods from loading: the same file or mod twice, mods built for another game
 * version or loader, required mods that are missing, and mods their authors marked as incompatible. Only files that
 * are switched on count (a disabled file cannot conflict), except for the same-name pair. Never throws; unknown facts
 * (no record, nothing stored) are simply not judged.
 */
export function checkTofu(entries: readonly CheckEntry[], tofu: Pick<Tofu, "version" | "runtime" | "name"> & Partial<Pick<Tofu, "loader">>, opts: CheckOptions = {}): Issue[] {
  const issues: Issue[] = [];
  const own = entries.filter((entry) => !entry.foreign);
  const active = own.filter((entry) => entry.enabled && !entry.record?.extracted);

  // 1. The same file name with and without ".disabled" (case-insensitive: macOS file systems usually are).
  const byName = new Map<string, { on?: CheckEntry; off?: CheckEntry }>();
  for (const entry of own) {
    if (entry.record?.extracted) continue;
    const key = baseName(entry.filename).toLowerCase();
    const slot = byName.get(key) ?? {};
    if (entry.enabled) slot.on ??= entry; else slot.off ??= entry;
    byName.set(key, slot);
  }
  for (const [key, slot] of byName) {
    if (!slot.on || !slot.off) continue;
    issues.push({ id: `duplicate-file:${key}`, kind: "duplicate-file", severity: "info", title: `${baseName(slot.on.filename)} exists twice`,
      detail: "Both the switched-on and the switched-off copy are in the folder, so switching it on or off again can fail. Remove the copy you do not need.", files: [slot.on.filename, slot.off.filename], actions: [] });
  }

  // 2. The same project twice (any two files of one project), then the same title from two different sites.
  const projects = new Map<string, CheckEntry[]>();
  for (const entry of active) {
    if (!known(entry.record)) continue;
    const key = `${idKey(entry.record.source, entry.record.projectId)}|${entry.record.subdir ?? ""}`;
    const group = projects.get(key);
    if (group) group.push(entry); else projects.set(key, [entry]);
  }
  const reported = new Set<CheckEntry>();
  const reportDuplicates = (id: string, group: CheckEntry[], why: string) => {
    const sorted = [...group].sort(newestFirst);
    const [keep, ...older] = sorted;
    for (const entry of sorted) reported.add(entry);
    const title = nameOf(keep.record, keep.filename);
    issues.push({ id, kind: "duplicate-project", severity: "warning", title: `${title} is installed twice`,
      detail: `${why} ${list(sorted.map((entry) => entry.filename))}. Two copies usually stop the game from starting. Keep ${keep.filename}, the newest.`, files: sorted.map((entry) => entry.filename),
      actions: [...(paths(older).length ? [{ kind: "disable" as const, label: "Disable duplicate", paths: paths(older) }] : []), ...(keep.record ? pageAction(keep.record, "Open mod page") : [])] });
  };
  for (const [key, group] of projects) if (group.length > 1) reportDuplicates(`duplicate-project:${key}`, group, "Two versions of the same mod:");
  const titles = new Map<string, CheckEntry[]>();
  for (const entry of active) {
    if (!known(entry.record) || reported.has(entry) || (entry.record.subdir ?? "") !== "") continue;
    const key = normalizeTitle(entry.record.title ?? "");
    if (key.length < 3) continue;
    const group = titles.get(key);
    if (group) group.push(entry); else titles.set(key, [entry]);
  }
  for (const [key, group] of titles) {
    if (new Set(group.map((entry) => entry.record!.source)).size > 1) reportDuplicates(`duplicate-title:${key}`, group, "The same mod from different sites:");
  }

  // 3. Mods built for another loader or game version (only clear mismatches, never "maybe").
  const target = opts.target ?? tofuTarget(tofu);
  const mods = active.filter((entry) => known(entry.record) && (entry.record.subdir ?? "") === "");
  if (target.loader || target.gameVersion) {
    for (const entry of mods) {
      const record = entry.record!;
      const name = nameOf(record, entry.filename);
      const actions: IssueAction[] = [...(paths([entry]).length ? [{ kind: "disable" as const, label: "Disable", paths: paths([entry]) }] : []), ...pageAction(record, "Open mod page")];
      if (record.loaders?.length) {
        const result = compatibility({ loaders: record.loaders, gameVersions: target.gameVersion ? [target.gameVersion] : undefined }, target);
        if (result.status === "incompatible") issues.push({ id: `wrong-loader:${entry.filename}`, kind: "wrong-loader", severity: "warning", title: `${name} is for a different loader`, detail: result.reasons[0] ?? "Built for another mod loader.", files: [entry.filename], actions });
      }
      if (record.gameVersions?.length && target.gameVersion) {
        const result = compatibility({ loaders: [], gameVersions: record.gameVersions }, target);
        if (result.status === "incompatible") issues.push({ id: `wrong-version:${entry.filename}`, kind: "wrong-version", severity: "warning", title: `${name} is for a different game version`, detail: result.reasons[0] ?? "Built for another game version.", files: [entry.filename], actions });
      }
    }
  }

  // 4 and 5. Missing required mods, and mods marked incompatible with each other.
  const present = new Map<string, CheckEntry>();
  const turnedOff = new Map<string, CheckEntry>();
  for (const entry of own) {
    if (!known(entry.record)) continue;
    const key = idKey(entry.record.source, entry.record.projectId);
    if (entry.enabled) present.set(key, present.get(key) ?? entry); else turnedOff.set(key, turnedOff.get(key) ?? entry);
  }
  const missing = new Map<string, { source: string; projectId: string; by: string[] }>();
  const seenPairs = new Set<string>();
  for (const entry of mods) {
    const record = entry.record!;
    const self = idKey(record.source, record.projectId);
    for (const need of record.requires ?? []) {
      const key = idKey(record.source, need);
      if (key === self || present.has(key)) continue;
      const hit = missing.get(key);
      const by = nameOf(record, entry.filename);
      if (hit) { if (!hit.by.includes(by)) hit.by.push(by); } else missing.set(key, { source: record.source, projectId: need, by: [by] });
    }
    for (const bad of record.incompatible ?? []) {
      const key = idKey(record.source, bad);
      const other = present.get(key);
      if (!other || key === self) continue;
      const pair = [self, key].sort().join("|");
      if (seenPairs.has(pair)) continue;
      seenPairs.add(pair);
      const [a, b] = [nameOf(record, entry.filename), nameOf(other.record, other.filename)];
      issues.push({ id: `incompatible:${pair}`, kind: "incompatible", severity: "warning", title: `${a} does not work with ${b}`, detail: `${a} is marked incompatible with ${b} by its author. Turn one of them off.`, files: [entry.filename, other.filename],
        actions: [...(paths([entry]).length ? [{ kind: "disable" as const, label: `Disable ${a}`, paths: paths([entry]) }] : []), ...(paths([other]).length ? [{ kind: "disable" as const, label: `Disable ${b}`, paths: paths([other]) }] : []), ...pageAction(record, "Open mod page")] });
    }
  }
  for (const [key, need] of missing) {
    const off = turnedOff.get(key);
    const name = off ? nameOf(off.record, off.filename) : `Required mod ${need.projectId}`;
    const asked = `${list(need.by)} ${need.by.length === 1 ? "needs" : "need"}`;
    const actions: IssueAction[] = off && paths([off]).length ? [{ kind: "enable", label: `Enable ${name}`, paths: paths([off]) }]
      : [{ kind: "install-dependency", label: "Install missing dependency", source: need.source, projectId: need.projectId, name }, ...pageAction({ file: "", source: need.source, projectId: need.projectId }, "Open mod page")];
    issues.push({ id: `missing-dependency:${key}`, kind: "missing-dependency", severity: "warning", title: off ? `${name} is switched off` : `${name} is missing`,
      detail: off ? `${asked} ${name}, which is installed but switched off.` : `${asked} another mod that is not installed.`, files: need.by,
      actions });
  }
  return issues;
}

/** Warnings first (they can stop the game), then notes; stable within a group. */
export const sortIssues = (issues: readonly Issue[]): Issue[] => [...issues].sort((a, b) => Number(a.severity === "info") - Number(b.severity === "info"));

/** One line for a button or toast. */
export const summarizeIssues = (issues: readonly Issue[]): string => (issues.length === 0 ? "No problems found." : `${issues.length} possible problem${issues.length === 1 ? "" : "s"} found.`);

/** The mod's web page for "Open mod page", when the source's address can be built from the project id alone (Nexus needs the game). */
export function modPageUrl(source: string, projectId: string): string | undefined {
  const id = encodeURIComponent(projectId);
  if (source === "modrinth") return `https://modrinth.com/project/${id}`;
  if (source === "curseforge") return `https://www.curseforge.com/projects/${id}`;
  return undefined;
}
