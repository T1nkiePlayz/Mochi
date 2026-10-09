// Pure helpers: no runtime imports so they can be unit tested with plain `node --test`.
import { normalizeGameName } from "./gameSupport.ts";

/** Default of "Add other mod sites when a game has fewer than N mods" (Settings > Mod sources). The only place the 15 lives. */
export const DEFAULT_AUTO_EXTEND_BELOW = 15;
export const MAX_AUTO_EXTEND_BELOW = 100;

/** Settings value -> integer 0..100 (0 = never add sources). Anything unusable becomes the default. */
export function clampAutoExtendBelow(value: unknown): number {
  const number = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof number !== "number" || !Number.isFinite(number)) return DEFAULT_AUTO_EXTEND_BELOW;
  return Math.min(MAX_AUTO_EXTEND_BELOW, Math.max(0, Math.round(number)));
}

/** True when a game's primary source lists fewer mods than the user's threshold. 0 never extends. */
export function shouldAutoExtend(primaryTotal: number, below: number): boolean {
  return below > 0 && primaryTotal < below;
}

/** Same mod listed on two sites: equal name and author once punctuation and case are ignored. */
export function modDedupeKey(item: { name: string; author?: string }): string {
  return `${normalizeGameName(item.name).replace(/ /g, "")}|${normalizeGameName(item.author ?? "").replace(/ /g, "")}`;
}

/** Appends `extra` items to `base`, skipping ones that duplicate (by name + author) anything already present. */
export function mergeUnique<T extends { name: string; author?: string }>(base: readonly T[], extra: readonly T[]): T[] {
  const seen = new Set(base.map(modDedupeKey));
  const out = [...base];
  for (const item of extra) {
    const key = modDedupeKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/** Alternates items of several lists (first list first) so a merged page shows every source near the top. */
export function interleave<T>(lists: readonly (readonly T[])[]): T[] {
  const out: T[] = [];
  const longest = Math.max(0, ...lists.map((list) => list.length));
  for (let index = 0; index < longest; index += 1) for (const list of lists) if (index < list.length) out.push(list[index]);
  return out;
}

/** The note under the tab: why more than one site is listed. */
export function extendNote(primaryLabel: string, primaryTotal: number, extraLabels: readonly string[]): string {
  const all = [primaryLabel, ...extraLabels];
  const names = all.length > 1 ? `${all.slice(0, -1).join(", ")} and ${all[all.length - 1]}` : all[0];
  return `Showing mods from ${names} because ${primaryLabel} has only ${primaryTotal.toLocaleString()} for this game.`;
}
