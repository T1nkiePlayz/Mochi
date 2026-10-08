import { describe, expect, it } from "vitest";
import { editDistance, gameSearchMatches, normalizeText } from "./search";

describe("search", () => {
  it("keeps non-latin names searchable", () => {
    expect(gameSearchMatches("ゲーム", "ゲーム大全")).toBe(true);
    expect(gameSearchMatches("игра", "Моя Игра")).toBe(true);
    expect(normalizeText("Pokémon: Red")).toBe("pokemon red");
  });
  it("is forgiving about typos but not wild", () => {
    expect(gameSearchMatches("stardew vally", "Stardew Valley")).toBe(true);
    expect(gameSearchMatches("zelda", "Stardew Valley")).toBe(false);
    expect(gameSearchMatches("", "x")).toBe(false);
  });
  it("editDistance", () => { expect(editDistance("kitten", "sitting")).toBe(3); expect(editDistance("", "abc")).toBe(3); });
});
