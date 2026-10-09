import { describe, expect, it } from "vitest";
import { defaultBehavior, normalizeBehavior } from "./settings";

describe("normalizeBehavior (settings written by older versions)", () => {
  it("fills defaults for missing, null and wrong-typed input", () => {
    expect(normalizeBehavior(null)).toEqual(defaultBehavior);
    expect(normalizeBehavior("x")).toEqual(defaultBehavior);
    expect(normalizeBehavior({ keepOpen: "yes", metadataProvider: "nope", modSources: 3 })).toEqual(defaultBehavior);
  });
  it("keeps valid values and drops unknown experimental ids", () => {
    const out = normalizeBehavior({ confirmLaunch: false, metadataProvider: "igdb", experimental: ["ghost", 3], modSources: { nexus: false } });
    expect(out).toMatchObject({ confirmLaunch: false, metadataProvider: "igdb", experimental: [] });
    expect(out.modSources).toEqual({ modrinth: true, curseforge: true, nexus: false });
  });
  it("automatic mod updates are off unless the user turned them on", () => {
    expect(defaultBehavior.autoUpdateMods).toBe(false);
    expect(normalizeBehavior({ autoUpdateMods: true }).autoUpdateMods).toBe(true);
    expect(normalizeBehavior({ autoUpdateMods: "yes" }).autoUpdateMods).toBe(false);
  });
  it("the auto-extend threshold defaults to 15 and is clamped to 0..100", () => {
    expect(defaultBehavior.modAutoExtendBelow).toBe(15);
    expect(normalizeBehavior({ modAutoExtendBelow: 0 }).modAutoExtendBelow).toBe(0);
    expect(normalizeBehavior({ modAutoExtendBelow: 500 }).modAutoExtendBelow).toBe(100);
    expect(normalizeBehavior({ modAutoExtendBelow: -3 }).modAutoExtendBelow).toBe(0);
    expect(normalizeBehavior({ modAutoExtendBelow: "x" }).modAutoExtendBelow).toBe(15);
    expect(normalizeBehavior({ modAutoExtendBelow: 40 }).modAutoExtendBelow).toBe(40);
  });
});
