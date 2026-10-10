/** Small fuzzy scorer for the command palette. Inputs are expected to be lower-cased (see `foldText`). */

/** Lower-cases and strips accents; cheap enough to run once per item and cache. */
export const foldText = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const isBoundary = (text: string, index: number) => index === 0 || /[^\p{L}\p{N}]/u.test(text[index - 1] ?? "");

/** Score of one token against `text`, or -1. Substrings beat subsequences; word starts and runs score higher. */
function tokenScore(token: string, text: string): number {
  const at = text.indexOf(token);
  if (at >= 0) return 1000 - Math.min(at, 200) + (isBoundary(text, at) ? 300 : 0) + (token.length === text.length ? 400 : 0);
  if (token.length < 2) return -1;
  let score = 0, from = 0, run = 0;
  for (let i = 0; i < token.length; i += 1) {
    const found = text.indexOf(token[i]!, from);
    if (found < 0) return -1;
    run = found === from && i > 0 ? run + 1 : 0;
    score += 10 + run * 8 + (isBoundary(text, found) ? 12 : 0) - Math.min(found - from, 10);
    from = found + 1;
  }
  return score;
}

/** Splits a query into lower-cased tokens once, so scoring many items does not re-split it. */
export const queryTokens = (query: string): string[] => foldText(query).split(/\s+/).filter(Boolean);

/** Every token must match; the result is the sum of token scores (higher is better), or -1 for no match. */
export function fuzzyScore(tokens: readonly string[], text: string): number {
  if (!tokens.length) return 0;
  let total = 0;
  for (const token of tokens) {
    const score = tokenScore(token, text);
    if (score < 0) return -1;
    total += score;
  }
  return total - Math.min(text.length, 100) * 0.1;
}
