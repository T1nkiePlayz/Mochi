import { useCallback, useEffect, useMemo, useState } from "react";
import { cfAllGames, type CfGame } from "../../lib/curseforge";
import { KNOWN_NEXUS_GAMES, SEED_GAMES, visibleSeedGames } from "../../lib/mods/gameCatalog";
import { bestNameMatch } from "../../lib/mods/gameMatch";
import { isSourceChoice, type GameSourceChoice } from "../../lib/mods/gameSources";
import type { ModSourceSettings } from "../../lib/mods/resolveSources";
import { getNexusGames, type NexusGame } from "../../lib/nexus";
import { igdbIconFor, lookupIgdbGames } from "../../lib/igdb";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readJson, writeJson } from "../../lib/storage";
import { supabase } from "../../lib/supabase";

/** A game tab. Its primary site is CurseForge when the game is there, otherwise Nexus Mods; `nexusDomain` is set when Nexus lists it too. */
export type DiscoverGame = {
  key: string;
  name: string;
  iconUrl?: string;
  iconFallbackUrls?: string[];
  source: "curseforge" | "nexus";
  cf?: CfGame;
  nexusDomain?: string;
};

/** What the user added to Discover. Only ids, slugs and names are stored, never site content. */
export type StoredGame = { k: "cf"; id: number; slug: string; nx?: string } | { k: "nx"; domain: string; name?: string };
const STORE = "mochi:discover-games";
const LEGACY_NEXUS = "mochi:nexus-discovery-games";
const CHOICES = "mochi:discover-source-choice";

// Cache in-flight and completed lookups across effect restarts when the Nexus catalog finishes loading.
const igdbIconLookupCache = new Map<string, Promise<string | null>>();

function lookupNexusGameIcon(client: SupabaseClient, game: Pick<NexusGame, "domainName" | "name">): Promise<string | null> {
  const key = game.domainName.toLocaleLowerCase();
  const cached = igdbIconLookupCache.get(key);
  if (cached) return cached;

  const request = (async (): Promise<string | null> => {
    const matches = await lookupIgdbGames(client, game.name);
    return igdbIconFor(game.name, matches);
  })();

  igdbIconLookupCache.set(key, request);
  // Cache successful URLs, but allow transient failures and empty searches to be retried later.
  void request.then(
    (url) => { if (!url && igdbIconLookupCache.get(key) === request) igdbIconLookupCache.delete(key); },
    () => { if (igdbIconLookupCache.get(key) === request) igdbIconLookupCache.delete(key); },
  );
  return request;
}

function readStored(): StoredGame[] {
  const stored = readJson<unknown>(STORE, null);
  if (Array.isArray(stored)) return stored.filter((entry): entry is StoredGame => Boolean(entry) && typeof entry === "object" && ((entry as StoredGame).k === "cf" || (entry as StoredGame).k === "nx"));
  const legacy = readJson<unknown>(LEGACY_NEXUS, []);
  return Array.isArray(legacy) ? legacy.filter((domain): domain is string => typeof domain === "string").map((domain) => ({ k: "nx" as const, domain })) : [];
}

const sameEntry = (a: StoredGame, b: StoredGame) => a.k === b.k && (a.k === "cf" ? a.id === (b as { id: number }).id : a.domain === (b as { domain: string }).domain);
const nexusThumbnail = (game?: { id?: string; iconUrl?: string }) => game?.iconUrl ?? (game?.id && /^\d+$/.test(game.id) ? `https://images.nexusmods.com/images/games/v2/${game.id}/thumbnail.jpg` : undefined);

/** The user's per-game site choice (Auto / CurseForge / Nexus Mods), remembered between runs. */
export function useGameSourceChoice(gameKey: string): [GameSourceChoice, (choice: GameSourceChoice) => void] {
  const [all, setAll] = useState<Record<string, unknown>>(() => readJson<Record<string, unknown>>(CHOICES, {}));
  const value = all[gameKey];
  const set = useCallback((choice: GameSourceChoice) => setAll((current) => { const next = { ...current, [gameKey]: choice }; writeJson(CHOICES, next); return next; }), [gameKey]);
  return [isSourceChoice(value) ? value : "auto", set];
}

export function useDiscoverGames(settings: ModSourceSettings, nexusKey: boolean, igdbConfigured: boolean, client: SupabaseClient | null) {
  const [cfGames, setCfGames] = useState<CfGame[] | null>(null);
  const [cfError, setCfError] = useState("");
  const [cfLoading, setCfLoading] = useState(false);
  const [catalog, setCatalog] = useState<NexusGame[]>([]);
  const [igdbIcons, setIgdbIcons] = useState<Record<string, string>>({});
  const [stored, setStored] = useState<StoredGame[]>(readStored);
  const [reload, setReload] = useState(0);
  const nexusOn = settings.nexus;

  useEffect(() => {
    if (!settings.curseforge) { setCfGames(null); setCfError(""); return; }
    let cancelled = false;
    setCfLoading(true); setCfError("");
    void cfAllGames().then((games) => { if (!cancelled) setCfGames(games); }).catch((error) => { if (!cancelled) setCfError(error instanceof Error ? error.message : "Unable to load CurseForge games."); }).finally(() => { if (!cancelled) setCfLoading(false); });
    return () => { cancelled = true; };
  }, [settings.curseforge, reload]);

  useEffect(() => {
    if (!nexusOn) { setCatalog([]); return; }
    let cancelled = false;
    void getNexusGames(supabase).then((games) => { if (!cancelled) setCatalog(games); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [nexusOn]);

  // Nexus can omit game icons. Use IGDB only when configured and avoid duplicate lookups.
  useEffect(() => {
    if (!settings.nexus || !igdbConfigured || !client) { setIgdbIcons({}); return; }
    let cancelled = false;
    // Prioritise explicitly added games and the live Nexus catalogue before built-in suggestions.
    // This keeps the request budget useful even when the built-in catalogue grows beyond the cap.
    const candidates: Array<Pick<NexusGame, "domainName" | "name"> & { iconUrl?: string }> = [
      ...stored.filter((entry): entry is Extract<StoredGame, { k: "nx" }> => entry.k === "nx")
        .map((entry) => ({ domainName: entry.domain, name: entry.name ?? entry.domain })),
      ...catalog,
      ...KNOWN_NEXUS_GAMES,
    ];
    const iconned = new Set(candidates.filter((game) => game.iconUrl).map((game) => game.domainName.toLocaleLowerCase()));
    const missingByDomain = new Map(candidates
      .filter((game) => !iconned.has(game.domainName.toLocaleLowerCase()))
      .map((game) => [game.domainName.toLocaleLowerCase(), game]));
    // Explicitly added games are first in the list; cover more of the live catalogue without an unbounded IGDB burst.
    const missing = [...missingByDomain.values()].slice(0, 64);

    void (async () => {
      const resolved: Array<readonly [string, string]> = [];
      for (let offset = 0; offset < missing.length; offset += 4) {
        const batch = await Promise.all(missing.slice(offset, offset + 4).map(async (game) => {
          try {
            const url = await lookupNexusGameIcon(client, game);
            return url ? [game.domainName.toLocaleLowerCase(), url] as const : null;
          } catch { return null; }
        }));
        resolved.push(...batch.filter((entry): entry is readonly [string, string] => entry !== null));
        if (cancelled) return;
      }
      if (!cancelled) setIgdbIcons((current) => ({ ...current, ...Object.fromEntries(resolved) }));
    })();
    return () => { cancelled = true; };
  }, [catalog, stored, settings.nexus, igdbConfigured, client]);

  const games = useMemo<DiscoverGame[]>(() => {
    // Wait for CurseForge's list so a game on both sites never shows up first as Nexus-only and then jumps.
    if (settings.curseforge && !cfGames && !cfError) return [];
    const out = new Map<string, DiscoverGame>();
    const put = (game: DiscoverGame | null) => { if (game && !out.has(game.key)) out.set(game.key, game); };
    const nexusInfo = (domain: string) => catalog.find((game) => game.domainName === domain) ?? KNOWN_NEXUS_GAMES.find((game) => game.domainName === domain);
    const cfGame = (game: CfGame, nexusDomain?: string): DiscoverGame => {
      const domain = nexusDomain ?? (settings.nexus ? bestNameMatch(game.name, catalog.map((entry) => ({ ...entry, slug: entry.domainName })))?.domainName : undefined);
      const info = domain ? nexusInfo(domain) : undefined;
      const nexusUrl = nexusThumbnail(info);
      const igdbUrl = domain ? igdbIcons[domain.toLocaleLowerCase()] : undefined;
      const iconUrl = game.assets?.iconUrl ?? nexusUrl ?? igdbUrl;
      const iconFallbackUrls = [game.assets?.iconUrl ? nexusUrl : undefined, igdbUrl].filter((url): url is string => Boolean(url && url !== iconUrl));
      return { key: `cf:${game.id}`, name: game.name, iconUrl, iconFallbackUrls, source: "curseforge", cf: game, nexusDomain: settings.nexus ? domain : undefined };
    };
    const nexusOnly = (domain: string, fallbackName: string): DiscoverGame | null => {
      if (!settings.nexus) return null;
      const info = nexusInfo(domain);
      const name = info?.name ?? fallbackName;
      const onCf = settings.curseforge && cfGames ? bestNameMatch(name, cfGames) : null;
      if (onCf) return cfGame(onCf, domain);
      const nexusUrl = nexusThumbnail(info);
      const igdbUrl = igdbIcons[domain.toLocaleLowerCase()];
      const iconUrl = nexusUrl ?? igdbUrl;
      return { key: `nx:${domain}`, name, iconUrl, iconFallbackUrls: [igdbUrl].filter((url): url is string => Boolean(url && url !== iconUrl)), source: "nexus", nexusDomain: domain };
    };
    for (const { seed, cf } of visibleSeedGames(SEED_GAMES, cfGames, nexusOn && nexusKey, settings.curseforge)) {
      if (cf) put(cfGame(cf, seed.nexusDomain));
      else put(nexusOnly(seed.nexusDomain!, seed.name));
    }
    for (const entry of stored) {
      if (entry.k === "cf") {
        const game = settings.curseforge ? cfGames?.find((candidate) => candidate.id === entry.id) : undefined;
        if (game) put(cfGame(game, entry.nx));
      } else put(nexusOnly(entry.domain, entry.name ?? entry.domain));
    }
    return [...out.values()];
  }, [cfGames, cfError, catalog, stored, settings.curseforge, settings.nexus, nexusOn, nexusKey, igdbIcons]);

  const add = useCallback((entry: StoredGame) => {
    setStored((current) => {
      const next = current.some((item) => sameEntry(item, entry)) ? current : [...current, entry];
      writeJson(STORE, next);
      return next;
    });
  }, []);

  const remove = useCallback((key: string) => {
    setStored((current) => {
      const next = current.filter((entry) => entry.k === "cf" ? `cf:${entry.id}` !== key : `nx:${entry.domain}` !== key);
      writeJson(STORE, next);
      return next;
    });
  }, []);
  const removableKeys = useMemo(() => new Set(stored.map((entry) => entry.k === "cf" ? `cf:${entry.id}` : `nx:${entry.domain}`)), [stored]);

  return { games, cfGames, cfError, cfLoading, nexusOn, nexusCatalog: catalog, removableKeys, add, remove, retry: () => setReload((value) => value + 1) };
}
