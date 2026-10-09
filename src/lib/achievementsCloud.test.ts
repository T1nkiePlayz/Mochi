import { describe, expect, it } from "vitest";
import { mergeAchievements, sameAchievements, sanitiseCloudAchievements, toSynced } from "./achievementsCloud";
import { emptyFlags } from "./achievements";

const local = (unlocked: Record<string, number>, flags = {}) => ({ unlocked, flags: { ...emptyFlags(), ...flags }, seeded: true, catalog: 2 });

describe("achievements cloud merge", () => {
  it("keeps every unlock and the earliest time", () => {
    const merged = mergeAchievements(local({ a: 200, b: 50 }), sanitiseCloudAchievements({ unlocked: { a: 100, c: 300 } }));
    expect(merged.unlocked).toEqual({ a: 100, b: 50, c: 300 });
  });
  it("unions flags and keeps local-only Steam totals", () => {
    const steam = { known: true, unlocked: 1, total: 2 } as never;
    const merged = mergeAchievements(local({}, { themes: ["mochi"], steam }), sanitiseCloudAchievements({ flags: { themes: ["dark"], usedDiscover: true } }));
    expect(merged.flags.themes.sort()).toEqual(["dark", "mochi"]);
    expect(merged.flags.usedDiscover).toBe(true);
    expect(merged.flags.steam).toBe(steam);
    expect(merged.seeded).toBe(true);
  });
  it("is order independent and idempotent", () => {
    const a = local({ x: 5 }), b = sanitiseCloudAchievements({ unlocked: { y: 6 } });
    const once = toSynced(mergeAchievements(a, b));
    expect(sameAchievements(once, toSynced(mergeAchievements(mergeAchievements(a, b), b)))).toBe(true);
  });
  it("ignores malformed cloud data", () => {
    expect(sanitiseCloudAchievements("nope").unlocked).toEqual({});
    expect(sanitiseCloudAchievements({ unlocked: { a: "x", b: -1, c: 10 }, flags: { themes: [1, "ok"] } })).toMatchObject({ unlocked: { c: 10 }, flags: { themes: ["ok"] } });
  });
});
