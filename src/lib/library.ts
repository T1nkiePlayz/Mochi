import type { Piko, Tofu } from "../models";
import type { PlaytimeEntry } from "./platform";
import { migrateMinecraftPikos } from "./minecraftPiko";
import { launcherArt } from "./launcherArt";
import { isInBacklog, isNextUp } from "./backlog";
import { matchesRule, type SavedRule } from "./savedFilters";
import { launcherForPiko } from "./launchers";
import { applyPikoKindOverride, overrideKeyForPiko, readOverrides, type KindOverrides } from "./launcherOverrides";

export type SmartFilterId = "all" | "favorites" | "installed" | "recent" | "unplayed" | "most-played" | "launchers" | "running" | "backlog" | "next-up";
/** The one "primary" filter applied to the library: a smart filter, a source or a user collection. */
export type LibraryFilter = { kind: "smart"; id: SmartFilterId } | { kind: "source"; id: string } | { kind: "collection"; id: string } | { kind: "saved"; id: string };

export const smartFilters: Array<{ id: SmartFilterId; label: string }> = [
  { id: "all", label: "All" },
  { id: "favorites", label: "Favourites" },
  { id: "installed", label: "Installed" },
  { id: "recent", label: "Recently played" },
  { id: "unplayed", label: "Unplayed" },
  { id: "most-played", label: "Most played" },
  { id: "launchers", label: "Game launchers" },
  { id: "running", label: "Running" },
  { id: "backlog", label: "Backlog" },
  { id: "next-up", label: "Next up" },
];

export const defaultFilter: LibraryFilter = { kind: "smart", id: "all" };
export const RECENT_DAYS = 30;
export const MOST_PLAYED_LIMIT = 12;

export const isLauncher = (piko: Piko) => piko.kind === "launcher";
/** Soundtracks, artbooks and other non-game entries: kept out of the main library and shown in their own section. */
export const isExtra = (piko: Piko) => piko.contentType === "soundtrack" || piko.contentType === "extra";
export const sourceOf = (piko: Piko) => piko.sourceId || (piko.platformCategory ? piko.platformCategory.toLowerCase() : "other");
export const sourceLabel = (piko: Piko) => piko.platformCategory || piko.sourceId || "Other";

export type FilterContext = {
  playtime: Map<string, PlaytimeEntry>;
  /** Launch target -> still exists on disk. Unknown targets count as installed. */
  installed: Map<string, boolean>;
  isRunning: (gameId: string) => boolean;
  /** Seconds since epoch; injectable for tests. */
  now?: number;
  /** Saved filters by id and the remembered time-to-beat hours (for `kind: "saved"` filters). */
  saved?: ReadonlyMap<string, SavedRule>;
  hours?: ReadonlyMap<string, number>;
};

export function matchesSmartFilter(piko: Piko, id: SmartFilterId, context: FilterContext, mostPlayed?: Set<string>): boolean {
  const entry = context.playtime.get(piko.id);
  switch (id) {
    case "all": return true;
    case "favorites": return Boolean(piko.favorite);
    case "installed": return Boolean(piko.executablePath) && context.installed.get(piko.executablePath ?? "") !== false;
    case "recent": return Boolean(entry && entry.lastPlayed > (context.now ?? Date.now() / 1000) - RECENT_DAYS * 86_400);
    case "unplayed": return !entry || entry.seconds <= 0;
    case "most-played": return mostPlayed ? mostPlayed.has(piko.id) : (entry?.seconds ?? 0) > 0;
    case "launchers": return isLauncher(piko);
    case "running": return context.isRunning(piko.id);
    case "backlog": return isInBacklog(piko);
    case "next-up": return isNextUp(piko);
    default: return true;
  }
}

export function mostPlayedIds(library: Piko[], playtime: Map<string, PlaytimeEntry>): Set<string> {
  return new Set(library.filter((piko) => (playtime.get(piko.id)?.seconds ?? 0) > 0)
    .sort((a, b) => (playtime.get(b.id)?.seconds ?? 0) - (playtime.get(a.id)?.seconds ?? 0))
    .slice(0, MOST_PLAYED_LIMIT).map((piko) => piko.id));
}

export function matchesFilter(piko: Piko, filter: LibraryFilter, context: FilterContext, mostPlayed?: Set<string>): boolean {
  if (isExtra(piko)) return false;
  if (filter.kind === "smart") return matchesSmartFilter(piko, filter.id, context, mostPlayed);
  if (filter.kind === "source") return sourceOf(piko) === filter.id;
  if (filter.kind === "saved") {
    const rule = context.saved?.get(filter.id);
    return rule ? matchesRule(piko, rule, { playSeconds: (id) => context.playtime.get(id)?.seconds ?? 0, isInstalled: (item) => Boolean(item.executablePath) && context.installed.get(item.executablePath ?? "") !== false, hours: context.hours ?? new Map() }) : false;
  }
  return Boolean(piko.collectionIds?.includes(filter.id));
}

/** Every tag used in the library with how many games carry it, most used first. */
export function tagCounts(library: Piko[]): Array<[string, number]> {
  const counts = new Map<string, number>();
  library.forEach((piko) => piko.tags?.forEach((tag) => counts.set(tag, (counts.get(tag) ?? 0) + 1)));
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export const normalizeTag = (tag: string) => tag.trim().replace(/\s+/g, " ").slice(0, 32);

/** Adds a tag unless it is already present (case-insensitive). */
export function withTag(tags: string[] | undefined, tag: string): string[] {
  const clean = normalizeTag(tag);
  const existing = tags ?? [];
  if (!clean || existing.some((item) => item.toLowerCase() === clean.toLowerCase())) return existing;
  return [...existing, clean];
}

export const toggleInList = (list: string[] | undefined, value: string, on: boolean): string[] => {
  const current = list ?? [];
  return on ? (current.includes(value) ? current : [...current, value]) : current.filter((item) => item !== value);
};

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const defaultTofuOf = (): Tofu => ({ id: "default", name: "Default", version: "Local", runtime: "Native", mods: 0, status: "Ready" });

/**
 * Makes a library read from storage (or the cloud) safe to render: drops non-objects and entries without an id,
 * removes duplicate ids (React keys), and guarantees every Piko has a name and at least one valid Tofu.
 */
export function sanitizeLibrary(value: unknown, overrides: KindOverrides = readOverrides()): Piko[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: Piko[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.id !== "string" || !item.id || seen.has(item.id)) continue;
    seen.add(item.id);
    const tofus = (Array.isArray(item.tofus) ? item.tofus : []).filter((tofu): tofu is Tofu => isRecord(tofu) && typeof tofu.id === "string");
    result.push(classifyLauncherEntry({
      ...(item as unknown as Piko),
      name: typeof item.name === "string" ? item.name : "Untitled",
      description: typeof item.description === "string" ? item.description : "",
      accent: typeof item.accent === "string" ? item.accent : "#a99ad6",
      artwork: typeof item.artwork === "string" ? item.artwork : "",
      tofus: tofus.length ? tofus.map((tofu) => ({ ...tofu, name: typeof tofu.name === "string" ? tofu.name : "Default", mods: Number.isFinite(tofu.mods) ? tofu.mods : 0 })) : [defaultTofuOf()],
    }, overrides));
  }
  return migrateMinecraftPikos(result);
}

/**
 * Load-time migration: entries that are known launchers (imported before Mochi knew them, or before
 * `kind` existed) become launchers so they land in "Game launchers". Launchers never keep a trailer.
 * Returns the same object when nothing changes.
 */
export function classifyLauncherEntry(piko: Piko, overrides: KindOverrides = {}): Piko {
  // The user's own correction always wins over automatic detection, in both directions.
  if (overrides[overrideKeyForPiko(piko)]) return applyPikoKindOverride(piko, overrides);
  const def = piko.kind === "launcher" && piko.launcherId ? undefined : launcherForPiko(piko);
  if (!def) {
    return piko.kind === "launcher" && piko.trailerId ? { ...piko, trailerId: undefined } : piko;
  }
  const wasGame = piko.kind !== "launcher";
  const ownArt = Boolean(piko.artworkSource || piko.artworkUrl || (piko.lockedFields ?? []).includes("artwork"));
  return {
    ...piko,
    kind: "launcher",
    launcherId: def.id,
    trailerId: undefined,
    ...(wasGame ? { platformCategory: "Launchers", categories: piko.categories?.length ? piko.categories : ["Launcher"] } : {}),
    ...(!ownArt && !piko.artwork ? { artwork: launcherArt(def.id) } : {}),
  };
}

/** A stored filter is only usable when its kind and (for smart filters) its id are still known. */
export function sanitizeFilter(value: unknown): LibraryFilter {
  if (!isRecord(value) || typeof value.id !== "string") return defaultFilter;
  if (value.kind === "smart") return smartFilters.some((filter) => filter.id === value.id) ? { kind: "smart", id: value.id as SmartFilterId } : defaultFilter;
  if (value.kind === "source" || value.kind === "collection" || value.kind === "saved") return { kind: value.kind, id: value.id };
  return defaultFilter;
}
