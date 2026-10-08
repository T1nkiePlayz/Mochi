import { describe, expect, it } from "vitest";
import { achievements, buildFacts, countCollections, evaluate, newlyMet, progressText } from "./achievements";
import type { SessionRecord } from "./stats";

const flags = { themes: [], usedDiscover: false, installedMod: false };
const rec = (start: number, seconds: number, gameId = "g"): SessionRecord => ({ gameId, name: gameId, start, seconds, kind: "session", count: 1 });

describe("achievements", () => {
  it("ids are unique and targets positive (no division by zero)", () => {
    expect(new Set(achievements.map((a) => a.id)).size).toBe(achievements.length);
    expect(achievements.every((a) => a.target > 0)).toBe(true);
  });
  it("unlocks hours and not more", () => {
    const facts = buildFacts([rec(1_700_000_000, 11 * 3600)], [], flags, 0);
    const met = newlyMet(evaluate(facts), {}).map((d) => d.id);
    expect(met).toContain("hours-10");
    expect(met).not.toContain("hours-100");
    expect(newlyMet(evaluate(facts), { "hours-10": 1 }).map((d) => d.id)).not.toContain("hours-10");
  });
  it("counts collections from any stored shape", () => {
    expect(countCollections(null, [])).toBe(0);
    expect(countCollections([{ id: "a" }, 5, null], [{ id: "x", collectionIds: ["a", "b"] } as never])).toBe(2);
  });
  it("progress text never overshoots the target", () => {
    const item = evaluate(buildFacts([rec(1_700_000_000, 400 * 3600)], [], flags, 0)).find((p) => p.def.id === "hours-100")!;
    expect(progressText(item)).toBe("100 / 100 h");
  });
});
