// Pure helpers: no runtime imports so they can be unit tested with plain `node --test`.
import type { Piko } from "../../models";
import type { ArtChoice, MetadataChoice, ProviderId, Readiness, TextMeta } from "./types";

/** The Steam appid when the game launches through Steam (imported Steam games, or a steam://rungameid target). */
export function steamAppIdOf(piko: Pick<Piko, "id" | "sourceId" | "executablePath">): number | null {
  const fromTarget = /^steam:\/\/rungameid\/(\d{1,10})$/.exec(piko.executablePath ?? "");
  const fromId = piko.sourceId === "steam" ? /^steam:(\d{1,10})$/.exec(piko.id) : null;
  const id = Number((fromTarget ?? fromId)?.[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export type Plan = { text: ProviderId[]; art: ProviderId[] };

/**
 * Which providers to ask, in priority order. "auto" uses IGDB for text, then the best artwork
 * available; an explicit choice restricts the lookup to that provider.
 */
export function planProviders(choice: MetadataChoice | "steam", ready: Readiness, steamAppId: number | null): Plan {
  const steam = steamAppId !== null;
  if (choice === "steam") return { text: steam ? ["steam"] : [], art: steam ? ["steam"] : [] };
  if (choice === "igdb") return { text: ready.igdb ? ["igdb"] : [], art: ready.igdb ? ["igdb"] : [] };
  if (choice === "steamgriddb") return { text: [], art: ready.steamgriddb ? ["steamgriddb"] : [] };
  return {
    text: [...(ready.igdb ? ["igdb" as const] : []), ...(steam ? ["steam" as const] : [])],
    art: [...(ready.steamgriddb ? ["steamgriddb" as const] : []), ...(ready.igdb ? ["igdb" as const] : []), ...(steam ? ["steam" as const] : [])],
  };
}

/** Adds the keyless Steam Store to a plan for Steam games, whatever "Metadata source" says (used for freshly imported games). */
export function withSteam(plan: Plan, steamAppId: number | null): Plan {
  if (steamAppId === null) return plan;
  return { text: plan.text.includes("steam") ? plan.text : [...plan.text, "steam"], art: plan.art.includes("steam") ? plan.art : [...plan.art, "steam"] };
}

/** Games from an import that should get Steam Store metadata: Steam games (not launchers) with no metadata yet. */
export function steamImportTargets(pikos: Piko[]): Piko[] {
  return pikos.filter((piko) => piko.kind !== "launcher" && steamAppIdOf(piko) !== null && !piko.screenshots?.length && !piko.artworkUrl && piko.artworkSource !== "igdb" && piko.artworkSource !== "steam" && piko.artworkSource !== "steamgriddb");
}

type Sized = { width: number; height: number };

/** Prefers an exact 600x900 grid, then the closest portrait (2:3) shape, then the first item. */
export function pickGrid<T extends Sized>(items: T[]): T | undefined {
  const exact = items.find((item) => item.width === 600 && item.height === 900);
  if (exact) return exact;
  const portrait = items.filter((item) => item.width > 0 && item.height > item.width);
  const score = (item: T) => Math.abs(item.width / item.height - 2 / 3);
  return portrait.sort((a, b) => score(a) - score(b))[0] ?? items[0];
}

const cleanList = (items?: string[]) => (items ?? []).map((item) => item.trim()).filter(Boolean);

/** Combines results from several providers: the first provider with a value wins each field. */
export function mergeText(results: Array<TextMeta | undefined>): TextMeta {
  const merged: TextMeta = {};
  for (const part of results) {
    if (!part) continue;
    merged.name ??= part.name?.trim() || undefined;
    merged.description ??= part.description?.trim() || undefined;
    if (!merged.categories?.length) merged.categories = cleanList(part.categories);
    if (!merged.screenshots?.length) merged.screenshots = cleanList(part.screenshots).slice(0, 8);
    merged.trailerId ??= part.trailerId;
    if (!merged.trailerVideos?.length && part.trailerVideos?.length) merged.trailerVideos = part.trailerVideos;
    merged.firstReleaseDate ??= part.firstReleaseDate;
    merged.igdbId ??= part.igdbId;
  }
  return merged;
}

const sanitizeKey = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "-");

/** `url('...')` for remote image addresses: quotes, parentheses, backslashes and whitespace are percent-encoded so a URL cannot end the token. */
export const cssUrl = (url: string) => `url('${url.replace(/['"()\\\s]/g, (char) => "%" + char.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0"))}')`;
export const coverGradient = (url: string) => `linear-gradient(145deg, rgba(10,15,20,.12), rgba(11,15,20,.88)), ${cssUrl(url)}`;

export type MergeInput = { text?: TextMeta; art?: ArtChoice };

/** True when the user owns this field or the artwork; automatic refreshes must leave it alone. */
export const isLocked = (piko: Piko, field: NonNullable<Piko["lockedFields"]>[number]) =>
  (piko.lockedFields ?? []).includes(field) || (field === "artwork" && piko.artworkSource === "custom");

/** Applies merged provider output to a Piko without touching locked fields or custom artwork. */
export function applyMetadata(piko: Piko, input: MergeInput): Piko {
  const { text, art } = input;
  const next: Piko = { ...piko };
  if (text) {
    if (!isLocked(piko, "name") && text.name) next.name = text.name;
    if (!isLocked(piko, "description") && text.description) next.description = text.description;
    if (!isLocked(piko, "categories") && text.categories?.length) next.categories = text.categories;
    if (text.screenshots?.length) next.screenshots = text.screenshots;
    if (text.trailerId) next.trailerId = text.trailerId;
    if (text.trailerVideos?.length) next.trailerVideos = text.trailerVideos;
    if (text.firstReleaseDate !== undefined) next.firstReleaseDate = text.firstReleaseDate;
    if (text.igdbId !== undefined) next.igdbId = text.igdbId;
  }
  if (art && !isLocked(piko, "artwork")) {
    next.artworkUrl = art.url;
    next.artworkCacheKey = piko.artworkCacheKey || sanitizeKey(piko.id);
    next.artworkSource = art.source;
    next.artwork = coverGradient(art.url);
  }
  return next;
}
