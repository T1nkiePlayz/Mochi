import { useEffect, useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CF_SITE } from "../../lib/curseforge";
import { DEFAULT_AUTO_EXTEND_BELOW, shouldAutoExtend } from "../../lib/mods/autoExtend";
import { createCurseforgeSource } from "../../lib/mods/curseforgeSource";
import { createExtendedSource, type ExtendInfo } from "../../lib/mods/extendedSource";
import { resolveGameSources, type GameSourceChoice } from "../../lib/mods/gameSources";
import { createNexusSource } from "../../lib/mods/nexusSource";
import type { ModSourceSettings, SourceId } from "../../lib/mods/resolveSources";
import type { ModSource } from "../../lib/mods/types";
import { openExternalUrl } from "../../lib/platform";
import type { Piko } from "../../models";
import { ModsBrowser } from "../mods/ModsBrowser";
import { useGameSourceChoice, type DiscoverGame } from "./useDiscoverGames";

type Props = {
  game: DiscoverGame;
  pikos: Piko[];
  supabase: SupabaseClient | null;
  settings: ModSourceSettings;
  /** Settings: add other sites when the primary lists fewer mods than this (0 = never). */
  below: number;
  refreshKey: number;
};

const siteLabel: Record<SourceId, string> = { modrinth: "Modrinth", curseforge: "CurseForge", nexus: "Nexus Mods" };
const choiceLabel: Record<GameSourceChoice, string> = { auto: "Auto", curseforge: "CurseForge", nexus: "Nexus Mods" };
const choiceHint: Record<GameSourceChoice, string> = {
  auto: "CurseForge first; Nexus Mods is added when CurseForge lists only a few mods for this game.",
  curseforge: "Only CurseForge.", nexus: "Only Nexus Mods.",
};

/** One game's mods: a source switcher when two sites list it, automatic extension when the first site has too few, and honest notes. */
export function GameDiscoverTab({ game, pikos, supabase, settings, below, refreshKey }: Props) {
  const [choice, setChoice] = useGameSourceChoice(game.key);
  const sources = resolveGameSources({ onCurseforge: Boolean(game.cf), onNexus: Boolean(game.nexusDomain), choice }, settings);
  const [info, setInfo] = useState<ExtendInfo | null>(null);
  useEffect(() => setInfo(null), [game.key, sources.primary, sources.extras.join(), below, refreshKey]);

  const source = useMemo<ModSource | null>(() => {
    const make = (id: SourceId): ModSource | null => {
      if (id === "curseforge" && game.cf) return createCurseforgeSource({ gameId: game.cf.id, gameSlug: game.cf.slug });
      if (id === "nexus" && game.nexusDomain && supabase) return createNexusSource(supabase, { domain: game.nexusDomain, name: game.name });
      return null;
    };
    const primary = sources.primary ? make(sources.primary) : null;
    if (!primary) return null;
    const extras = sources.extras.map(make).filter((entry): entry is ModSource => entry !== null);
    return createExtendedSource(primary, extras, below, setInfo);
  }, [game.key, game.cf, game.nexusDomain, game.name, sources.primary, sources.extras.join(), below, supabase]); // eslint-disable-line react-hooks/exhaustive-deps

  const ecosystem = sources.primary === "nexus" && game.nexusDomain ? { source: "nexus" as const, domain: game.nexusDomain } : game.cf ? { source: "curseforge" as const, gameId: game.cf.id } : { source: "nexus" as const, domain: game.nexusDomain ?? "" };
  const primaryLabel = sources.primary ? siteLabel[sources.primary] : "";
  const fewOnCurseforge = sources.primary === "curseforge" && info !== null && shouldAutoExtend(info.primaryTotal, Math.max(below, DEFAULT_AUTO_EXTEND_BELOW));
  const link = (url: string) => void openExternalUrl(url).catch(() => undefined);

  return <section className="discover-section">
    <div className="discover-section-heading"><div>
      <h3>{game.name} mods</h3>
      <p>{sources.primary ? `From ${choice === "auto" && sources.extras.length ? "CurseForge, and Nexus Mods when CurseForge has few" : primaryLabel}.` : "No mod site is available for this game right now."}{sources.primary === "nexus" ? " Free Nexus accounts download the file on the Nexus site." : ""}</p>
    </div></div>

    {sources.choices.length > 1 && <div className="mod-source-switch" role="group" aria-label="Mod source for this game"><span>Source</span>
      {sources.choices.map((id) => <button key={id} type="button" className={choice === id ? "active" : ""} aria-pressed={choice === id} title={choiceHint[id]} onClick={() => setChoice(id)}>{choiceLabel[id]}</button>)}</div>}

    {info?.extended && <p className="metadata-note discover-extend-note" role="status">{info.note}{info.failed.length ? ` ${info.failed.join(", ")} did not answer.` : ""}</p>}
    {fewOnCurseforge && game.cf && <p className="metadata-note discover-limit-note" role="note">
      CurseForge shares only {info!.primaryTotal.toLocaleString()} {info!.primaryTotal === 1 ? "project" : "projects"} of this game with apps; browse the rest on curseforge.com.{" "}
      <button type="button" className="text-button" onClick={() => link(`${CF_SITE}/${game.cf!.slug}`)}><ExternalLink size={12} /> Open {game.name} on CurseForge</button>
    </p>}
    {source
      ? <ModsBrowser key={`${game.key}:${choice}:${refreshKey}:${below}:${sources.extras.join()}`} source={source} target={{ kind: "choose", pikos, ecosystem, gameName: game.name }} noun="mods" />
      : <div className="discover-empty">This game is not available right now.</div>}
  </section>;
}
