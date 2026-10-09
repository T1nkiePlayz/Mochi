import type { SoundPackInfo } from "./packs";
import { DEFAULT_PACK_ID, isBuiltinPack } from "./synth";

export type ResolvedPack = { id: string; installed?: SoundPackInfo };

/**
 * The pack to play: the user's choice, or the theme's suggestion when the choice is "theme". Anything that is
 * neither built in nor installed (a removed pack, a theme naming a pack you do not have) falls back to Mochi's own.
 */
export function resolveSoundPack(choice: string, themePack: string | undefined, installed: readonly SoundPackInfo[]): ResolvedPack {
  const wanted = choice === "theme" ? themePack || DEFAULT_PACK_ID : choice;
  if (isBuiltinPack(wanted)) return { id: wanted };
  const pack = installed.find((item) => item.id === wanted);
  return pack ? { id: pack.id, installed: pack } : { id: DEFAULT_PACK_ID };
}
