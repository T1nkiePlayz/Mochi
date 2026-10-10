import type { SoundPackInfo } from "./packs";
import { MAX_SOUND_FALLBACKS, normalizeSoundFallbacks } from "./settings";
import { DEFAULT_PACK_ID, isBuiltinPack } from "./synth";

export type ResolvedPack = { id: string; installed?: SoundPackInfo };

/**
 * Pure: the usable packs in order of preference. Candidates that are empty, repeated or unavailable (not installed,
 * or known to fail) are dropped; the application default always ends the chain (nothing after it is reachable), so the result is never empty.
 * `skipped` lists the dropped unavailable ids, in the order they were asked for.
 */
export function resolveSoundPackChain(
  candidates: ReadonlyArray<string | undefined | null>,
  isAvailable: (id: string) => boolean,
  appDefault: string = DEFAULT_PACK_ID,
): { chain: string[]; skipped: string[] } {
  const chain: string[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();
  for (const id of candidates) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (id === appDefault || isAvailable(id)) { chain.push(id); if (id === appDefault) break; } else skipped.push(id); // the default always plays everything
  }
  if (!chain.includes(appDefault)) chain.push(appDefault);
  return { chain, skipped };
}

export type SoundChainInput = {
  /** Settings > Sound > Sound pack: a pack id, or "theme". */
  choice: string;
  themePack?: string;
  themeFallbacks?: readonly string[];
  /** The user's own fallback list. */
  userFallbacks?: readonly string[];
  installed: readonly SoundPackInfo[];
  /** Packs already known to fail to load (skipped). */
  failed?: ReadonlySet<string>;
};

/**
 * The order UI sounds are resolved in: the user's explicit pack (an explicit choice always wins over the theme),
 * the theme's pack, the theme's fallbacks in order, the user's fallbacks, then Mochi's own default.
 */
export function buildSoundChain({ choice, themePack, themeFallbacks = [], userFallbacks = [], installed, failed }: SoundChainInput): { chain: ResolvedPack[]; skipped: string[] } {
  const byId = new Map(installed.map((pack) => [pack.id, pack]));
  const candidates = [
    choice === "theme" ? undefined : choice,
    themePack,
    ...normalizeSoundFallbacks(themeFallbacks).slice(0, MAX_SOUND_FALLBACKS),
    ...userFallbacks,
  ];
  const { chain, skipped } = resolveSoundPackChain(candidates, (id) => !failed?.has(id) && (isBuiltinPack(id) || byId.has(id)));
  return { chain: chain.map((id) => (isBuiltinPack(id) ? { id } : { id, installed: byId.get(id) })), skipped };
}

/** The pack to play first: the user's choice, or the theme's suggestion when the choice is "theme"; Mochi's own if neither is usable. */
export function resolveSoundPack(choice: string, themePack: string | undefined, installed: readonly SoundPackInfo[]): ResolvedPack {
  return buildSoundChain({ choice, themePack, installed }).chain[0];
}
