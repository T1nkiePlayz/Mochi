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
});
