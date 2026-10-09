// Applies a pack match to the library: pure helpers so the rules are testable.
import type { Piko, Tofu, TofuPack } from "../../models";
import { MINECRAFT_PIKO_ID } from "../minecraftPiko";
import { releaseOf } from "./gameVersion";

export const PACK_ART_PREFIX = "mc-pack-";

/** Minecraft instances that still need a match attempt: nothing linked, never tried (or the user asked again), and a known game version and loader. */
export function tofusToMatch(library: readonly Piko[], skip: ReadonlySet<string> = new Set()): Tofu[] {
  const minecraft = library.find((piko) => piko.id === MINECRAFT_PIKO_ID);
  return (minecraft?.tofus ?? []).filter((tofu) => tofu.launchTarget && !tofu.pack && !tofu.packCheckedAt && !skip.has(tofu.id) && releaseOf(tofu) && tofu.loader && tofu.loader !== "vanilla");
}

/** Modrinth-linked instances without a cover of their own: the pack icon becomes their cover. */
export function tofusNeedingPackArt(library: readonly Piko[], skip: ReadonlySet<string> = new Set()): Tofu[] {
  const minecraft = library.find((piko) => piko.id === MINECRAFT_PIKO_ID);
  return (minecraft?.tofus ?? []).filter((tofu) => tofu.pack?.source === "modrinth" && !tofu.artwork && !tofu.artworkCacheKey && !skip.has(tofu.id));
}

export const packArtKey = (tofuId: string) => `${PACK_ART_PREFIX}${tofuId}`.slice(0, 120);

/** Sets (or clears) the pack of one Tofu of the Minecraft Piko; every other Tofu is the same object. */
export function patchInstance(library: Piko[], tofuId: string, change: (tofu: Tofu) => Tofu): Piko[] {
  return library.map((piko) => (piko.id !== MINECRAFT_PIKO_ID || !piko.tofus.some((tofu) => tofu.id === tofuId) ? piko : { ...piko, tofus: piko.tofus.map((tofu) => (tofu.id === tofuId ? change(tofu) : tofu)) }));
}

export const linkPack = (pack: TofuPack) => (tofu: Tofu): Tofu => ({ ...tofu, pack, packCheckedAt: undefined });
/** "Nothing matched": remembered so the instance is not searched again on every start. */
export const markChecked = (at: number) => (tofu: Tofu): Tofu => ({ ...tofu, packCheckedAt: at });
/** Removes the link and the cover that came from the pack (a cover the user chose stays). */
export const unlinkPack = (at: number) => (tofu: Tofu): Tofu => {
  const own = tofu.artworkCacheKey?.startsWith(PACK_ART_PREFIX);
  const { pack: _pack, ...rest } = tofu;
  return { ...rest, packCheckedAt: at, ...(own ? { artwork: undefined, artworkCacheKey: undefined } : {}) };
};
/** Asks for a new match attempt. */
export const rematchPack = (tofu: Tofu): Tofu => { const { pack: _pack, packCheckedAt: _at, ...rest } = tofu; return rest; };
export const withPackArt = (url: string, key: string) => (tofu: Tofu): Tofu => (tofu.artwork || tofu.artworkCacheKey ? tofu : { ...tofu, artwork: url, artworkCacheKey: key });
