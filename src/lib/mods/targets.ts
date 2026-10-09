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

/** The sync request sent with a launch, or undefined when the Tofu has nothing to sync. */
export function modSyncFor(tofu: Tofu | undefined): { tofuId: string; storeDir: string; gameDir: string; contentRoot?: string; adoptUnmanaged?: boolean } | undefined {
  if (!tofu || !hasSeparateStore(tofu)) return undefined;
  return { tofuId: tofu.id, storeDir: tofu.path as string, gameDir: tofu.gameDir as string, contentRoot: tofu.contentRoot || undefined, adoptUnmanaged: tofu.syncReplaceExisting === true ? true : undefined };
}
