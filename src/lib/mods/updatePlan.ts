// Pure helpers for the "review updates" sheet: which mods are selected and which warnings to show. No runtime imports.
import type { DependencyEntry, DependencyPlan } from "./dependencies";
import type { ModUpdateItem } from "./updates";

export type ReviewWarning = { id: string; tone: "warning" | "info"; message: string; url?: string };

/** Every update Mochi can install starts checked; manual ones (restricted downloads) are listed but not selectable. */
export const defaultSelection = (items: readonly ModUpdateItem[]): Set<string> => new Set(items.filter((item) => item.apply.kind === "download").map((item) => item.path));

export const selectedItems = (items: readonly ModUpdateItem[], selected: ReadonlySet<string>) => items.filter((item) => selected.has(item.path) && item.apply.kind === "download");

/** Missing required dependencies of the selected updates' new versions, each project once. */
export function missingDependencies(items: readonly ModUpdateItem[], selected: ReadonlySet<string>, plans: ReadonlyMap<string, DependencyPlan>): DependencyEntry[] {
  const seen = new Map<string, DependencyEntry>();
  for (const item of selectedItems(items, selected)) for (const entry of plans.get(item.path)?.entries ?? []) if (entry.status === "install" && entry.item && entry.file && !seen.has(entry.key)) seen.set(entry.key, entry);
  return [...seen.values()];
}

/** Warnings for the sheet, in a stable order. */
export function assembleWarnings(items: readonly ModUpdateItem[], selected: ReadonlySet<string>, plans: ReadonlyMap<string, DependencyPlan>): ReviewWarning[] {
  const out: ReviewWarning[] = [];
  const chosen = selectedItems(items, selected);
  for (const item of items) if (item.apply.kind === "manual") out.push({ id: `manual:${item.path}`, tone: "info", message: `${item.title} has to be updated by hand: ${item.apply.reason}`, url: item.apply.pageUrl });
  for (const item of chosen) if (!item.enabled) out.push({ id: `disabled:${item.path}`, tone: "info", message: `${item.title} is turned off and stays off after the update.` });
  const seen = new Set<string>();
  for (const item of chosen) {
    const plan = plans.get(item.path);
    if (!plan) continue;
    for (const entry of plan.entries) {
      if (entry.status === "unavailable" || entry.status === "external") { const id = `needs:${entry.key}`; if (!seen.has(id)) { seen.add(id); out.push({ id, tone: "warning", message: `${item.title} ${item.newVersion} needs ${entry.name}, which Mochi cannot install${entry.reason ? ` (${entry.reason})` : ""}.`, url: entry.pageUrl || undefined }); } }
    }
    for (const warning of plan.warnings) { const id = `incompatible:${warning.declaredBy}>${warning.name}`; if (!seen.has(id)) { seen.add(id); out.push({ id, tone: "warning", message: `${warning.declaredBy} is marked incompatible with ${warning.installedTitle}, which is installed.`, url: warning.pageUrl }); } }
    for (const note of plan.notes) if (!seen.has(note)) { seen.add(note); out.push({ id: `note:${note}`, tone: "info", message: note }); }
  }
  return out;
}
