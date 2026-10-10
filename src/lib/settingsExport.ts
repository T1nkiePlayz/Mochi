/**
 * Portable settings export/import: what goes into the zip (an explicit ALLOWLIST of sections and fields; secrets
 * never qualify) and how an imported file is merged into, or replaces, what is on this device. Pure logic only;
 * `settingsTransfer.ts` talks to the app and the native commands.
 */
import type { Collection, LaunchOptions, Piko } from "../models";
import { normalizeBehavior, type Behavior } from "../state/settings";
import { normalizeSoundSettings, type SoundSettings } from "./sound/settings";
import { normalizeControllerSettings, type ControllerSettings } from "../controller/settings";
import { normalizeAccessibility, type Accessibility } from "../state/accessibility";
import { sameWish, sanitizeWishlist, WISHLIST_LIMIT, type WishlistItem } from "./wishlist";
import { sanitizeOverrides, type KindOverrides } from "./launcherOverrides";
import { normalizeViewMode, type LibraryViewMode } from "./libraryView";

export const SETTINGS_FORMAT = "mochi-settings";
export const SETTINGS_VERSION = 1;

export const SECTION_IDS = ["behavior", "appearance", "sound", "controller", "accessibility", "collections", "wishlist", "launcherOverrides", "games"] as const;
export type SectionId = (typeof SECTION_IDS)[number];
export type ImportMode = "merge" | "replace";

export const sectionInfo: Record<SectionId, { label: string; detail: string; modes: boolean }> = {
  behavior: { label: "General settings", detail: "Launch, notification, update, metadata and mod source preferences.", modes: false },
  appearance: { label: "Appearance", detail: "Selected theme, library view and sort order.", modes: false },
  sound: { label: "Sounds", detail: "Volume, toggles and the chosen sound pack (pack files are not included).", modes: false },
  controller: { label: "Controller", detail: "Dead zone, repeat speed, prompts and button swap.", modes: false },
  accessibility: { label: "Accessibility", detail: "Text size, motion, contrast and focus options.", modes: false },
  collections: { label: "Collections", detail: "Your collection names, icons and order.", modes: true },
  wishlist: { label: "Wishlist", detail: "Games you want but do not own.", modes: true },
  launcherOverrides: { label: "Launcher corrections", detail: "Your game or launcher detection fixes.", modes: true },
  games: { label: "Per-game data", detail: "Launch options, tags, collection membership and backlog status, matched to games you already have.", modes: true },
};

/** Names that look like credentials. Anything matching is never exported unless listed in `NON_SECRET_NAMES`. */
export const SECRET_PATTERN = /token|secret|key|password|passwd|auth|session|credential|bearer|cookie|signature/i;
/** Field names that match the pattern but are plain data (an import identifier, not a key to anything). */
export const NON_SECRET_NAMES = new Set(["importKey"]);
export const isSecretName = (name: string): boolean => SECRET_PATTERN.test(name) && !NON_SECRET_NAMES.has(name);

/**
 * The ONLY localStorage keys the export reads. Everything else (Supabase `sb-*` sessions, provider keys, caches,
 * the library itself, notifications, accounts) is left out by construction. A test asserts none of these look secret.
 */
export const EXPORT_STORAGE_KEYS = {
  theme: "mochi:theme",
  librarySort: "mochi:library-sort",
  libraryView: "mochi:library-view",
  sound: "mochi:sound",
  controller: "mochi:controller",
  accessibility: "mochi:accessibility",
  collections: "mochi:collections",
  wishlist: "mochi:wishlist",
  launcherOverrides: "mochi:launcher-overrides",
} as const;

const SORTS = ["category", "name", "recent", "playtime"] as const;
export type LibrarySortChoice = (typeof SORTS)[number];

export type AppearanceData = { theme: string; libraryView: LibraryViewMode; librarySort: LibrarySortChoice };
export type GameEntry = { id: string; importKey?: string; name?: string; launchOptions?: LaunchOptions; tags?: string[]; collectionIds?: string[]; backlog?: Piko["backlog"] };

/** Everything the export reads and the import changes, in one value. */
export type Snapshot = {
  behavior: Behavior;
  appearance: AppearanceData;
  sound: SoundSettings;
  controller: ControllerSettings;
  accessibility: Accessibility;
  collections: Collection[];
  wishlist: WishlistItem[];
  launcherOverrides: KindOverrides;
  library: Piko[];
};
export type SectionData = {
  behavior: Behavior; appearance: AppearanceData; sound: SoundSettings; controller: ControllerSettings; accessibility: Accessibility;
  collections: Collection[]; wishlist: WishlistItem[]; launcherOverrides: KindOverrides; games: GameEntry[];
};

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const str = (value: unknown, max = 200) => (typeof value === "string" ? value.slice(0, max) : "");
const strings = (value: unknown, max = 100) => (Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === "string" && item.length > 0 && item.length <= 200))].slice(0, max) : []);

/** Removes every property whose NAME looks like a credential (deeply). Map-like sections skip this (their keys are ids). */
export function scrubSecrets<T>(value: T): T {
  if (Array.isArray(value)) return value.map(scrubSecrets) as T;
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [name, inner] of Object.entries(value)) if (!isSecretName(name)) out[name] = scrubSecrets(inner);
  return out as T;
}

/** Paths of any credential-looking property names left in `value` (used by the export guard and by tests). */
export function findSecretPaths(value: unknown, path = ""): string[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => findSecretPaths(item, `${path}[${index}]`));
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([name, inner]) => (isSecretName(name) ? [`${path}.${name}`] : findSecretPaths(inner, `${path}.${name}`)));
}

/** A game's launch options without environment variables named like credentials (an API key in an env var must not travel). Null when nothing usable is left. */
export function sanitizeLaunchOptions(value: unknown): LaunchOptions | undefined {
  if (!isRecord(value)) return undefined;
  const env = (Array.isArray(value.env) ? value.env : [])
    .filter((pair): pair is [string, string] => Array.isArray(pair) && typeof pair[0] === "string" && typeof pair[1] === "string" && pair.length === 2)
    .filter(([name]) => /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name) && !isSecretName(name))
    .slice(0, 100).map(([name, val]): [string, string] => [name, val.slice(0, 2000)]);
  const out: LaunchOptions = { env, args: strings(value.args, 100) };
  if (typeof value.workingDir === "string" && value.workingDir) out.workingDir = value.workingDir.slice(0, 1000);
  const runtime = value.runtime;
  if (isRecord(runtime) && (runtime.kind === "native" || runtime.kind === "proton" || runtime.kind === "wine")) out.runtime = { kind: runtime.kind, ...(typeof runtime.id === "string" ? { id: runtime.id.slice(0, 500) } : {}) };
  if (typeof value.gamemode === "boolean") out.gamemode = value.gamemode;
  if (typeof value.mangohud === "boolean") out.mangohud = value.mangohud;
  const scope = value.gamescope;
  if (isRecord(scope) && typeof scope.enabled === "boolean") out.gamescope = { enabled: scope.enabled, args: strings(scope.args, 100) };
  return out;
}

const BACKLOG = ["want", "playing", "finished", "dropped"];
function sanitizeBacklog(value: unknown): Piko["backlog"] | undefined {
  if (!isRecord(value) || !BACKLOG.includes(value.status as string)) return undefined;
  return { status: value.status as NonNullable<Piko["backlog"]>["status"], ...(str(value.note, 500) ? { note: str(value.note, 500) } : {}), addedAt: typeof value.addedAt === "number" && Number.isFinite(value.addedAt) ? value.addedAt : 0 };
}

export function sanitizeCollections(value: unknown): Collection[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: Collection[] = [];
  for (const raw of value) {
    if (!isRecord(raw) || typeof raw.id !== "string" || !raw.id || seen.has(raw.id)) continue;
    const name = str(raw.name, 40).trim();
    if (!name) continue;
    seen.add(raw.id);
    out.push({ id: raw.id.slice(0, 100), name, ...(str(raw.icon, 16).trim() ? { icon: str(raw.icon, 16).trim() } : {}) });
  }
  return out.slice(0, 500);
}

export function sanitizeAppearance(raw: unknown, themeIds?: readonly string[]): AppearanceData {
  const stored = isRecord(raw) ? raw : {};
  const theme = typeof stored.theme === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(stored.theme) && (!themeIds || themeIds.includes(stored.theme)) ? stored.theme : "";
  return { theme, libraryView: normalizeViewMode(stored.libraryView), librarySort: SORTS.includes(stored.librarySort as LibrarySortChoice) ? (stored.librarySort as LibrarySortChoice) : "category" };
}

/** Per-game fields for games that have any, keyed by piko id and import key. */
export function buildGameEntries(library: readonly Piko[]): GameEntry[] {
  const out: GameEntry[] = [];
  for (const piko of library) {
    const launchOptions = sanitizeLaunchOptions(piko.launchOptions);
    const tags = strings(piko.tags);
    const collectionIds = strings(piko.collectionIds);
    const backlog = sanitizeBacklog(piko.backlog);
    if (!launchOptions && !tags.length && !collectionIds.length && !backlog) continue;
    out.push({ id: piko.id, ...(piko.importKey ? { importKey: piko.importKey } : {}), name: piko.name.slice(0, 120), ...(launchOptions ? { launchOptions } : {}), ...(tags.length ? { tags } : {}), ...(collectionIds.length ? { collectionIds } : {}), ...(backlog ? { backlog } : {}) });
  }
  return out;
}

export function sanitizeGameEntries(value: unknown): GameEntry[] {
  if (!Array.isArray(value)) return [];
  const out: GameEntry[] = [];
  for (const raw of value.slice(0, 20_000)) {
    if (!isRecord(raw) || typeof raw.id !== "string" || !raw.id) continue;
    const launchOptions = sanitizeLaunchOptions(raw.launchOptions);
    const tags = strings(raw.tags);
    const collectionIds = strings(raw.collectionIds);
    const backlog = sanitizeBacklog(raw.backlog);
    out.push({ id: raw.id, ...(typeof raw.importKey === "string" && raw.importKey ? { importKey: raw.importKey } : {}), ...(typeof raw.name === "string" ? { name: raw.name.slice(0, 120) } : {}), ...(launchOptions ? { launchOptions } : {}), ...(tags.length ? { tags } : {}), ...(collectionIds.length ? { collectionIds } : {}), ...(backlog ? { backlog } : {}) });
  }
  return out;
}

/** Builds the JSON of each selected section from the allowlisted data. Throws if anything credential-like slipped through. */
export function buildExportSections(snapshot: Snapshot, selected: readonly SectionId[]): Partial<Record<SectionId, unknown>> {
  const all: SectionData = {
    behavior: normalizeBehavior(snapshot.behavior),
    appearance: sanitizeAppearance(snapshot.appearance),
    sound: normalizeSoundSettings(snapshot.sound),
    controller: normalizeControllerSettings(snapshot.controller),
    accessibility: normalizeAccessibility(snapshot.accessibility),
    collections: sanitizeCollections(snapshot.collections),
    wishlist: sanitizeWishlist(snapshot.wishlist),
    launcherOverrides: sanitizeOverrides(snapshot.launcherOverrides),
    games: buildGameEntries(snapshot.library),
  };
  const out: Partial<Record<SectionId, unknown>> = {};
  for (const id of SECTION_IDS) if (selected.includes(id)) out[id] = id === "launcherOverrides" ? all[id] : scrubSecrets(all[id]);
  const { launcherOverrides: _ids, ...checked } = out;
  const leaked = findSecretPaths(checked);
  if (leaked.length) throw new Error(`Refusing to export credential-like fields: ${leaked.join(", ")}`);
  return out;
}

export type ManifestCheck = { ok: true } | { ok: false; error: string };
export function checkManifest(manifest: unknown): ManifestCheck {
  if (!isRecord(manifest) || manifest.format !== SETTINGS_FORMAT) return { ok: false, error: "This file is not a Mochi settings export." };
  if (typeof manifest.version !== "number" || !Number.isInteger(manifest.version) || manifest.version < 1) return { ok: false, error: "This export has an unsupported version." };
  if (manifest.version > SETTINGS_VERSION) return { ok: false, error: "This export was made by a newer version of Mochi. Update Mochi to import it." };
  return { ok: true };
}

/** Clean, typed section data from whatever the file held; sections that are missing stay undefined. */
export function sanitizeSections(raw: Record<string, unknown>, themeIds?: readonly string[]): Partial<SectionData> {
  const out: Partial<SectionData> = {};
  if (raw.behavior !== undefined) out.behavior = normalizeBehavior(raw.behavior);
  if (raw.appearance !== undefined) out.appearance = sanitizeAppearance(raw.appearance, themeIds);
  if (raw.sound !== undefined) out.sound = normalizeSoundSettings(raw.sound);
  if (raw.controller !== undefined) out.controller = normalizeControllerSettings(raw.controller);
  if (raw.accessibility !== undefined) out.accessibility = normalizeAccessibility(raw.accessibility);
  if (raw.collections !== undefined) out.collections = sanitizeCollections(raw.collections);
  if (raw.wishlist !== undefined) out.wishlist = sanitizeWishlist(raw.wishlist).slice(0, WISHLIST_LIMIT);
  if (raw.launcherOverrides !== undefined) out.launcherOverrides = sanitizeOverrides(raw.launcherOverrides);
  if (raw.games !== undefined) out.games = sanitizeGameEntries(raw.games);
  return out;
}

// ---- merge / replace -------------------------------------------------------------------------------------

export type Counts = { added: number; changed: number; removed: number; unchanged: number };
const zero = (): Counts => ({ added: 0, changed: 0, removed: 0, unchanged: 0 });

/** Merge: union by id. An incoming collection whose name matches an existing one (ignoring case) maps onto it instead of duplicating it. `idMap` translates incoming ids to the ids that end up stored. */
export function mergeCollections(current: Collection[], incoming: Collection[], mode: ImportMode): { items: Collection[]; idMap: Map<string, string>; counts: Counts } {
  const counts = zero();
  const idMap = new Map<string, string>();
  if (mode === "replace") {
    for (const item of incoming) idMap.set(item.id, item.id);
    const ids = new Set(current.map((item) => item.id));
    counts.added = incoming.filter((item) => !ids.has(item.id)).length;
    counts.removed = current.filter((item) => !incoming.some((other) => other.id === item.id)).length;
    counts.unchanged = incoming.length - counts.added;
    return { items: incoming, idMap, counts };
  }
  const items = [...current];
  for (const item of incoming) {
    const same = current.find((existing) => existing.id === item.id) ?? current.find((existing) => existing.name.toLowerCase() === item.name.toLowerCase());
    if (same) { idMap.set(item.id, same.id); counts.unchanged++; continue; }
    items.push(item); idMap.set(item.id, item.id); counts.added++;
  }
  return { items, idMap, counts };
}

export function mergeWishlist(current: WishlistItem[], incoming: WishlistItem[], mode: ImportMode): { items: WishlistItem[]; counts: Counts } {
  const counts = zero();
  if (mode === "replace") {
    counts.added = incoming.filter((item) => !current.some((existing) => existing.id === item.id || sameWish(existing, item))).length;
    counts.removed = current.filter((item) => !incoming.some((other) => other.id === item.id || sameWish(other, item))).length;
    counts.unchanged = incoming.length - counts.added;
    return { items: incoming, counts };
  }
  const items = [...current];
  for (const item of incoming) {
    if (items.some((existing) => existing.id === item.id || sameWish(existing, item))) { counts.unchanged++; continue; }
    if (items.length >= WISHLIST_LIMIT) break;
    items.push(item); counts.added++;
  }
  return { items, counts };
}

/** Merge keeps what is already set on this device and adds the missing keys; replace takes the file's map as is. */
export function mergeOverrides(current: KindOverrides, incoming: KindOverrides, mode: ImportMode): { items: KindOverrides; counts: Counts } {
  const counts = zero();
  if (mode === "replace") {
    for (const key of Object.keys(incoming)) { if (!(key in current)) counts.added++; else if (current[key] !== incoming[key]) counts.changed++; else counts.unchanged++; }
    counts.removed = Object.keys(current).filter((key) => !(key in incoming)).length;
    return { items: { ...incoming }, counts };
  }
  const items = { ...current };
  for (const [key, kind] of Object.entries(incoming)) { if (key in items) counts.unchanged++; else { items[key] = kind; counts.added++; } }
  return { items, counts };
}

/** Matches by piko id first, then by import key. */
function findPiko(library: readonly Piko[], entry: GameEntry): number {
  const byId = library.findIndex((piko) => piko.id === entry.id);
  if (byId >= 0 || !entry.importKey) return byId;
  return library.findIndex((piko) => piko.importKey === entry.importKey);
}

/**
 * Applies per-game fields to matching games. Merge only fills gaps (tags and collections are unioned, launch options
 * and backlog are kept when already set); replace overwrites those four fields on matched games. Games that are not in
 * the library are skipped (the library itself is cloud sync's job). Collection ids are translated with `idMap` and
 * dropped when no such collection exists.
 */
export function applyGameEntries(library: Piko[], entries: GameEntry[], mode: ImportMode, idMap: ReadonlyMap<string, string>, collectionIds: ReadonlySet<string>): { library: Piko[]; matched: number; unmatched: number; changed: number } {
  const next = [...library];
  let matched = 0, unmatched = 0, changed = 0;
  for (const entry of entries) {
    const index = findPiko(next, entry);
    if (index < 0) { unmatched++; continue; }
    matched++;
    const piko = next[index]!;
    const incomingCollections = (entry.collectionIds ?? []).map((id) => idMap.get(id) ?? id).filter((id) => collectionIds.has(id));
    const update: Piko = { ...piko };
    const set = <K extends "launchOptions" | "tags" | "collectionIds" | "backlog">(key: K, value: Piko[K] | undefined) => { if (value === undefined || (Array.isArray(value) && value.length === 0)) delete update[key]; else update[key] = value; };
    if (mode === "replace") {
      set("launchOptions", entry.launchOptions); set("tags", entry.tags); set("collectionIds", incomingCollections); set("backlog", entry.backlog);
    } else {
      if (!piko.launchOptions) set("launchOptions", entry.launchOptions);
      if (!piko.backlog) set("backlog", entry.backlog);
      set("tags", [...new Set([...(piko.tags ?? []), ...(entry.tags ?? [])])]);
      set("collectionIds", [...new Set([...(piko.collectionIds ?? []), ...incomingCollections])]);
    }
    if (JSON.stringify(update) !== JSON.stringify(piko)) { next[index] = update; changed++; }
  }
  return { library: next, matched, unmatched, changed };
}

// ---- the whole import ------------------------------------------------------------------------------------

export type Selection = Partial<Record<SectionId, { enabled: boolean; mode: ImportMode }>>;
export type SectionSummary = { id: SectionId; lines: string[] };
export type ImportResult = { next: Snapshot; changed: SectionId[]; summary: SectionSummary[] };

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
function describe(counts: Counts, noun: string): string[] {
  const lines: string[] = [];
  if (counts.added) lines.push(`${plural(counts.added, noun)} added`);
  if (counts.changed) lines.push(`${plural(counts.changed, noun)} changed`);
  if (counts.removed) lines.push(`${plural(counts.removed, noun)} removed`);
  if (!lines.length) lines.push("No changes");
  return lines;
}
const differs = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b);

/** Computes what the import would produce, without touching anything. `sections` must already be sanitized. */
export function planImport(current: Snapshot, sections: Partial<SectionData>, selection: Selection): ImportResult {
  const next: Snapshot = { ...current };
  const summary: SectionSummary[] = [];
  const changed: SectionId[] = [];
  const chosen = (id: SectionId) => (sections[id] !== undefined && selection[id]?.enabled ? selection[id]!.mode : null);
  const scalar = <K extends "behavior" | "sound" | "controller" | "accessibility">(id: K, label: string) => {
    if (!chosen(id)) return;
    const incoming = sections[id] as Snapshot[K];
    next[id] = incoming;
    const keys = Object.keys(incoming as object).filter((key) => differs((incoming as Record<string, unknown>)[key], (current[id] as Record<string, unknown>)[key]));
    summary.push({ id, lines: keys.length ? [`${plural(keys.length, `${label} setting`)} changed`] : ["No changes"] });
    if (keys.length) changed.push(id);
  };
  scalar("behavior", "general"); scalar("sound", "sound"); scalar("controller", "controller"); scalar("accessibility", "accessibility");
  if (chosen("appearance")) {
    const incoming = sections.appearance!;
    const merged: AppearanceData = { theme: incoming.theme || current.appearance.theme, libraryView: incoming.libraryView, librarySort: incoming.librarySort };
    next.appearance = merged;
    const lines = (["theme", "libraryView", "librarySort"] as const).filter((key) => merged[key] !== current.appearance[key]).map((key) => `${key === "theme" ? "Theme" : key === "libraryView" ? "Library view" : "Sort order"}: ${merged[key]}`);
    summary.push({ id: "appearance", lines: lines.length ? lines : ["No changes"] });
    if (lines.length) changed.push("appearance");
  }
  let idMap: ReadonlyMap<string, string> = new Map();
  const collectionMode = chosen("collections");
  if (collectionMode) {
    const result = mergeCollections(current.collections, sections.collections!, collectionMode);
    next.collections = result.items; idMap = result.idMap;
    summary.push({ id: "collections", lines: describe(result.counts, "collection") });
    if (result.counts.added || result.counts.removed || differs(result.items, current.collections)) changed.push("collections");
  }
  const wishMode = chosen("wishlist");
  if (wishMode) {
    const result = mergeWishlist(current.wishlist, sections.wishlist!, wishMode);
    next.wishlist = result.items;
    summary.push({ id: "wishlist", lines: describe(result.counts, "game") });
    if (differs(result.items, current.wishlist)) changed.push("wishlist");
  }
  const overrideMode = chosen("launcherOverrides");
  if (overrideMode) {
    const result = mergeOverrides(current.launcherOverrides, sections.launcherOverrides!, overrideMode);
    next.launcherOverrides = result.items;
    summary.push({ id: "launcherOverrides", lines: describe(result.counts, "correction") });
    if (differs(result.items, current.launcherOverrides)) changed.push("launcherOverrides");
  }
  const gameMode = chosen("games");
  if (gameMode) {
    // Collections the library can reference afterwards: the (possibly merged) list, or the current one when not imported.
    const known = new Set(next.collections.map((item) => item.id));
    const result = applyGameEntries(current.library, sections.games!, gameMode, idMap, known);
    next.library = result.library;
    const lines = [`${plural(result.changed, "game")} updated`];
    if (result.unmatched) lines.push(`${plural(result.unmatched, "game")} not in your library (skipped)`);
    summary.push({ id: "games", lines });
    if (result.changed) changed.push("games");
  }
  return { next, changed, summary };
}
