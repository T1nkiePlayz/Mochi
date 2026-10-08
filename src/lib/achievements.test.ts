import { describe, expect, it } from "vitest";
import { achievementCategories, achievements, buildFacts, countCollections, emptyFlags, evaluate, newlyMet, progressText, rarityOrder, visibleAchievements, type AchievementFlags } from "./achievements";
import type { SessionRecord } from "./stats";
import type { Piko } from "../models";

const flags = (over: Partial<AchievementFlags> = {}): AchievementFlags => ({ ...emptyFlags(), ...over });
const rec = (start: number, seconds: number, gameId = "g"): SessionRecord => ({ gameId, name: gameId, start, seconds, kind: "session", count: 1 });
/** Local-time timestamp in seconds, so hour-of-day rules do not depend on the machine's zone. */
const at = (y: number, m: number, d: number, h = 12, min = 0) => Math.floor(new Date(y, m - 1, d, h, min).getTime() / 1000);
const facts = (records: SessionRecord[], library: Piko[] = [], f = flags(), collections = 0) => buildFacts(records, library, f, collections, new Date(2026, 5, 15, 12).getTime());
const met = (f: ReturnType<typeof facts>) => new Set(newlyMet(evaluate(f), {}).map((d) => d.id));
const piko = (id: string, over: Partial<Piko> = {}): Piko => ({ id, name: id, description: "", accent: "", artwork: "", tofus: [{ id: "default", name: "Default", version: "", runtime: "", mods: 0, status: "Ready" }], ...over });

describe("achievement catalogue", () => {
  it("has 40+ unique ids with sane targets and categories", () => {
    expect(achievements.length).toBeGreaterThanOrEqual(40);
    expect(new Set(achievements.map((a) => a.id)).size).toBe(achievements.length);
    expect(achievements.every((a) => a.target > 0 && achievementCategories.includes(a.category))).toBe(true);
    expect(new Set(achievements.map((a) => a.category)).size).toBe(achievementCategories.length);
  });
  it("keeps the ids that were already shipped (unlocks are stored by id)", () => {
    const ids = new Set(achievements.map((a) => a.id));
    for (const id of ["first-launch", "hour-1", "hours-10", "hours-100", "hours-500", "hours-1000", "streak-3", "streak-7", "streak-30", "night-owl", "early-bird", "marathon", "ultramarathon", "variety", "collector-10", "collector-50", "collector-100", "organised", "themer", "modder", "explorer", "tinkerer"]) expect(ids.has(id), id).toBe(true);
  });
  it("tiers of a family ascend in target and never drop in rarity", () => {
    const families = new Map<string, typeof achievements>();
    achievements.forEach((a) => { if (a.family) families.set(a.family, [...(families.get(a.family) ?? []), a]); });
    for (const [name, tiers] of families) {
      tiers.forEach((tier, index) => {
        expect(tier.tier, name).toBe(index + 1);
        expect(tier.tierCount, name).toBe(tiers.length);
        if (index) {
          expect(tier.target, name).toBeGreaterThan(tiers[index - 1].target);
          expect(rarityOrder.indexOf(tier.rarity), name).toBeGreaterThanOrEqual(rarityOrder.indexOf(tiers[index - 1].rarity));
        }
      });
    }
  });
  it("an empty world unlocks nothing and never produces NaN", () => {
    const progress = evaluate(facts([]));
    expect(progress.some((p) => p.met)).toBe(false);
    expect(progress.every((p) => Number.isFinite(p.fraction) && p.fraction >= 0 && p.fraction <= 1)).toBe(true);
  });
});

describe("facts and rules", () => {
  it("unlocks hours and not more", () => {
    const ids = met(facts([rec(at(2026, 5, 1), 11 * 3600)]));
    expect(ids).toContain("hours-10");
    expect(ids).not.toContain("hours-50");
    expect(newlyMet(evaluate(facts([rec(at(2026, 5, 1), 11 * 3600)])), { "hours-10": 1 }).map((d) => d.id)).not.toContain("hours-10");
  });
  it("historic playtime counts for hours but not for sessions or streaks", () => {
    const f = facts([{ gameId: "g", name: "g", start: 1, seconds: 120 * 3600, kind: "historic", count: 0 }]);
    expect(f.totalSeconds).toBe(120 * 3600);
    expect([f.sessionCount, f.daysPlayed, f.longestStreak]).toEqual([0, 0, 0]);
    expect(f.maxGameSeconds).toBe(120 * 3600);
    expect(met(f)).toContain("main-character");
  });
  it("detects time of day, quick sessions and sessions per day", () => {
    const f = facts([rec(at(2026, 5, 1, 1), 3600), rec(at(2026, 5, 2, 5), 3600), ...[8, 10, 12, 14, 16].map((h, i) => rec(at(2026, 5, 3, h, i), 300))]);
    expect([f.nightSessions, f.earlySessions, f.quickSessions, f.maxSessionsInDay]).toEqual([1, 1, 5, 5]);
    const ids = met(f);
    for (const id of ["night-owl", "early-bird", "just-one-more"]) expect(ids.has(id), id).toBe(true);
    expect(ids.has("quick-fix")).toBe(false);
  });
  it("counts a streak across midnight and long days", () => {
    const f = facts([rec(at(2026, 5, 1, 23), 3 * 3600), rec(at(2026, 5, 3, 10), 3600), rec(at(2026, 5, 4, 10), 3600)]);
    expect(f.longestStreak).toBe(4);
    expect(f.maxDaySeconds).toBe(3600 * 2);
    expect(f.daysPlayed).toBe(4);
  });
  it("finds weekends, weekday coverage, gaps, months and festive days", () => {
    // 2026-05-04 is a Monday; play Mon..Sun then return 40 days later on Christmas Day (2026-12-25 is a Friday).
    const week = [4, 5, 6, 7, 8, 9, 10].map((day) => rec(at(2026, 5, day), 600));
    const f = facts([...week, rec(at(2026, 12, 25), 600), rec(at(2027, 1, 1), 600)]);
    expect(f.weekdaysCovered).toBe(7);
    expect(f.weekendDays).toBe(2);
    expect(f.festiveDays).toBe(2);
    expect(f.monthsActive).toBe(3);
    expect(f.longestGapDays).toBe(Math.round((new Date(2026, 11, 25).getTime() - new Date(2026, 4, 10).getTime()) / 86_400_000) - 1);
    const ids = met(f);
    for (const id of ["every-weekday", "festive", "comeback"]) expect(ids.has(id), id).toBe(true);
  });
  it("counts distinct games in any 7-day window with a sliding window", () => {
    const games = (day: number, ids: string[]) => ids.map((id) => rec(at(2026, 5, day), 600, id));
    // 5 games spread over days 1..5, plus a different crowd 20 days later that never overlaps.
    const f = facts([...games(1, ["a"]), ...games(2, ["b"]), ...games(4, ["c", "a"]), ...games(7, ["d"]), ...games(8, ["e"]), ...games(28, ["x", "y"])]);
    expect(f.maxGamesInWeek).toBe(5);
    // Day 1 falls out of the window ending on day 8 but day 2 does not.
    expect(facts([...games(1, ["a"]), ...games(8, ["b"])]).maxGamesInWeek).toBe(1);
    expect(facts([...games(2, ["a"]), ...games(8, ["b"])]).maxGamesInWeek).toBe(2);
  });
  it("derives library facts", () => {
    const library = [
      piko("a", { sourceId: "steam", categories: ["RPG", "Action"], favorite: true, tags: ["Co-op", "co-op", "x"], collectionIds: ["c1", "c2"] }),
      piko("b", { sourceId: "heroic", categories: ["rpg"], collectionIds: ["c1"], tofus: [piko("t").tofus[0], { ...piko("t").tofus[0], id: "m", mods: 3 }] }),
      piko("c", { source: "custom" }),
      piko("l", { sourceId: "steam", kind: "launcher" }),
    ];
    const f = facts([rec(at(2026, 5, 1), 11 * 3600, "a"), rec(at(2026, 5, 2), 600, "b")], library, flags({ installedMod: true }), 2);
    expect(f).toMatchObject({ gameCount: 4, librarySources: 2, customGames: 1, steamGames: 1, favouriteCount: 1, distinctTags: 2, maxCollectionSize: 2, tofuCount: 5, customTofuCount: 1, totalMods: 3, moddedGames: 1, gamesPlayed: 2, gamesOver10h: 1, playedGenres: 2, playedSources: 2 });
    expect(met(f).has("modder")).toBe(true);
  });
  it("Steam achievements stay unavailable (not 0 / not met) until data exists", () => {
    const none = evaluate(facts([]));
    const steam = none.filter((p) => p.def.requires === "steam");
    expect(steam.length).toBeGreaterThanOrEqual(5);
    expect(steam.every((p) => !p.available && !p.met)).toBe(true);
    expect(progressText(steam[0])).toBe("Needs Steam data");
    const known = evaluate(facts([], [], flags({ steam: { known: true, gamesWithData: 3, unlocked: 120, total: 200, perfectGames: 1 } })));
    const ids = new Set(known.filter((p) => p.met).map((p) => p.def.id));
    expect(ids).toEqual(new Set(["steam-1", "steam-25", "steam-100", "steam-perfect-1"]));
    // A flag that says "not known" is treated as no data.
    expect(facts([], [], flags({ steam: { known: false, gamesWithData: 0, unlocked: 9, total: 9, perfectGames: 0 } })).steam).toBeNull();
  });
  it("counts collections from any stored shape", () => {
    expect(countCollections(null, [])).toBe(0);
    expect(countCollections([{ id: "a" }, 5, null], [{ id: "x", collectionIds: ["a", "b"] } as never])).toBe(2);
  });
  it("progress text never overshoots the target", () => {
    const item = evaluate(facts([rec(at(2026, 5, 1), 400 * 3600)])).find((p) => p.def.id === "hours-100")!;
    expect(progressText(item)).toBe("100 / 100 h");
  });
});

describe("visibleAchievements", () => {
  const all = () => evaluate(facts([rec(at(2026, 5, 1), 11 * 3600)]));
  it("shows only the next locked tier of a family but every earned tier", () => {
    const ids = visibleAchievements(all(), {}, { category: "Playtime", status: "all" }).map((p) => p.def.id);
    expect(ids).toContain("hour-1");
    expect(ids).toContain("hours-10");
    expect(ids).toContain("hours-50");
    expect(ids).not.toContain("hours-100");
    expect(visibleAchievements(all(), {}, { category: "Playtime", status: "all" }, false).map((p) => p.def.id)).toContain("hours-100");
  });
  it("filters by status and category, unlocked first", () => {
    const unlocked = { "hour-1": 10, "hours-10": 20 };
    const list = visibleAchievements(all(), unlocked, { category: "all", status: "all" });
    expect(list.slice(0, 2).map((p) => p.def.id)).toEqual(["hours-10", "hour-1"]);
    expect(visibleAchievements(all(), unlocked, { category: "all", status: "unlocked" }).every((p) => p.met)).toBe(true);
    expect(visibleAchievements(all(), unlocked, { category: "Mods", status: "all" }).every((p) => p.def.category === "Mods")).toBe(true);
  });
});

describe("performance", () => {
  it("evaluates a very large history in one quick pass", () => {
    const records: SessionRecord[] = [];
    for (let i = 0; i < 30_000; i += 1) records.push(rec(at(2024, 1, 1) + i * 3600 * 5, 1800 + (i % 7) * 600, `g${i % 40}`));
    const library = Array.from({ length: 300 }, (_, i) => piko(`g${i}`, { categories: ["A", "B"], tags: [`t${i % 12}`] }));
    const started = performance.now();
    const progress = evaluate(buildFacts(records, library, flags(), 3));
    expect(performance.now() - started).toBeLessThan(2500);
    expect(progress.length).toBe(achievements.length);
  });
});
