import { useMemo } from "react";
import { buildSoundChain, type ResolvedPack } from "./resolve";
import { useSoundSettings } from "./settings";
import { useSoundPacks } from "./useSoundPacks";

/**
 * The resolved pack chain for the active theme. Recomputed only when the theme, the user's pack settings or the
 * installed packs change (`key` is stable for the same chain, so effects can depend on it).
 */
export function useSoundChain(theme: { soundPack?: string; soundFallbacks?: readonly string[] } | undefined): { chain: ResolvedPack[]; skipped: string[]; key: string; loaded: boolean } {
  const [settings] = useSoundSettings();
  const { packs, loaded } = useSoundPacks();
  const themePack = theme?.soundPack, themeFallbacks = theme?.soundFallbacks;
  return useMemo(() => {
    // Until the installed list arrives only built-in packs are known; do not report installed ones as missing.
    const { chain, skipped } = buildSoundChain({ choice: settings.pack, themePack, themeFallbacks, userFallbacks: settings.fallbacks, installed: packs });
    const key = chain.map((pack) => (pack.installed ? `${pack.id}:${pack.installed.version}:${pack.installed.sizeBytes}` : pack.id)).join(",");
    return { chain, skipped: loaded ? skipped : [], key, loaded };
  }, [settings.pack, settings.fallbacks, themePack, themeFallbacks, packs, loaded]);
}
