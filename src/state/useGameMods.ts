import { useCallback, useEffect, useMemo, useState } from "react";
import { cfAllGames } from "../lib/curseforge";
import { getNexusGames } from "../lib/nexus";
import { supabase } from "../lib/supabase";
import { autoModLinks, mergeModLinks } from "../lib/mods/gameMatch";
import { modSupportOf } from "../lib/mods/gameSupport";
import { resolveSources, type SourceId } from "../lib/mods/resolveSources";
import { createCurseforgeSource } from "../lib/mods/curseforgeSource";
import { createNexusSource } from "../lib/mods/nexusSource";
import type { ModSource } from "../lib/mods/types";
import type { Piko } from "../models";
import { useApp } from "./AppContext";

/** Games already matched (or tried) this session, so browsing around never repeats a lookup. */
const attempted = new Set<string>();

export type GameMods = {
  support: ReturnType<typeof modSupportOf>;
  links: Piko["modLinks"];
  /** The single source that lists this game's mods, or null. */
  sourceId: SourceId | null;
  source: ModSource | null;
  resolving: boolean;
  /** The match lookup failed because Mochi could not reach the mod site. */
  offline: boolean;
  /** The game is on Nexus Mods only and the user has no key saved (or Nexus is switched off). */
  nexusBlocked: "key" | "disabled" | null;
  setLinks: (links: Piko["modLinks"]) => void;
};

/**
 * Resolves which mod ecosystem serves a game: matches it to CurseForge (first) or Nexus Mods by name once, stores
 * the result in `piko.modLinks`, and applies the user's source switches. CurseForge wins over Nexus for a game.
 */
export function useGameMods(piko: Piko): GameMods {
  const { lib, behavior, credentials } = useApp();
  const settings = behavior.modSources;
  const nexusKey = credentials.status.nexus && Boolean(supabase);
  const support = modSupportOf(piko);
  const links = piko.modLinks;
  const [resolving, setResolving] = useState(false);
  const [offline, setOffline] = useState(false);

  const needCf = support === "ecosystem" && settings.curseforge && !links?.curseforge && links?.source !== "user";
  const needNexus = support === "ecosystem" && settings.nexus && nexusKey && !links?.nexus && !links?.curseforge && links?.source !== "user";
  const attemptKey = `${piko.id}:${needCf ? 1 : 0}${needNexus ? 1 : 0}:${piko.name}`;

  useEffect(() => {
    if ((!needCf && !needNexus) || attempted.has(attemptKey)) return;
    attempted.add(attemptKey);
    let cancelled = false;
    setResolving(true);
    setOffline(false);
    void (async () => {
      let cf = null;
      let nexus = null;
      try {
        if (needCf) cf = await cfAllGames();
        const matched = autoModLinks(piko, cf, null);
        if (needNexus && !matched?.curseforge && supabase) nexus = await getNexusGames(supabase, piko.name);
        const found = autoModLinks(piko, cf, nexus);
        if (!cancelled && found) lib.updateGame(piko.id, { modLinks: mergeModLinks(piko.modLinks, found) });
      } catch (error) {
        attempted.delete(attemptKey);
        if (!cancelled) setOffline(true);
        console.warn("Mochi mod site lookup failed", error);
      } finally { if (!cancelled) setResolving(false); }
    })();
    return () => { cancelled = true; };
  }, [attemptKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const sourceId = useMemo(() => resolveSources({ minecraft: support === "minecraft", curseforge: Boolean(links?.curseforge), nexus: Boolean(links?.nexus), nexusKey }, settings)[0] ?? null, [support, links, nexusKey, settings]);

  const source = useMemo<ModSource | null>(() => {
    if (support === "minecraft") return null;
    if (sourceId === "curseforge" && links?.curseforge) return createCurseforgeSource({ gameId: links.curseforge.gameId, gameSlug: links.curseforge.slug });
    if (sourceId === "nexus" && links?.nexus && supabase) return createNexusSource(supabase, links.nexus);
    return null;
  }, [support, sourceId, links?.curseforge?.gameId, links?.nexus?.domain]); // eslint-disable-line react-hooks/exhaustive-deps

  const nexusBlocked: GameMods["nexusBlocked"] = sourceId || !links?.nexus ? null : !settings.nexus ? "disabled" : !nexusKey ? "key" : null;
  const setLinks = useCallback((next: Piko["modLinks"]) => lib.updateGame(piko.id, { modLinks: next }), [lib.updateGame, piko.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return { support, links, sourceId, source, resolving, offline, nexusBlocked, setLinks };
}
