// Required dependencies of a mod: what has to be installed first, what is already there, what only the user can fetch.
// No Tauri or React imports: every network call goes through the `ModSource` object, so this is unit testable with fakes.
import { compatibility, metaFromModFile, type TofuTarget } from "./compat";
import { pickBestFile } from "./helpers";
import type { ModDependency, ModFile, ModItem, ModSource } from "./types";

/** Installed-file facts the resolver needs; `ModRecord` fits. */
export type InstalledRecord = { source: string; projectId: string; sha1?: string; title?: string; version?: string };

/**
 * install: Mochi downloads it. already-installed: a record has the same project (or the same file hash).
 * unavailable: no file fits, the author blocks third-party downloads, or the site must be used by hand (open `pageUrl`).
 * external: a requirement outside this source (Nexus requirement on another site or game): only a link.
 */
export type DependencyStatus = "install" | "already-installed" | "unavailable" | "external";

export type DependencyEntry = {
  /** `provider:projectId`, unique within a plan. */
  key: string;
  status: DependencyStatus;
  name: string;
  pageUrl: string;
  /** Set for "install" (and "unavailable" after a lookup): the listing and chosen file. */
  item?: ModItem;
  file?: ModFile;
  /** Version shown to the user: the chosen file's, or the installed one's. */
  version?: string;
  /** Why it cannot be installed (unavailable / external). */
  reason?: string;
  /** Name of the mod (or dependency) that asked for it. */
  requiredBy: string;
  depth: number;
};

export type DependencyWarning = { kind: "incompatible"; name: string; pageUrl: string; installedTitle: string; /** The mod that declares the conflict. */ declaredBy: string };

export type DependencyPlan = {
  /** Dependencies, nearest to the mod first. Install them in reverse so deeper ones land first. */
  entries: DependencyEntry[];
  warnings: DependencyWarning[];
  /** Things Mochi could not check (a failed lookup); shown, never silent. */
  notes: string[];
  /** The depth or count cap stopped the search. */
  truncated: boolean;
};

export const MAX_DEPTH = 8;
export const MAX_DEPENDENCIES = 50;
export const DEPENDENCY_CONCURRENCY = 3;

export type ResolveOptions = {
  source: ModSource;
  item: ModItem;
  /** The file about to be installed. */
  file: ModFile;
  /** The Tofu's game version and loader; files that clearly do not fit are skipped. Omit for games without them. */
  target?: TofuTarget;
  /** The same narrowing as `source.files(item, filter)`. */
  filter?: { gameVersion?: string; loader?: string };
  records: readonly InstalledRecord[];
  /** `provider:projectId` of downloads under way, treated as installed. */
  pending?: ReadonlySet<string>;
  signal?: AbortSignal;
  maxDepth?: number;
  maxDependencies?: number;
  concurrency?: number;
};

const errorText = (error: unknown) => error instanceof Error ? error.message : "The lookup failed.";
const keyOf = (provider: string, id: string) => `${provider}:${id}`;

type Queued = { dependency: ModDependency; depth: number; parent: string };

/** The best file of a list for a Tofu: files that clearly do not fit are dropped, a pinned version wins, else newest stable. */
export function pickDependencyFile(files: readonly ModFile[], target?: TofuTarget, pinnedId?: string): ModFile | undefined {
  const narrowed = Boolean(target?.gameVersion || target?.loader);
  const fitting = narrowed ? files.filter((file) => compatibility(metaFromModFile(file), target as TofuTarget).status !== "incompatible") : files;
  const pinned = pinnedId ? fitting.find((file) => file.id === pinnedId) : undefined;
  if (pinned) return pinned;
  // A file that matches exactly beats one that only "may work".
  const exact = narrowed ? fitting.filter((file) => compatibility(metaFromModFile(file), target as TofuTarget).status === "compatible") : fitting;
  const ranked = (exact.length ? exact : fitting).map((file) => ({ file, releaseType: file.channel === "release" || !file.channel ? 1 : file.channel === "beta" ? 2 : 3, fileDate: file.date }));
  return pickBestFile(ranked)?.file;
}

/** Runs `work` over `items` with at most `limit` in flight. Results keep the order of `items`. */
async function pool<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (next < items.length) { const index = next; next += 1; out[index] = await work(items[index]); }
  }));
  return out;
}

/**
 * Builds the install plan for the required dependencies of `file` (recursively). Visits each project once (cycles end there),
 * stops at `maxDepth` levels and `maxDependencies` entries, and looks things up at most `concurrency` at a time. A failed lookup
 * turns that one dependency into "unavailable" and never fails the whole plan. Nothing is downloaded or written here.
 */
export async function resolveDependencies(options: ResolveOptions): Promise<DependencyPlan> {
  const { source, item, file, target, filter, records, signal } = options;
  const maxDepth = options.maxDepth ?? MAX_DEPTH;
  const maxCount = options.maxDependencies ?? MAX_DEPENDENCIES;
  const limit = options.concurrency ?? DEPENDENCY_CONCURRENCY;
  const plan: DependencyPlan = { entries: [], warnings: [], notes: [], truncated: false };
  const visited = new Set<string>([keyOf(source.id, item.id)]);
  const warned = new Set<string>();
  const memo = new Map<string, Promise<unknown>>();
  const once = <T>(key: string, load: () => Promise<T>) => { let hit = memo.get(key) as Promise<T> | undefined; if (!hit) { hit = load(); memo.set(key, hit); } return hit; };
  const installedHashes = new Set(records.flatMap((record) => record.sha1 ? [record.sha1.toLowerCase()] : []));
  const aborted = () => signal?.aborted === true;

  const installedRecord = (id: string) => records.find((record) => record.source === source.id && record.projectId === id);

  const warnIncompatible = (list: readonly ModDependency[] | undefined, declaredBy: string) => {
    for (const conflict of list ?? []) {
      const record = installedRecord(conflict.id);
      const key = `${declaredBy}>${conflict.id}`;
      if (!record || warned.has(key)) continue;
      warned.add(key);
      plan.warnings.push({ kind: "incompatible", name: conflict.name ?? record.title ?? `mod ${conflict.id}`, pageUrl: conflict.url, installedTitle: record.title ?? conflict.name ?? `mod ${conflict.id}`, declaredBy });
    }
  };

  /** Direct requirements of one chosen file: the file's own list plus the source's mod-level list (Nexus). */
  const requirementsOf = async (owner: ModItem, ownerFile: ModFile): Promise<ModDependency[]> => {
    const own = ownerFile.dependencies ?? [];
    warnIncompatible(ownerFile.incompatibles, owner.name);
    if (!source.requirements) return own;
    try {
      const extra = await once(`req:${owner.id}`, () => source.requirements!(owner));
      warnIncompatible(extra.incompatible, owner.name);
      const seen = new Set(own.map((dependency) => dependency.id));
      return [...own, ...extra.required.filter((dependency) => !seen.has(dependency.id))];
    } catch (error) {
      plan.notes.push(`Could not read the requirements of ${owner.name}: ${errorText(error)}`);
      return own;
    }
  };

  const lookup = async ({ dependency, depth, parent }: Queued): Promise<{ entry: DependencyEntry; next: Queued[] } | null> => {
    const key = keyOf(source.id, dependency.id);
    const base = { key, requiredBy: parent, depth, name: dependency.name ?? `mod ${dependency.id}`, pageUrl: dependency.url };
    if (dependency.external || !source.dependencyItem) return { entry: { ...base, status: "external", reason: "Get this one yourself from its page." }, next: [] };
    const installed = installedRecord(dependency.id);
    if (installed || options.pending?.has(key)) return { entry: { ...base, status: "already-installed", name: installed?.title ?? base.name, version: installed?.version }, next: [] };
    let depItem: ModItem | null;
    try { depItem = await once(`item:${dependency.id}`, () => source.dependencyItem!(dependency)); }
    catch (error) { return { entry: { ...base, status: "unavailable", reason: `Could not look it up: ${errorText(error)}` }, next: [] }; }
    if (!depItem) return { entry: { ...base, status: "external", reason: "Get this one yourself from its page." }, next: [] };
    const named = { ...base, name: depItem.name, pageUrl: depItem.pageUrl || base.pageUrl, item: depItem };
    let files: ModFile[];
    try { files = await once(`files:${dependency.id}`, () => source.files(depItem!, filter)); }
    catch (error) { return { entry: { ...named, status: "unavailable", reason: `Could not list its files: ${errorText(error)}` }, next: [] }; }
    const chosen = pickDependencyFile(files, target, dependency.versionId);
    if (!chosen) {
      const wanted = [filter?.loader, filter?.gameVersion].filter(Boolean).join(" ");
      return { entry: { ...named, status: "unavailable", reason: wanted ? `No file fits ${wanted}.` : "No file was found." }, next: [] };
    }
    const version = chosen.version ?? chosen.name;
    try {
      const resolved = await once(`dl:${dependency.id}:${chosen.id}`, () => source.resolveDownload(depItem!, chosen));
      if (resolved.sha1 && installedHashes.has(resolved.sha1.toLowerCase())) return { entry: { ...named, status: "already-installed", version }, next: [] };
      if (resolved.restricted || resolved.needsPremium || !resolved.url) return { entry: { ...named, file: chosen, version, pageUrl: resolved.pageUrl || named.pageUrl, status: "unavailable", reason: resolved.reason ?? "This file has to be downloaded on the site." }, next: [] };
    } catch (error) { return { entry: { ...named, file: chosen, version, status: "unavailable", reason: `Could not prepare the download: ${errorText(error)}` }, next: [] }; }
    const children = await requirementsOf(depItem, chosen);
    return { entry: { ...named, file: chosen, version, status: "install" }, next: children.map((child) => ({ dependency: child, depth: depth + 1, parent: depItem!.name })) };
  };

  let level: Queued[] = (await requirementsOf(item, file)).map((dependency) => ({ dependency, depth: 1, parent: item.name }));
  while (level.length && !aborted()) {
    const batch: Queued[] = [];
    for (const queued of level) {
      const key = keyOf(source.id, queued.dependency.id);
      if (visited.has(key)) continue;
      if (queued.depth > maxDepth || plan.entries.length + batch.length >= maxCount) { plan.truncated = true; continue; }
      visited.add(key);
      batch.push(queued);
    }
    const results = await pool(batch, limit, lookup);
    level = [];
    for (const result of results) { if (!result) continue; plan.entries.push(result.entry); level.push(...result.next); }
  }
  return plan;
}

/** True when the sheet has something to say; otherwise the mod installs straight away. */
export const planNeedsConfirmation = (plan: DependencyPlan): boolean => plan.entries.length > 0 || plan.warnings.length > 0 || plan.notes.length > 0 || plan.truncated;

/** The entries the user can choose to install (what "Install N" counts). */
export const installable = (plan: DependencyPlan): DependencyEntry[] => plan.entries.filter((entry) => entry.status === "install" && entry.item && entry.file);

/** Entries in install order: the deepest dependencies first, the mod itself last. */
export const installOrder = (entries: readonly DependencyEntry[]): DependencyEntry[] => [...entries].sort((a, b) => b.depth - a.depth);
