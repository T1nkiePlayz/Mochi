// Pure helpers: where does a download or a listing for a Tofu go? No runtime imports.
import type { Tofu } from "../../models";

export type ContentKind = "mod" | "resourcepack" | "shader";
export type Subdir = "resourcepacks" | "shaderpacks";
export type ContentFolder = { path: string; subdir?: Subdir };

const trimSlash = (path: string) => (path.length > 1 ? path.replace(/\/+$/, "") : path);
export const samePath = (a: string | undefined, b: string | undefined) => Boolean(a && b) && trimSlash(a as string) === trimSlash(b as string);

/** Does this Tofu keep its own copy of the mods, synced into the game's folder when the game starts? */
export function hasSeparateStore(tofu: Pick<Tofu, "path" | "gameDir">): boolean {
  return Boolean(tofu.path && tofu.gameDir && !samePath(tofu.path, tofu.gameDir));
}

/** Content kind of a listed item from its source's label ("Mods", "Resource Packs", "Shaders"). */
export function contentKindOf(label: string | undefined): ContentKind {
  const text = (label ?? "").toLowerCase();
  if (text.includes("resource")) return "resourcepack";
  if (text.includes("shader")) return "shader";
  return "mod";
}

/**
 * The folder for one kind of content, or undefined when the Tofu has none yet.
 * - Mods go to the Tofu folder.
 * - Resource packs and shaders go beside `mods`: straight into the game folder when the Tofu works on it directly,
 *   or into the Tofu's own store (synced at launch) when it keeps mods apart.
 * - Without a known game folder everything stays in the Tofu folder, as before.
 */
export function contentFolder(tofu: Pick<Tofu, "path" | "gameDir" | "contentRoot">, kind: ContentKind): ContentFolder | undefined {
  if (!tofu.path) return undefined;
  if (kind === "mod") return { path: tofu.path };
  const subdir: Subdir = kind === "resourcepack" ? "resourcepacks" : "shaderpacks";
  if (hasSeparateStore(tofu)) return { path: tofu.path, subdir };
  if (tofu.contentRoot) return { path: tofu.contentRoot, subdir };
  return { path: tofu.path };
}

/** A game's Tofus that share the game folder of `tofu` (it included), or just `tofu` when it is alone there. */
export function tofusSharing(tofus: readonly Tofu[], tofu: Tofu): Tofu[] {
  if (!tofu.gameDir) return [tofu];
  return tofus.filter((other) => other.id === tofu.id || samePath(other.gameDir, tofu.gameDir));
}

type SyncRequest = {
  tofuId: string; storeDir: string; gameDir: string; contentRoot?: string; adoptUnmanaged?: boolean;
  /** Every Tofu on this game folder: switching enables the active one's mods and disables the others' (and writes `.mochi/tofus.json`). */
  tofus?: Array<{ id: string; name: string; path?: string; version?: string; loader?: string }>;
};

/**
 * What to apply when `tofu` becomes the active Tofu (at launch or on a switch), or undefined when there is nothing to do:
 * a Tofu with its own store is synced into the game folder; Tofus sharing a game folder swap their mods in place.
 * `siblings` are all of the game's Tofus (pass `piko.tofus`).
 */
export function modSyncFor(tofu: Tofu | undefined, siblings: readonly Tofu[] = []): SyncRequest | undefined {
  if (!tofu?.path || !tofu.gameDir) return undefined;
  const sharing = tofusSharing(siblings.length ? siblings : [tofu], tofu);
  const shared = sharing.length > 1;
  if (!hasSeparateStore(tofu) && !shared) return undefined;
  const request: SyncRequest = { tofuId: tofu.id, storeDir: tofu.path, gameDir: tofu.gameDir, contentRoot: tofu.contentRoot || undefined, adoptUnmanaged: tofu.syncReplaceExisting === true ? true : undefined };
  if (shared) request.tofus = sharing.map((other) => ({ id: other.id, name: other.name, path: other.path, version: other.version, loader: other.loader }));
  return JSON.parse(JSON.stringify(request)) as SyncRequest;
}

/** The request that only saves `.mochi/tofus.json` for a Tofu with a game folder (any number of Tofus). */
export function manifestRequestFor(tofu: Tofu, siblings: readonly Tofu[]): SyncRequest | undefined {
  if (!tofu.path || !tofu.gameDir) return undefined;
  const sharing = tofusSharing(siblings, tofu);
  return { tofuId: tofu.id, storeDir: tofu.path, gameDir: tofu.gameDir, tofus: sharing.map((other) => ({ id: other.id, name: other.name, path: other.path, version: other.version, loader: other.loader })) };
}
