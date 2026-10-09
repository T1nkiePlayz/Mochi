// Pure helpers: no runtime imports so they can be unit tested with plain `node --test`.
import { bestNameMatch, dedupeKey } from "./gameMatch.ts";
import { normalizeGameName } from "./gameSupport.ts";

export type CfGameLike = { id: number; name: string; slug: string; iconUrl?: string };
export type NexusGameLike = { name: string; domainName: string; iconUrl?: string; modCount?: number };

/**
 * Games Discover opens with, in this order. `cfId` ids and `nexusDomain` slugs were checked against the live CurseForge
 * `games` route and Nexus Mods URLs (CurseForge has no Balatro or RuneScape: Dragonwilds, so those are Nexus only).
 * The ids are only trusted when the live CurseForge list still contains them (otherwise the name is matched).
 */
export type SeedGame = { name: string; cfId?: number; nexusDomain?: string };
export const SEED_GAMES: SeedGame[] = [
  { name: "Balatro", nexusDomain: "balatro" },
  { name: "RuneScape: Dragonwilds", nexusDomain: "runescapedragonwilds" },
  { name: "Minecraft Dungeons", cfId: 69271, nexusDomain: "minecraftdungeons" },
  { name: "Stardew Valley", cfId: 669, nexusDomain: "stardewvalley" },
  { name: "Terraria", cfId: 431, nexusDomain: "terraria" },
  { name: "Satisfactory", nexusDomain: "satisfactory" },
  { name: "Subnautica", nexusDomain: "subnautica" },
  { name: "Subnautica: Below Zero", nexusDomain: "subnauticabelowzero" },
  { name: "Five Nights at Freddy's: Security Breach", nexusDomain: "fnafsecuritybreach" },
];

/** Nexus Mods games that can be listed (and found by search) before the live games list is available, e.g. without a key. */
export const KNOWN_NEXUS_GAMES: NexusGameLike[] = SEED_GAMES.filter((game) => game.nexusDomain).map((game) => ({ name: game.name, domainName: game.nexusDomain! }));

/** Short names people type; each maps to words of the real title. */
const ALIASES: Record<string, string> = {
  rsdw: "runescape dragonwilds", dragonwilds: "runescape dragonwilds", "dragon wilds": "runescape dragonwilds", rs: "runescape", osrs: "old school runescape",
  mcd: "minecraft dungeons", mc: "minecraft", tmod: "terraria", tmodloader: "terraria", sdv: "stardew valley", stardew: "stardew valley",
  fnaf: "five nights at freddys", sn: "subnautica", bz: "subnautica below zero", ksp: "kerbal space program", sims: "sims 4",
};

/** Query forms to try: what was typed, and the full title when it is a known short name. */
export function queryForms(query: string): string[] {
  const typed = normalizeGameName(query);
  if (!typed) return [];
  const alias = ALIASES[typed];
  return alias ? [typed, alias] : [typed];
}

const squash = (value: string) => value.replace(/ /g, "");

/** Every word of the query appears in the title, or the query without spaces appears in the title without spaces ("dragon wilds" finds "Dragonwilds"). */
export function matchesQuery(name: string, extra: string, forms: readonly string[]): boolean {
  if (!forms.length) return true;
  const title = normalizeGameName(name);
  const hay = `${title} ${normalizeGameName(extra)}`;
  const flat = squash(hay);
  return forms.some((form) => form.split(" ").every((word) => hay.includes(word)) || flat.includes(squash(form)));
}

export type CatalogEntry = {
  key: string;
  name: string;
  iconUrl?: string;
  cf?: { id: number; slug: string };
  nexus?: { domain: string; modCount?: number; known?: boolean };
};

/**
 * Searchable list of games from CurseForge and Nexus Mods, one entry per game (a game on both sites is one row with both
 * source badges). Punctuation, case, spacing and aliases never hide a game. `nexusEnabled` false drops Nexus-only rows.
 */
export function searchGameCatalog(query: string, cf: readonly CfGameLike[], nexus: readonly NexusGameLike[], options: { cfEnabled: boolean; nexusEnabled: boolean; limit?: number }): CatalogEntry[] {
  const forms = queryForms(query);
  const entries = new Map<string, CatalogEntry>();
  const byName = new Map<string, string>();
  const put = (entry: CatalogEntry) => {
    const name = dedupeKey(entry.name);
    const existing = entries.get(byName.get(name) ?? entry.key);
    if (!existing) { entries.set(entry.key, entry); byName.set(name, entry.key); return; }
    existing.cf = existing.cf ?? entry.cf;
    existing.nexus = existing.nexus ? { ...existing.nexus, ...entry.nexus, known: existing.nexus.known && entry.nexus?.known } : entry.nexus;
    existing.iconUrl = existing.iconUrl ?? entry.iconUrl;
  };
  if (options.cfEnabled) for (const game of cf) if (matchesQuery(game.name, game.slug.replace(/-/g, " "), forms)) put({ key: `cf:${game.id}`, name: game.name, iconUrl: game.iconUrl, cf: { id: game.id, slug: game.slug } });
  if (options.nexusEnabled) {
    const live = new Set(nexus.map((game) => game.domainName));
    const pool = [...nexus.map((game) => ({ game, known: false })), ...KNOWN_NEXUS_GAMES.filter((game) => !live.has(game.domainName)).map((game) => ({ game, known: true }))];
    for (const { game, known } of pool) {
      if (!matchesQuery(game.name, game.domainName, forms)) continue;
      const onCf = options.cfEnabled ? bestNameMatch(game.name, cf.map((item) => ({ ...item }))) : null;
      const base = { name: game.name, iconUrl: game.iconUrl, nexus: { domain: game.domainName, modCount: game.modCount, known } };
      put(onCf ? { key: `cf:${onCf.id}`, ...base, name: onCf.name, iconUrl: onCf.iconUrl ?? game.iconUrl, cf: { id: onCf.id, slug: onCf.slug } } : { key: `nx:${game.domainName}`, ...base });
    }
  }
  const typed = forms[0] ?? "";
  const rank = (entry: CatalogEntry) => { const title = normalizeGameName(entry.name); return title === typed ? 0 : title.startsWith(typed) ? 1 : 2; };
  const sorted = [...entries.values()].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  return sorted.slice(0, options.limit ?? 40);
}

/** Source labels shown as badges on a catalogue row. */
export function entryBadges(entry: CatalogEntry): string[] {
  return [...(entry.cf ? ["CurseForge"] : []), ...(entry.nexus ? ["Nexus Mods"] : [])];
}
