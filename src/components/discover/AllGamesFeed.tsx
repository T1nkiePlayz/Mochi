import { useMemo } from "react";
import { PlugZap } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CF_MINECRAFT_ID } from "../../lib/curseforge";
import { createCurseforgeSource } from "../../lib/mods/curseforgeSource";
import { minecraftFilterFor } from "../../lib/mods/gameVersion";
import { resolveGameSources } from "../../lib/mods/gameSources";
import { createMixedSource, type MixedChild } from "../../lib/mods/mixedSource";
import { createModrinthSource } from "../../lib/mods/modrinthSource";
import { createNexusSource } from "../../lib/mods/nexusSource";
import { MINECRAFT_CLASS, type ModSourceSettings } from "../../lib/mods/resolveSources";
import type { Piko } from "../../models";
import { ModsBrowser } from "../mods/ModsBrowser";
import type { DiscoverGame } from "./useDiscoverGames";

type Props = {
  games: DiscoverGame[];
  pikos: Piko[];
  supabase: SupabaseClient | null;
  settings: ModSourceSettings;
  nexusKey: boolean;
  refreshKey: number;
  onOpenSettings: () => void;
};

/**
 * Discover > All: one scrolling list across Minecraft and every added game, each card labelled with its game and site.
 * It uses each game's primary site only (the per-game tab does the extra-site lookup), so opening it stays light.
 */
export function AllGamesFeed({ games, pikos, supabase, settings, nexusKey, refreshKey, onOpenSettings }: Props) {
  const { source, skipped } = useMemo(() => {
    const children: MixedChild[] = [];
    if (settings.modrinth) children.push({ game: "Minecraft", source: createModrinthSource("mod"), ecosystem: { source: "modrinth" } });
    else if (settings.curseforge) children.push({ game: "Minecraft", source: createCurseforgeSource({ gameId: CF_MINECRAFT_ID, gameSlug: "minecraft", classId: MINECRAFT_CLASS.mod }), ecosystem: { source: "curseforge", gameId: CF_MINECRAFT_ID } });
    let skippedGames = 0;
    for (const game of games) {
      const sources = resolveGameSources({ onCurseforge: Boolean(game.cf), onNexus: Boolean(game.nexusDomain), nexusKey: nexusKey && Boolean(supabase), choice: "auto" }, settings);
      if (sources.primary === "curseforge" && game.cf) children.push({ game: game.name, source: createCurseforgeSource({ gameId: game.cf.id, gameSlug: game.cf.slug }), ecosystem: { source: "curseforge", gameId: game.cf.id } });
      else if (sources.primary === "nexus" && game.nexusDomain && supabase) children.push({ game: game.name, source: createNexusSource(supabase, { domain: game.nexusDomain, name: game.name }), ecosystem: { source: "nexus", domain: game.nexusDomain } });
      else if (sources.needsNexusKey) skippedGames += 1;
    }
    return { source: children.length ? createMixedSource(children) : null, skipped: skippedGames };
  }, [games, supabase, settings, nexusKey]);

  return <section className="discover-section">
    <div className="discover-section-heading"><div><h3>Mods from all your games</h3><p>One feed across Minecraft and every game tab, taking turns so no game crowds out the others. Search looks in all of them.</p></div></div>
    {skipped > 0 && <div className="discover-connect" role="note"><PlugZap size={16} aria-hidden="true" /><p>{skipped} {skipped === 1 ? "game is" : "games are"} left out because {skipped === 1 ? "it is" : "they are"} on Nexus Mods only. Connect Nexus to include {skipped === 1 ? "it" : "them"}.</p><button type="button" className="secondary-button" onClick={onOpenSettings}>Open Settings</button></div>}
    {source
      ? <ModsBrowser key={`all:${refreshKey}:${games.length}`} source={source} target={{ kind: "choose", pikos, ecosystem: { source: "modrinth" }, tofuFilter: (tofu, item) => item.ecosystem?.source === "modrinth" || (item.ecosystem?.source === "curseforge" && item.ecosystem.gameId === CF_MINECRAFT_ID) ? minecraftFilterFor(tofu, true) : undefined }} noun="mods" />
      : <div className="discover-empty">No mod source is available for any game yet.</div>}
  </section>;
}
