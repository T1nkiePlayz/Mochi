import { describe, expect, it, vi } from "vitest";
import { createLimiter } from "./limit";
import { candidateNames, confidentHit, limitedApi, matchInstancePack, normalizeTitle, pickPackUpdate, type PackApi, type PackHit } from "./packMatch";

const hit = (title: string, over: Partial<PackHit> = {}): PackHit => ({ projectId: title.replace(/\W/g, "").toLowerCase(), title, gameVersions: ["1.21.1"], loaders: ["fabric"], ...over });
const target = { name: "Fabulously Optimized", gameVersion: "1.21.1", loader: "fabric" };
const api = (over: Partial<PackApi> = {}): PackApi => ({
  searchModrinth: async () => [], modrinthVersions: async () => [{ id: "v1", name: "5.0", number: "5.0.0" }], searchCurseforge: async () => [], ...over,
});
const sources = { modrinth: true, curseforge: true };

describe("confidentHit", () => {
  it("accepts an exact or normalized title", () => {
    expect(confidentHit([hit("Fabulously Optimized")], target)?.title).toBe("Fabulously Optimized");
    expect(confidentHit([hit("fabulously-optimized")], target)?.title).toBe("fabulously-optimized");
    expect(confidentHit([hit("Fabulously Optimized")], { ...target, name: "Fabulously Optimized 1.21.1" })).toBeTruthy();
  });
  it("rejects near misses", () => {
    expect(confidentHit([hit("Fabulously Optimized Lite")], target)).toBeUndefined();
    expect(confidentHit([hit("Optimized")], target)).toBeUndefined();
    expect(confidentHit([hit("Fabulously Optimised")], target)).toBeUndefined();
  });
  it("rejects a game version or loader mismatch", () => {
    expect(confidentHit([hit("Fabulously Optimized", { gameVersions: ["1.20.1"] })], target)).toBeUndefined();
    expect(confidentHit([hit("Fabulously Optimized", { loaders: ["forge"] })], target)).toBeUndefined();
    expect(confidentHit([hit("Fabulously Optimized")], { ...target, loader: "vanilla" })).toBeUndefined();
    expect(confidentHit([hit("Fabulously Optimized")], { name: "Fabulously Optimized" })).toBeUndefined();
  });
  it("rejects ambiguity between different projects", () => {
    expect(confidentHit([hit("Fabulously Optimized", { projectId: "a" }), hit("Fabulously Optimized", { projectId: "b" })], target)).toBeUndefined();
  });
  it("normalizes names", () => {
    expect(normalizeTitle("Better MC [FABRIC] – BMC4")).toBe("better mc fabric bmc4");
    expect(candidateNames({ name: "All the Mods 9 neoforge", loader: "neoforge" })).toEqual(["all the mods 9 neoforge", "all the mods 9"]);
  });
});

describe("matchInstancePack", () => {
  it("trusts the launcher's own record without any request", async () => {
    const search = vi.fn(async () => []);
    const out = await matchInstancePack(api({ searchModrinth: search }), target, { pack: { source: "curseforge", projectId: "715572", versionId: "9" } }, sources);
    expect(out.pack).toEqual({ source: "curseforge", projectId: "715572", versionId: "9", matchedBy: "managed" });
    expect(search).not.toHaveBeenCalled();
  });
  it("matches by name on Modrinth first and checks the pack has a version for the instance", async () => {
    const out = await matchInstancePack(api({ searchModrinth: async () => [hit("Fabulously Optimized")] }), target, null, sources);
    expect(out.pack).toMatchObject({ source: "modrinth", matchedBy: "search" });
    const none = await matchInstancePack(api({ searchModrinth: async () => [hit("Fabulously Optimized")], modrinthVersions: async () => [] }), target, null, sources);
    expect(none.pack).toBeNull();
  });
  it("uses the manifest name and version number, and falls back to CurseForge", async () => {
    const versions = [{ id: "v34", name: "Release 34", number: "v34" }, { id: "v33", name: "x", number: "v33" }];
    const index = await matchInstancePack(api({ searchModrinth: async () => [hit("Better MC [FABRIC] BMC4")], modrinthVersions: async () => versions }),
      { ...target, name: "my copy" }, { index: { source: "modrinth", name: "Better MC [FABRIC] BMC4", version: "v34" } }, sources);
    expect(index.pack).toEqual({ source: "modrinth", projectId: "bettermcfabricbmc4", versionId: "v34", matchedBy: "index" });
    const cf = await matchInstancePack(api({ searchCurseforge: async () => [hit("Fabulously Optimized", { projectId: "123" })] }), target, null, sources);
    expect(cf.pack).toEqual({ source: "curseforge", projectId: "123", matchedBy: "search" });
    expect((await matchInstancePack(api({ searchCurseforge: async () => [hit("Fabulously Optimized", { projectId: "123" })] }), target, null, { modrinth: true, curseforge: false })).pack).toBeNull();
  });
  it("reports failures so a network error is not remembered as 'no pack'", async () => {
    const out = await matchInstancePack(api({ searchModrinth: async () => { throw new Error("offline"); } }), target, null, { modrinth: true, curseforge: false });
    expect(out).toEqual({ pack: null, failed: true });
  });
});

describe("pickPackUpdate", () => {
  const versions = [
    { id: "a", name: "1", number: "1.0", date: "2025-01-01T00:00:00Z" }, { id: "b", name: "2", number: "2.0", date: "2025-03-01T00:00:00Z" },
    { id: "c", name: "3b", number: "3.0-beta", date: "2025-04-01T00:00:00Z", channel: "beta" as const },
  ];
  it("offers the newest release newer than the installed one", () => { expect(pickPackUpdate("a", versions)).toEqual({ versionId: "b", versionName: "2.0" }); });
  it("offers nothing when up to date or the installed version is unknown", () => {
    expect(pickPackUpdate("b", versions)).toBeUndefined();
    expect(pickPackUpdate("zzz", versions)).toBeUndefined();
    expect(pickPackUpdate(undefined, versions)).toBeUndefined();
  });
});

describe("throttling", () => {
  it("never has more than two requests in flight", async () => {
    let live = 0, peak = 0;
    const slow = async () => { live += 1; peak = Math.max(peak, live); await new Promise((resolve) => setTimeout(resolve, 5)); live -= 1; return []; };
    const limited = limitedApi(api({ searchModrinth: slow, searchCurseforge: slow }), createLimiter(2));
    await Promise.all(Array.from({ length: 12 }, (_, index) => (index % 2 ? limited.searchModrinth("x", "1.21.1") : limited.searchCurseforge("x", "1.21.1", "fabric"))));
    expect(peak).toBe(2);
  });
});
