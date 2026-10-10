import { DISCOVER_QUERY_EVENT, clearDiscoverQuery, peekDiscoverQuery } from "../../lib/discoverQuery";
import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CF_MINECRAFT_ID, type CfGame } from "../../lib/curseforge";
import { planSections } from "../../lib/mods/allSections";
import { createCurseforgeSource } from "../../lib/mods/curseforgeSource";
import { minecraftFilterFor } from "../../lib/mods/gameVersion";
import { resolveGameSources } from "../../lib/mods/gameSources";
import { createMixedSource, type MixedChild } from "../../lib/mods/mixedSource";
import { createModrinthSource } from "../../lib/mods/modrinthSource";
import { createNexusSource } from "../../lib/mods/nexusSource";
import { MINECRAFT_CLASS, type ModSourceSettings } from "../../lib/mods/resolveSources";
import type { ModSource } from "../../lib/mods/types";
import type { Piko } from "../../models";
import { ModsBrowser } from "../mods/ModsBrowser";
import { GameSection } from "./GameSection";
import { OtherGames } from "./OtherGames";
import type { DiscoverGame, StoredGame } from "./useDiscoverGames";

type Props = {
  games: DiscoverGame[];
  cfGames: CfGame[] | null;
  pikos: Piko[];
  supabase: SupabaseClient | null;
  settings: ModSourceSettings;
  refreshKey: number;
  /** Switch to a game's own tab ("minecraft" or the game's key). */
  onSeeAll: (tab: string) => void;
  onAddGame: (game: StoredGame) => void;
};

/**
 * Discover > All: one section per added game (its most popular mods, loaded only when scrolled near), then a few games
 * to add. Typing in the search box swaps the sections for one list across every game. Primary site per game only, so it stays light.
 */
export function AllGamesFeed({ games, cfGames, pikos, supabase, settings, refreshKey, onSeeAll, onAddGame }: Props) {
  const [text, setText] = useState(peekDiscoverQuery);
  const [query, setQuery] = useState(() => text.trim());
  // "Install mod <name>" from the command palette prefills the search, also when Discover is already open.
  useEffect(() => { clearDiscoverQuery(); const onQuery = () => { setText(peekDiscoverQuery()); clearDiscoverQuery(); }; window.addEventListener(DISCOVER_QUERY_EVENT, onQuery); return () => window.removeEventListener(DISCOVER_QUERY_EVENT, onQuery); }, []);
  useEffect(() => { const timer = window.setTimeout(() => setQuery(text.trim()), 300); return () => window.clearTimeout(timer); }, [text]);
  const searching = text.trim() !== "" && query !== "";

  const minecraftIconUrl = cfGames?.find((game) => game.id === CF_MINECRAFT_ID)?.assets?.iconUrl;
  const { sections } = useMemo(() => planSections({
    modrinth: settings.modrinth, curseforge: settings.curseforge, minecraftIconUrl,
    games: games.map((game) => { const sources = resolveGameSources({ onCurseforge: Boolean(game.cf), onNexus: Boolean(game.nexusDomain), choice: "auto" }, settings); return { key: game.key, name: game.name, iconUrl: game.iconUrl, cfId: game.cf?.id, nexusDomain: game.nexusDomain, primary: sources.primary === "curseforge" || sources.primary === "nexus" ? sources.primary : null }; }),
  }), [games, settings, minecraftIconUrl]);

  const makeSource = (plan: (typeof sections)[number]): ModSource | null => {
    if (plan.site === "modrinth") return createModrinthSource("mod");
    if (plan.site === "curseforge" && plan.cfId !== undefined) { const game = games.find((entry) => entry.key === plan.key); return createCurseforgeSource(plan.minecraft ? { gameId: CF_MINECRAFT_ID, gameSlug: "minecraft", classId: MINECRAFT_CLASS.mod } : { gameId: plan.cfId, gameSlug: game?.cf?.slug ?? "" }); }
    if (plan.site === "nexus" && plan.nexusDomain && supabase) return createNexusSource(supabase, { domain: plan.nexusDomain, name: plan.name });
    return null;
  };
  const ecosystemOf = (plan: (typeof sections)[number]) => plan.site === "modrinth" ? { source: "modrinth" as const } : plan.site === "curseforge" ? { source: "curseforge" as const, gameId: plan.cfId! } : { source: "nexus" as const, domain: plan.nexusDomain! };

  const built = useMemo(() => sections.flatMap((plan) => { const source = makeSource(plan); return source ? [{ plan, source, ecosystem: ecosystemOf(plan) }] : []; }), [sections, supabase, games]); // eslint-disable-line react-hooks/exhaustive-deps
  const searchSource = useMemo(() => built.length ? createMixedSource(built.map(({ plan, source, ecosystem }): MixedChild => ({ game: plan.name, source, ecosystem }))) : null, [built]);

  const addedIds = useMemo(() => new Set(games.flatMap((game) => game.cf ? [game.cf.id] : [])), [games]);

  return <section className="discover-section all-sections">
    <div className="discover-section-heading"><div><h3>All your games</h3><p>The most popular mods for Minecraft and every game tab. Search looks in all of them.</p></div></div>
    {searchSource && <div className="mods-controls all-search"><label className="search-box"><Search size={15} /><input value={text} onChange={(event) => setText(event.target.value)} placeholder="Search mods in all your games..." aria-label="Search mods in all your games" /></label></div>}
    {!searchSource && <div className="discover-empty">No mod source is available for any game yet.</div>}
    {searchSource && searching && <ModsBrowser key={`all-search:${refreshKey}:${games.length}`} source={searchSource} query={query} noun="mods" target={{ kind: "choose", pikos, ecosystem: { source: "modrinth" }, tofuFilter: (tofu, item) => item.ecosystem?.source === "modrinth" || (item.ecosystem?.source === "curseforge" && item.ecosystem.gameId === CF_MINECRAFT_ID) ? minecraftFilterFor(tofu, true) : undefined }} />}
    {searchSource && !searching && <>
      {built.map(({ plan, source, ecosystem }) => <GameSection key={`${plan.key}:${refreshKey}`} plan={plan} source={source} cacheKey={`${plan.key}:${refreshKey}`} pikos={pikos} ecosystem={ecosystem} onSeeAll={() => onSeeAll(plan.tab)} />)}
      {settings.curseforge && <OtherGames cfGames={cfGames} addedIds={addedIds} refreshKey={refreshKey} onAdd={onAddGame} />}
    </>}
  </section>;
}
