import type { Piko } from "../models";
import type { PlaytimeEntry } from "./platform";

export type SmartFilterId = "all" | "favorites" | "installed" | "recent" | "unplayed" | "most-played" | "launchers" | "running";
/** The one "primary" filter applied to the library: a smart filter, a source or a user collection. */
export type LibraryFilter = { kind: "smart"; id: SmartFilterId } | { kind: "source"; id: string } | { kind: "collection"; id: string };

export const smartFilters: Array<{ id: SmartFilterId; label: string }> = [
  { id: "all", label: "All" },
  { id: "favorites", label: "Favourites" },
  { id: "installed", label: "Installed" },
  { id: "recent", label: "Recently played" },
  { id: "unplayed", label: "Unplayed" },
  { id: "most-played", label: "Most played" },
  { id: "launchers", label: "Game launchers" },
  { id: "running", label: "Running" },
];

export const defaultFilter: LibraryFilter = { kind: "smart", id: "all" };
export const RECENT_DAYS = 30;
export const MOST_PLAYED_LIMIT = 12;

export const isLauncher = (piko: Piko) => piko.kind === "launcher";
export const sourceOf = (piko: Piko) => piko.sourceId || (piko.platformCategory ? piko.platformCategory.toLowerCase() : "other");
export const sourceLabel = (piko: Piko) => piko.platformCategory || piko.sourceId || "Other";

export type FilterContext = {
  playtime: Map<string, PlaytimeEntry>;
  /** Launch target -> still exists on disk. Unknown targets count as installed. */
  installed: Map<string, boolean>;
  isRunning: (gameId: string) => boolean;
  /** Seconds since epoch; injectable for tests. */
  now?: number;
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
  }
}

export function mostPlayedIds(library: Piko[], playtime: Map<string, PlaytimeEntry>): Set<string> {
  return new Set(library.filter((piko) => (playtime.get(piko.id)?.seconds ?? 0) > 0)
    .sort((a, b) => (playtime.get(b.id)?.seconds ?? 0) - (playtime.get(a.id)?.seconds ?? 0))
    .slice(0, MOST_PLAYED_LIMIT).map((piko) => piko.id));
}

export function matchesFilter(piko: Piko, filter: LibraryFilter, context: FilterContext, mostPlayed?: Set<string>): boolean {
  if (filter.kind === "smart") return matchesSmartFilter(piko, filter.id, context, mostPlayed);
  if (filter.kind === "source") return sourceOf(piko) === filter.id;
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
