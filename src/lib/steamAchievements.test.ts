import { describe, expect, it } from "vitest";
import { sortSteamAchievements, steamPercent, summariseTotals, type SteamAchievement } from "./steamAchievements";

const a = (apiName: string, over: Partial<SteamAchievement> = {}): SteamAchievement => ({ apiName, name: apiName, description: "d", unlocked: false, hidden: false, ...over });

describe("steam achievements helpers", () => {
  it("sorts unlocked newest first, then locked with hidden last", () => {
    const sorted = sortSteamAchievements([a("hidden", { hidden: true }), a("locked"), a("old", { unlocked: true, unlockedAt: 1 }), a("new", { unlocked: true, unlockedAt: 9 })]);
    expect(sorted.map((x) => x.apiName)).toEqual(["new", "old", "locked", "hidden"]);
  });
  it("summarises totals and perfect games, ignoring empty sets", () => {
    const totals = summariseTotals([
      { appid: 1, steamId: "x", unlocked: 10, total: 10, fetchedAt: 1 },
      { appid: 2, steamId: "x", unlocked: 3, total: 20, fetchedAt: 1 },
      { appid: 3, steamId: "x", unlocked: 0, total: 0, fetchedAt: 1 },
    ]);
    expect(totals).toEqual({ known: true, gamesWithData: 2, unlocked: 13, total: 30, perfectGames: 1 });
    expect(summariseTotals([]).known).toBe(false);
  });
  it("percent handles zero totals", () => {
    expect(steamPercent({ unlocked: 0, total: 0 })).toBe(0);
    expect(steamPercent({ unlocked: 1, total: 3 })).toBe(33);
  });
});
