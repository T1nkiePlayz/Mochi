// Pure helpers: no runtime imports so they can be unit tested with plain `node --test`.
import type { Piko } from "../../models";
import { normalizeGameName } from "./gameSupport.ts";

export type NameCandidate = { name: string; slug?: string };

/** Words that may follow a game's name in a store listing without making it a different game. */
const EDITION_WORDS = new Set([
  "game", "of", "the", "year", "edition", "goty", "definitive", "complete", "deluxe", "ultimate", "gold", "remastered", "remaster",
  "enhanced", "anniversary", "special", "standard", "collection", "legendary", "directors", "cut", "premium", "classic", "hd", "pc", "digital",
]);

const squash = (value: string) => value.replace(/\s+/g, "");

/** Score 0-100 for how well `candidate` names the same game as `name` (both already normalised). */
function score(name: string, candidate: NameCandidate): number {
  const target = normalizeGameName(candidate.name);
  const slug = candidate.slug ? normalizeGameName(candidate.slug.replace(/[-_]+/g, " ")) : "";
  if (!name || !target) return 0;
  if (name === target) return 100;
  if (squash(name) === squash(target) || (slug && squash(name) === squash(slug))) return 95;
  const extra = (longer: string, shorter: string) => longer.startsWith(shorter + " ") ? longer.slice(shorter.length).trim().split(" ") : null;
  const tail = extra(target, name) ?? extra(name, target);
  if (tail && tail.every((word) => EDITION_WORDS.has(word))) return 85;
  return 0;
}

/** The candidate that names the same game, or null. Ties go to the earlier candidate. */
export function bestNameMatch<T extends NameCandidate>(name: string, candidates: readonly T[], minScore = 80): T | null {
  const wanted = normalizeGameName(name);
  let best: T | null = null;
  let bestScore = 0;
  for (const candidate of candidates) {
    const value = score(wanted, candidate);
    if (value > bestScore) { best = candidate; bestScore = value; }
  }
  return bestScore >= minScore ? best : null;
}

/** Same title with different punctuation, used to merge a game found on both sites into one entry. */
export function dedupeKey(name: string): string {
  return squash(normalizeGameName(name).replace(/^the /, ""));
}

export type CurseforgeGameLike = { id: number; name: string; slug: string };
export type NexusGameLike = { name: string; domainName: string };
export type ModLinks = NonNullable<Piko["modLinks"]>;

/** Auto-match a game against both site catalogs. Returns undefined when nothing matched or nothing changed. */
export function autoModLinks(
  piko: Pick<Piko, "name">,
  curseforge: readonly CurseforgeGameLike[] | null,
  nexus: readonly NexusGameLike[] | null,
): ModLinks | undefined {
  const cf = curseforge ? bestNameMatch(piko.name, curseforge.map((game) => ({ ...game }))) : null;
  const nx = nexus ? bestNameMatch(piko.name, nexus.map((game) => ({ ...game, slug: game.domainName }))) : null;
  if (!cf && !nx) return undefined;
  return {
    source: "auto",
    ...(cf ? { curseforge: { gameId: cf.id, slug: cf.slug, name: cf.name } } : {}),
    ...(nx ? { nexus: { domain: nx.domainName, name: nx.name } } : {}),
  };
}

/**
 * Merge links found now into what the Piko already stores. A user's choice is never overwritten
 * and sites that were already linked keep their link.
 */
export function mergeModLinks(current: Piko["modLinks"], found: ModLinks | undefined): ModLinks | undefined {
  if (!found) return current;
  if (current?.source === "user") return current;
  return { ...found, ...(current?.minecraft !== undefined ? { minecraft: current.minecraft } : {}), source: "auto" };
}
