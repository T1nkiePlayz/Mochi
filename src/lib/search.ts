import type { IgdbGame } from "./igdb";

export const normalizeText = (value: string) =>
  value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function editDistance(left: string, right: string): number {
  let row = Array.from({ length: right.length + 1 }, (_v, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const next = [i];
    for (let j = 1; j <= right.length; j += 1) next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1));
    row = next;
  }
  return row[right.length];
}

/** Forgiving search: substring match, or every query word within a small edit distance of a word in the candidate. */
export function gameSearchMatches(query: string, candidate: string): boolean {
  const needle = normalizeText(query);
  const haystack = normalizeText(candidate);
  if (!needle || !haystack) return false;
  if (haystack.includes(needle)) return true;
  const words = haystack.split(/\s+/);
  return needle.split(/\s+/).every((word) => words.some((candidateWord) => {
    const shortest = Math.min(candidateWord.length, word.length);
    if (candidateWord.includes(word) || word.includes(candidateWord)) return shortest >= 3;
    const threshold = shortest >= 9 ? 2 : 1;
    return shortest >= 4 && Math.abs(candidateWord.length - word.length) <= threshold && editDistance(word, candidateWord) <= threshold;
  }));
}

/** The IGDB result that is confidently the same title, or null when nothing is close enough. */
export function bestIgdbMatch(name: string, games: IgdbGame[]): IgdbGame | null {
  const expected = normalizeText(name);
  const ranked = games
    .map((game) => {
      const candidate = normalizeText(game.name);
      return { game, score: 1 - editDistance(expected, candidate) / Math.max(expected.length, candidate.length, 1) };
    })
    .sort((a, b) => b.score - a.score);
  return ranked[0] && ranked[0].score >= 0.88 ? ranked[0].game : null;
}
