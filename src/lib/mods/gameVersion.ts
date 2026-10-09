// Pure helpers: no runtime imports so they can be unit tested with plain `node --test` or vitest.
import type { Tofu } from "../../models";
import { tofuTarget } from "./compat.ts";

/** A real Minecraft release id of a Tofu ("1.20.1"); "Local" or free text yield undefined. */
export const releaseOf = (tofu: { version: string }): string | undefined => /^\d+\.\d+(\.\d+)?$/.test(tofu.version) ? tofu.version : undefined;

/** The file filter for a Minecraft Tofu: its release, and its loader for mods (resource packs and shaders have none). */
export function minecraftFilterFor(tofu: Tofu, mod: boolean): { gameVersion?: string; loader?: string } {
  const loader = tofuTarget(tofu).loader;
  return { gameVersion: releaseOf(tofu), loader: mod && loader && loader !== "vanilla" ? loader : undefined };
}
