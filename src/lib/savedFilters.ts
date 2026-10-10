import type { Piko } from "../models";
import { backlogStatuses, isInBacklog, type BacklogStatus } from "./backlog";
import { readJson, writeJson } from "./storage";

/** What a saved filter requires; every part that is set must match. */
export type SavedRule = {
  /** Backlog status is one of these. */
  status?: BacklogStatus[];
  nextUp?: boolean;
  played?: "played" | "unplayed";
  favorite?: boolean;
  /** Has a launch target that still exists. */
  installed?: boolean;
  /** The game carries every one of these tags. */
  tags?: string[];
  /** The game has at least one of these genres/categories. */
  categories?: string[];
  /** Hours to beat (IGDB, needs data for the game). */
  minHours?: number;
  maxHours?: number;
};
export type SavedFilter = { id: string; name: string; rule: SavedRule };

export const savedFiltersKey = "mochi:saved-filters";
export const MAX_SAVED_FILTERS = 20;

export type RuleContext = { playSeconds: (id: string) => number; isInstalled: (piko: Piko) => boolean; hours: ReadonlyMap<string, number> };

const lower = (values: string[] | undefined) => (values ?? []).map((value) => value.toLowerCase());

export function matchesRule(piko: Piko, rule: SavedRule, ctx: RuleContext): boolean {
  if (rule.status?.length && !(piko.backlog && rule.status.includes(piko.backlog.status))) return false;
  if (rule.nextUp && !(piko.backlog?.nextUp && isInBacklog(piko))) return false;
  if (rule.played === "unplayed" && ctx.playSeconds(piko.id) > 0) return false;
  if (rule.played === "played" && ctx.playSeconds(piko.id) <= 0) return false;
  if (rule.favorite && !piko.favorite) return false;
  if (rule.installed && !ctx.isInstalled(piko)) return false;
  if (rule.tags?.length) { const have = lower(piko.tags); if (!lower(rule.tags).every((tag) => have.includes(tag))) return false; }
  if (rule.categories?.length) { const have = lower(piko.categories); if (!lower(rule.categories).some((category) => have.includes(category))) return false; }
  if (rule.minHours !== undefined || rule.maxHours !== undefined) {
    const hours = ctx.hours.get(piko.id);
    if (hours === undefined) return false;
    if (rule.minHours !== undefined && hours < rule.minHours) return false;
    if (rule.maxHours !== undefined && hours > rule.maxHours) return false;
  }
  return true;
}

export const ruleIsEmpty = (rule: SavedRule) => !Object.values(rule).some((value) => (Array.isArray(value) ? value.length > 0 : value !== undefined && value !== false));
export const ruleUsesHours = (rule: SavedRule) => rule.minHours !== undefined || rule.maxHours !== undefined;

const words = (value: unknown, max = 12): string[] | undefined => {
  const list = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "").map((item) => item.trim().slice(0, 40)).slice(0, max) : [];
  return list.length ? list : undefined;
};
const hoursValue = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 2000 ? value : undefined);

export function sanitizeRule(value: unknown): SavedRule {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const status = Array.isArray(raw.status) ? raw.status.filter((item): item is BacklogStatus => backlogStatuses.some((entry) => entry.id === item)) : [];
  const rule: SavedRule = {};
  if (status.length) rule.status = [...new Set(status)];
  if (raw.nextUp === true) rule.nextUp = true;
  if (raw.played === "played" || raw.played === "unplayed") rule.played = raw.played;
  if (raw.favorite === true) rule.favorite = true;
  if (raw.installed === true) rule.installed = true;
  const tags = words(raw.tags); if (tags) rule.tags = tags;
  const categories = words(raw.categories); if (categories) rule.categories = categories;
  const min = hoursValue(raw.minHours); if (min !== undefined) rule.minHours = min;
  const max = hoursValue(raw.maxHours); if (max !== undefined) rule.maxHours = max;
  return rule;
}

export function sanitizeSavedFilters(value: unknown): SavedFilter[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: SavedFilter[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const { id, name, rule } = item as Record<string, unknown>;
    if (typeof id !== "string" || !id || seen.has(id) || typeof name !== "string" || !name.trim()) continue;
    seen.add(id);
    out.push({ id, name: name.trim().slice(0, 40), rule: sanitizeRule(rule) });
    if (out.length >= MAX_SAVED_FILTERS) break;
  }
  return out;
}

export const readSavedFilters = () => sanitizeSavedFilters(readJson<unknown>(savedFiltersKey, []));
export const writeSavedFilters = (filters: SavedFilter[]) => { writeJson(savedFiltersKey, filters); };
