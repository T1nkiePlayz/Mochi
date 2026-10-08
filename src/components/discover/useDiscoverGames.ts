import { useCallback, useEffect, useMemo, useState } from "react";
import { cfAllGames, type CfGame } from "../../lib/curseforge";
import { bestNameMatch } from "../../lib/mods/gameMatch";
import type { ModSourceSettings } from "../../lib/mods/resolveSources";
import { getNexusGames, type NexusGame } from "../../lib/nexus";
import { readJson, writeJson } from "../../lib/storage";
import { supabase } from "../../lib/supabase";

/** A game tab. A game on CurseForge always uses CurseForge; Nexus Mods only serves games that are not there. */
export type DiscoverGame = {
  key: string;
  name: string;
  iconUrl?: string;
  source: "curseforge" | "nexus";
  cf?: CfGame;
  nexusDomain?: string;
};

/** What the user added to Discover. Only ids and slugs are stored, never site content. */
export type StoredGame = { k: "cf"; id: number; slug: string } | { k: "nx"; domain: string };
const STORE = "mochi:discover-games";
const LEGACY_NEXUS = "mochi:nexus-discovery-games";

const seeds: Array<{ name: string; nexusDomain?: string }> = [
  { name: "Stardew Valley", nexusDomain: "stardewvalley" },
  { name: "Terraria" },
  { name: "Satisfactory", nexusDomain: "satisfactory" },
  { name: "Subnautica", nexusDomain: "subnautica" },
  { name: "Subnautica: Below Zero", nexusDomain: "subnauticabelowzero" },
  { name: "Five Nights at Freddy's: Security Breach", nexusDomain: "fnafsecuritybreach" },
];

function readStored(): StoredGame[] {
  const stored = readJson<unknown>(STORE, null);
  if (Array.isArray(stored)) return stored.filter((entry): entry is StoredGame => Boolean(entry) && typeof entry === "object" && ((entry as StoredGame).k === "cf" || (entry as StoredGame).k === "nx"));
  const legacy = readJson<unknown>(LEGACY_NEXUS, []);
  return Array.isArray(legacy) ? legacy.filter((domain): domain is string => typeof domain === "string").map((domain) => ({ k: "nx" as const, domain })) : [];
}

export function useDiscoverGames(settings: ModSourceSettings, nexusKey: boolean) {
  const [cfGames, setCfGames] = useState<CfGame[] | null>(null);
  const [cfError, setCfError] = useState("");
  const [cfLoading, setCfLoading] = useState(false);
  const [catalog, setCatalog] = useState<NexusGame[]>([]);
  const [stored, setStored] = useState<StoredGame[]>(readStored);
  const [reload, setReload] = useState(0);
  const nexusOn = settings.nexus && nexusKey && Boolean(supabase);

  useEffect(() => {
    if (!settings.curseforge) { setCfGames(null); setCfError(""); return; }
    let cancelled = false;
    setCfLoading(true); setCfError("");
    void cfAllGames().then((games) => { if (!cancelled) setCfGames(games); }).catch((error) => { if (!cancelled) setCfError(error instanceof Error ? error.message : "Unable to load CurseForge games."); }).finally(() => { if (!cancelled) setCfLoading(false); });
    return () => { cancelled = true; };
  }, [settings.curseforge, reload]);

  useEffect(() => {
    if (!nexusOn || !supabase) { setCatalog([]); return; }
    let cancelled = false;
    void getNexusGames(supabase).then((games) => { if (!cancelled) setCatalog(games); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [nexusOn]);

  const games = useMemo<DiscoverGame[]>(() => {
    const out = new Map<string, DiscoverGame>();
    const nexusGame = (domain: string, fallbackName: string): DiscoverGame | null => {
      if (!nexusOn) return null;
      const known = catalog.find((game) => game.domainName === domain);
      const name = known?.name ?? fallbackName;
      // A game that is on CurseForge is served by CurseForge only.
      const onCf = settings.curseforge && cfGames ? bestNameMatch(name, cfGames) : null;
      if (onCf) return { key: `cf:${onCf.id}`, name: onCf.name, iconUrl: onCf.assets?.iconUrl, source: "curseforge", cf: onCf };
      return { key: `nx:${domain}`, name, iconUrl: known?.iconUrl, source: "nexus", nexusDomain: domain };
    };
    const put = (game: DiscoverGame | null) => { if (game && !out.has(game.key)) out.set(game.key, game); };
    for (const seed of seeds) {
      const match = settings.curseforge && cfGames ? bestNameMatch(seed.name, cfGames) : null;
      if (match) put({ key: `cf:${match.id}`, name: match.name, iconUrl: match.assets?.iconUrl, source: "curseforge", cf: match });
      else if (seed.nexusDomain) put(nexusGame(seed.nexusDomain, seed.name));
    }
    for (const entry of stored) {
      if (entry.k === "cf") {
        const game = settings.curseforge ? cfGames?.find((candidate) => candidate.id === entry.id) : undefined;
        if (game) put({ key: `cf:${game.id}`, name: game.name, iconUrl: game.assets?.iconUrl, source: "curseforge", cf: game });
      } else put(nexusGame(entry.domain, entry.domain));
    }
    return [...out.values()];
  }, [cfGames, catalog, stored, settings.curseforge, nexusOn]);

  const add = useCallback((entry: StoredGame) => {
    setStored((current) => {
      const exists = current.some((item) => item.k === entry.k && (entry.k === "cf" ? (item as { id: number }).id === entry.id : (item as { domain: string }).domain === entry.domain));
      const next = exists ? current : [...current, entry];
      writeJson(STORE, next);
      return next;
    });
  }, []);

  return { games, cfGames, cfError, cfLoading, nexusOn, add, retry: () => setReload((value) => value + 1) };
}
