import { invoke } from "@tauri-apps/api/core";
import type { Piko, Tofu } from "../models";
import { normalizeName, storeKey } from "./duplicates";
import { steamAppIdOf } from "./metadata/merge";
import { detectImportSources, scanImportGames, type ImportedGame } from "./sources";

/** Which path of a game a slot is. `tofu*` fields belong to the Tofu named by `tofuId`. */
export type PathField = "executablePath" | "installPath" | "workingDir" | "tofuPath" | "tofuGameDir" | "tofuContentRoot" | "tofuInstallPath";
export type PathSlot = { gameId: string; tofuId?: string; field: PathField; path: string };

export type NewPaths = { executablePath?: string; installPath?: string };
export type RemapMatch = { gameId: string; newPaths: NewPaths; confidence: "store-id" | "name"; matched: Pick<ImportedGame, "id" | "name" | "source"> };

/** An absolute path on this device. Launcher URIs (`steam://`, `heroic://`), desktop ids and relative text are not checkable. */
export const isLocalPath = (value: string | undefined | null): value is string => {
  const text = (value ?? "").trim();
  return text.startsWith("/") && !text.includes("://");
};

const tofuSlots = (gameId: string, tofu: Tofu): PathSlot[] => {
  const out: PathSlot[] = [];
  const add = (field: PathField, path: string | undefined) => { if (isLocalPath(path)) out.push({ gameId, tofuId: tofu.id, field, path }); };
  add("tofuPath", tofu.path); add("tofuGameDir", tofu.gameDir); add("tofuContentRoot", tofu.contentRoot); add("tofuInstallPath", tofu.installPath);
  return out;
};

/** Every local path a game and its Tofus point at (executable, install folder, working directory, mod folders). URI targets are skipped. */
export function collectPaths(library: readonly Piko[]): PathSlot[] {
  const out: PathSlot[] = [];
  for (const piko of library) {
    if (piko.id === "__empty") continue;
    const add = (field: PathField, path: string | undefined) => { if (isLocalPath(path)) out.push({ gameId: piko.id, field, path }); };
    add("executablePath", piko.executablePath); add("installPath", piko.installPath); add("workingDir", piko.launchOptions?.workingDir);
    for (const tofu of piko.tofus ?? []) out.push(...tofuSlots(piko.id, tofu));
  }
  return out;
}

/** Native existence check; resolves to "everything exists" when the command is unavailable (browser/development mode). */
export async function pathsExist(paths: string[]): Promise<boolean[]> {
  if (!paths.length) return [];
  try { return await invoke<boolean[]>("paths_exist", { paths }); } catch { return paths.map(() => true); }
}

/** The slots whose path does not exist on this device, grouped by game id. */
export async function findMissing(library: readonly Piko[], exists: (paths: string[]) => Promise<boolean[]> = pathsExist): Promise<Map<string, PathSlot[]>> {
  const slots = collectPaths(library);
  const unique = [...new Set(slots.map((slot) => slot.path))];
  const found = await exists(unique);
  const gone = new Set(unique.filter((_, index) => found[index] === false));
  const missing = new Map<string, PathSlot[]>();
  for (const slot of slots) if (gone.has(slot.path)) missing.set(slot.gameId, [...(missing.get(slot.gameId) ?? []), slot]);
  return missing;
}

/** Store identities readable from a launch target beyond what `storeKey` knows (Lutris, Epic launcher, itch, desktop entries). */
function targetKeys(target: string | undefined, source: string | undefined): string[] {
  const text = (target ?? "").trim();
  const keys: string[] = [];
  const base = storeKey(text);
  if (base) keys.push(base);
  const lutris = /^lutris:rungameid\/([^/?#\s]+)/i.exec(text);
  if (lutris) keys.push(`lutris:${lutris[1]}`);
  const epic = /^com\.epicgames\.launcher:\/\/apps\/([^/?#\s]+)/i.exec(text);
  if (epic) keys.push(`epic:${epic[1]}`);
  const itch = /^itch:\/\/(?:run-game|games)\/(\d+)/i.exec(text);
  if (itch) keys.push(`itch:${itch[1]}`);
  // A desktop entry's id is its file name (`apps:<file>.desktop`).
  if (source === "apps" && isLocalPath(text) && text.endsWith(".desktop")) keys.push(`apps:${text.slice(text.lastIndexOf("/") + 1)}`);
  return keys;
}

/** Every store identity a library game is known by (source plus store id), from its fields; all are source-prefixed. */
export function gameKeys(piko: Piko): Set<string> {
  const keys = new Set<string>();
  if (piko.importKey) keys.add(piko.importKey);
  const appId = steamAppIdOf(piko);
  if (appId !== null) keys.add(`steam:${appId}`);
  for (const target of [piko.executablePath, ...(piko.launchSources ?? []).map((source) => source.executablePath)]) for (const key of targetKeys(target, piko.sourceId)) keys.add(key);
  for (const source of piko.launchSources ?? []) if (source.importKey) keys.add(source.importKey);
  return keys;
}

const scannedKeys = (game: ImportedGame): string[] => [game.id, ...targetKeys(game.launchTarget, game.source)];

const proposal = (piko: Piko, game: ImportedGame, confidence: RemapMatch["confidence"]): RemapMatch | null => {
  const newPaths: NewPaths = {};
  if (game.launchTarget && game.launchTarget !== piko.executablePath) newPaths.executablePath = game.launchTarget;
  if (game.installPath && game.installPath !== piko.installPath) newPaths.installPath = game.installPath;
  if (!newPaths.executablePath && !newPaths.installPath) return null;
  return { gameId: piko.id, newPaths, confidence, matched: { id: game.id, name: game.name, source: game.source } };
};

/**
 * Proposes new paths for games whose files are missing from what an import scan found now. A match by store identity
 * (source plus store id: Steam appid, Heroic app name, Lutris slug, GOG/itch/Flatpak id...) is `store-id`; otherwise an
 * exact normalized name match from the same source (any source for a game with none) is a lower-confidence `name` match,
 * offered only when the name is unambiguous. Different sources never match by id.
 */
export function matchMissingGames(missing: readonly Piko[], scanned: readonly ImportedGame[]): RemapMatch[] {
  const games = scanned.filter((game) => game.kind !== "launcher");
  const byKey = new Map<string, ImportedGame[]>();
  for (const game of games) for (const key of new Set(scannedKeys(game))) byKey.set(key, [...(byKey.get(key) ?? []), game]);
  const byName = new Map<string, ImportedGame[]>();
  for (const game of games) { const name = normalizeName(game.name); if (name) byName.set(name, [...(byName.get(name) ?? []), game]); }

  const out: RemapMatch[] = [];
  for (const piko of missing) {
    let hit: RemapMatch | null = null;
    for (const key of gameKeys(piko)) {
      const candidates = byKey.get(key) ?? [];
      if (candidates.length === 1) { hit = proposal(piko, candidates[0], "store-id"); if (hit) break; }
    }
    if (!hit) {
      const candidates = (byName.get(normalizeName(piko.name)) ?? []).filter((game) => !piko.sourceId || game.source === piko.sourceId);
      if (candidates.length === 1) hit = proposal(piko, candidates[0], "name");
    }
    if (hit) out.push(hit);
  }
  return out;
}

/** Runs the import scan for every detected source (the same scan the Import dialog and the library watcher use). */
export async function scanInstalledGames(): Promise<ImportedGame[]> {
  const detected = (await detectImportSources()).filter((source) => source.detected);
  const scans = await Promise.all(detected.map((source) => scanImportGames(source.id).catch(() => [] as ImportedGame[])));
  return scans.flat();
}

/**
 * The edit that points a game at `newPaths` on this device. Paths sync like other metadata, so the cloud copy of the
 * executable path is kept in `pathOverride.cloudValue`: this device launches the new path while the other machines keep
 * seeing the one they synced (see `cloud.ts`). Returns null when nothing changes.
 */
export function applyNewPaths(piko: Piko, newPaths: NewPaths): Partial<Piko> | null {
  const changes: Partial<Piko> = {};
  if (newPaths.installPath && newPaths.installPath !== piko.installPath) changes.installPath = newPaths.installPath;
  const exe = newPaths.executablePath;
  if (exe && exe !== piko.executablePath) {
    const cloudValue = piko.pathOverride && piko.pathOverride.executablePath === piko.executablePath ? piko.pathOverride.cloudValue : piko.executablePath;
    changes.executablePath = exe;
    changes.pathOverride = cloudValue !== undefined && cloudValue !== exe ? { executablePath: exe, cloudValue } : undefined;
  }
  return Object.keys(changes).length ? changes : null;
}

/** The edit for a path the user picked by hand for one slot. */
export function applyLocated(piko: Piko, slot: PathSlot, picked: string): Partial<Piko> | null {
  switch (slot.field) {
    case "executablePath": return applyNewPaths(piko, { executablePath: picked });
    case "installPath": return picked === piko.installPath ? null : { installPath: picked };
    case "workingDir": return { launchOptions: { env: [], args: [], ...piko.launchOptions, workingDir: picked } };
    default: {
      const key = { tofuPath: "path", tofuGameDir: "gameDir", tofuContentRoot: "contentRoot", tofuInstallPath: "installPath" }[slot.field] as keyof Tofu;
      return { tofus: piko.tofus.map((tofu) => (tofu.id === slot.tofuId ? { ...tofu, [key]: picked } : tofu)) };
    }
  }
}

/** True for slots a file (not a folder) is expected at. */
export const slotWantsFile = (slot: PathSlot) => slot.field === "executablePath";
