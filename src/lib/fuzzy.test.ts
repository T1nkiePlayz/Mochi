import { describe, expect, it } from "vitest";
import { foldText, fuzzyScore, queryTokens } from "./fuzzy";

const score = (query: string, text: string) => fuzzyScore(queryTokens(query), foldText(text));

describe("fuzzyScore", () => {
  it("matches substrings, subsequences and rejects misses", () => {
    expect(score("set", "settings")).toBeGreaterThan(0);
    expect(score("stgs", "settings")).toBeGreaterThan(0);
    expect(score("zzz", "settings")).toBe(-1);
    expect(score("sg", "s")).toBe(-1);
  });
  it("ranks exact and word-start matches above scattered ones", () => {
    expect(score("theme", "theme")).toBeGreaterThan(score("theme", "a theme picker"));
    expect(score("pic", "a theme picker")).toBeGreaterThan(score("pic", "topic"));
    expect(score("gtl", "go to library")).toBeGreaterThan(0);
  });
  it("requires every token and ignores case and accents", () => {
    expect(score("go lib", "Go to Library")).toBeGreaterThan(0);
    expect(score("go xyz", "Go to Library")).toBe(-1);
    expect(score("cafe", "Café Mochi")).toBeGreaterThan(0);
  });
  it("an empty query matches everything with score 0", () => { expect(fuzzyScore([], "anything")).toBe(0); });
});
