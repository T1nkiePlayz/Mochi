import { describe, expect, it } from "vitest";
import { mergeAchievements, sanitizeCloudAchievements, toCloudAchievements } from "./achievementsCloud";
import type { AchievementFlags } from "./achievementTypes";

const flags = (extra: Partial<AchievementFlags> = {}): AchievementFlags => ({ themes: [], views: [], usedDiscover: false, installedMod: false, controllerUsed: false, bigPictureUsed: false, ...extra } as AchievementFlags);

describe("achievements cloud", () => {
  it("serialises the same unlocks identically whatever order they were stored in", () => {
    const a = sanitizeCloudAchievements({ unlocked: { zeta: 2, alpha: 1, mid: 3 } });
    const b = sanitizeCloudAchievements({ unlocked: { mid: 3, alpha: 1, zeta: 2 } });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("drops malformed rows instead of throwing", () => {
    expect(sanitizeCloudAchievements({ unlocked: { a: "x", b: -1, c: 5 }, flags: { themes: [1, "dark"], usedDiscover: "yes" } }))
      .toEqual({ version: 1, unlocked: { c: 5 }, flags: { themes: ["dark"], views: [], usedDiscover: false, installedMod: false, controllerUsed: false, bigPictureUsed: false } });
    expect(sanitizeCloudAchievements(null).unlocked).toEqual({});
  });

  it("merges as a union, keeping the earliest unlock and OR-ing flags", () => {
    const local = { unlocked: { a: 100, b: 50 }, flags: flags({ themes: ["dark"], usedDiscover: true }) };
    const cloud = sanitizeCloudAchievements({ unlocked: { a: 40, c: 70 }, flags: { themes: ["light", "dark"], installedMod: true } });
    const merged = mergeAchievements(local, cloud);
    expect(merged.unlocked).toEqual({ a: 40, b: 50, c: 70 });
    expect(merged.flags.themes).toEqual(["dark", "light"]);
    expect(merged.flags.usedDiscover && merged.flags.installedMod).toBe(true);
  });

  it("never uploads per-device Steam totals", () => {
    const local = { unlocked: {}, flags: { ...flags(), steam: { unlocked: 3, total: 10 } } as unknown as AchievementFlags };
    expect("steam" in toCloudAchievements(local).flags).toBe(false);
  });
});
