import { describe, expect, it } from "vitest";
import type { Tofu } from "../../models";
import { bestCompatibility, compatibility, compareGameVersions, groupTofusByLoader, metaFromCurseforgeVersions, parseLoader, tofuTarget, translateCompatibilityReason } from "./compat";

const tofu = (over: Partial<Tofu> = {}): Tofu => ({ id: "t", name: "T", version: "1.20.1", runtime: "Native", mods: 0, status: "Ready", loader: "fabric", ...over });

describe("compatibility", () => {
  it("matches loader and version", () => {
    expect(compatibility({ gameVersions: ["1.20.1", "1.20"], loaders: ["fabric"] }, tofu())).toEqual({ status: "compatible", reasons: [] });
  });
  it("same release series is only a maybe", () => {
    const result = compatibility({ gameVersions: ["1.20.4"], loaders: ["fabric"] }, tofu());
    expect(result.status).toBe("maybe");
    expect(result.reasons[0]).toContain("1.20.4");
  });
  it("other versions and loaders are incompatible with reasons", () => {
    const old = compatibility({ gameVersions: ["1.16.5"], loaders: ["fabric"] }, tofu());
    expect(old.status).toBe("incompatible");
    const forge = compatibility({ gameVersions: ["1.20.1"], loaders: ["forge"] }, tofu());
    expect(forge).toEqual({ status: "incompatible", reasons: ["Built for Forge, but this Tofu uses Fabric."] });
    expect(compatibility({ gameVersions: ["1.20.1"], loaders: ["fabric"] }, tofu({ loader: "vanilla" })).status).toBe("incompatible");
  });
  it("unknown information is a maybe, never a hard no", () => {
    expect(compatibility({ gameVersions: ["1.20.1"], loaders: ["fabric"] }, tofu({ loader: undefined, name: "My pack" })).status).toBe("maybe");
    expect(compatibility({ loaders: ["fabric"] }, tofu()).status).toBe("maybe");
    expect(compatibility({ gameVersions: ["1.20.1"], loaders: ["fabric"] }, tofu({ version: "Local" })).status).toBe("maybe");
  });
  it("resource packs and shaders need no loader", () => {
    expect(compatibility({ gameVersions: ["1.20.1"], loaders: [] }, tofu({ loader: "vanilla" })).status).toBe("compatible");
    expect(compatibility({ gameVersions: ["1.20.1"], loaders: ["iris", "minecraft"] }, tofu({ loader: "vanilla" })).status).toBe("compatible");
  });
  it("quilt runs Fabric mods and NeoForge 1.20.1 runs Forge mods, with caveats", () => {
    expect(compatibility({ gameVersions: ["1.20.1"], loaders: ["fabric"] }, tofu({ loader: "quilt" })).status).toBe("maybe");
    expect(compatibility({ gameVersions: ["1.20.1"], loaders: ["forge"] }, tofu({ loader: "neoforge" })).status).toBe("maybe");
    expect(compatibility({ gameVersions: ["1.21.1"], loaders: ["forge"] }, tofu({ loader: "neoforge", version: "1.21.1" })).status).toBe("incompatible");
    expect(compatibility({ gameVersions: ["1.20.1"], loaders: ["quilt"] }, tofu()).status).toBe("incompatible");
  });
  it("accepts a bare target and reads text when the loader field is unset", () => {
    expect(compatibility({ gameVersions: ["1.21"], loaders: ["neoforge"] }, { loader: "neoforge", gameVersion: "1.21" }).status).toBe("compatible");
    expect(tofuTarget(tofu({ loader: undefined, runtime: "NeoForge 21", version: "1.21.1" }))).toEqual({ loader: "neoforge", gameVersion: "1.21.1" });
  });
  it("bestCompatibility picks the file that fits best", () => {
    const files = [{ gameVersions: ["1.19"], loaders: ["fabric"] }, { gameVersions: ["1.20.1"], loaders: ["fabric"] }];
    expect(bestCompatibility(files, tofu()).status).toBe("compatible");
    expect(bestCompatibility([], tofu()).status).toBe("maybe");
  });
});

describe("helpers", () => {
  it("splits CurseForge version tags", () => {
    expect(metaFromCurseforgeVersions(["1.20.1", "Fabric", "Java 17", "1.20", "Client"])).toEqual({ gameVersions: ["1.20.1", "1.20"], loaders: ["fabric"] });
    expect(parseLoader("NeoForge")).toBe("neoforge");
    expect(parseLoader("Forge")).toBe("forge");
    expect(parseLoader("Iris")).toBeUndefined();
  });
  it("compares game versions numerically", () => {
    expect(compareGameVersions("1.20.1", "1.9")).toBeGreaterThan(0);
    expect(compareGameVersions("1.20", "1.20.0")).toBe(0);
    expect(compareGameVersions(undefined, "1.20")).toBeGreaterThan(0);
  });
  it("groups by loader then newest version", () => {
    const list = [
      tofu({ id: "a", name: "A", loader: "forge", version: "1.12.2" }), tofu({ id: "b", name: "B", loader: "fabric", version: "1.20.1" }),
      tofu({ id: "c", name: "C", loader: "fabric", version: "1.21.4" }), tofu({ id: "d", name: "D", loader: undefined, version: "Local", runtime: "Native" }),
      tofu({ id: "e", name: "E", loader: "vanilla", version: "1.21" }),
    ];
    const groups = groupTofusByLoader(list);
    expect(groups.map((group) => group.label)).toEqual(["Vanilla", "Fabric", "Forge", "No loader set"]);
    expect(groups[1].tofus.map((item) => item.id)).toEqual(["c", "b"]);
  });
});


describe("translateCompatibilityReason", () => {
  const t = (message: string) => `[${message}]`;
  it("translates reason templates while preserving version and loader details", () => {
    expect(translateCompatibilityReason("Built for 1.20.1, not 1.21.0.", t)).toBe("[Built for {versions}, not {gameVersion}.]".replace("{versions}", "1.20.1").replace("{gameVersion}", "1.21.0"));
    expect(translateCompatibilityReason("Needs Fabric; this Tofu has no loader set.", t)).toBe("[Needs {loaders}; this Tofu has no loader set.]".replace("{loaders}", "Fabric"));
    expect(translateCompatibilityReason("This Tofu has no game version set.", t)).toBe("[This Tofu has no game version set.]");
  });
});
