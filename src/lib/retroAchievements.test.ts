import { describe, expect, it } from "vitest";
import { autoSuggest, consoleIdForPlatform, normalizeMatches, normalizeTitle, parseGameId, rankMatches, raPercent, sortRaAchievements, titleScore, type RaAchievement } from "./retroAchievements";

const ach = (id: number, over: Partial<RaAchievement> = {}): RaAchievement => ({ id, title: String(id), description: "", points: 5, unlocked: false, hardcore: false, ...over });

describe("title normalization", () => {
  it("drops brackets, punctuation, accents and case", () => {
    expect(normalizeTitle("Super Mario World (USA) [!]")).toBe("super mario world");
    expect(normalizeTitle("Pokémon: Red Version")).toBe("pokemon red version");
    expect(normalizeTitle("  Sonic & Knuckles  ")).toBe("sonic knuckles");
    expect(normalizeTitle("")).toBe("");
  });
  it("ignores a leading or trailing article when scoring", () => {
    expect(titleScore("The Legend of Zelda", "Legend of Zelda, The")).toBe(1);
    expect(titleScore("Mario", "Zelda")).toBe(0);
  });
});

describe("matching", () => {
  const games = [{ title: "Super Mario World" }, { title: "Super Mario Kart" }, { title: "Super Mario World 2: Yoshi's Island" }, { title: "Metroid" }];
  it("ranks exact first and drops unrelated games", () => {
    const ranked = rankMatches("Super Mario World (USA)", games).map((item) => item.game.title);
    expect(ranked[0]).toBe("Super Mario World");
    expect(ranked).not.toContain("Metroid");
  });
  it("suggests only an obvious match", () => {
    expect(autoSuggest("Super Mario World (Europe)", games)?.title).toBe("Super Mario World");
    expect(autoSuggest("Zelda", games)).toBeNull();
    expect(autoSuggest("Super Mario", [{ title: "Super Mario Kart" }, { title: "Super Mario Land" }])).toBeNull();
  });
});

describe("console and id parsing", () => {
  it("maps platform names to console ids", () => {
    expect(consoleIdForPlatform("SNES")).toBe(3);
    expect(consoleIdForPlatform("Game Boy Advance")).toBe(5);
    expect(consoleIdForPlatform("Windows")).toBeNull();
    expect(consoleIdForPlatform(undefined)).toBeNull();
  });
  it("accepts only positive integer game ids", () => {
    expect(parseGameId(" 228 ")).toBe(228);
    for (const bad of ["", "0", "-3", "1.5", "abc", "12 34", "99999999999"]) expect(parseGameId(bad)).toBeNull();
  });
  it("keeps only well-formed saved matches", () => {
    const out = normalizeMatches({ a: { raGameId: 5, consoleId: 3, title: "X" }, b: { raGameId: -1 }, c: "bad", d: { raGameId: 2, consoleId: "x" }, __proto__: { raGameId: 9 } });
    expect(out).toEqual({ a: { raGameId: 5, consoleId: 3, title: "X" }, d: { raGameId: 2 } });
    expect(normalizeMatches(null)).toEqual({});
  });
});

describe("progress helpers", () => {
  it("sorts unlocked newest first, then locked in order", () => {
    const sorted = sortRaAchievements([ach(1), ach(2, { unlocked: true, earnedAt: 1 }), ach(3, { unlocked: true, earnedAt: 9 }), ach(4)]);
    expect(sorted.map((item) => item.id)).toEqual([3, 2, 1, 4]);
  });
  it("percent handles empty sets", () => {
    expect(raPercent({ earned: 0, total: 0 })).toBe(0);
    expect(raPercent({ earned: 1, total: 3 })).toBe(33);
  });
});
