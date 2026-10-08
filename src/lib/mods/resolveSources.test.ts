import { describe, expect, it } from "vitest";
import { allSourcesOn, isPublicCurseforgeGame, minecraftSourceFor, resolveSources, tabSource } from "./resolveSources";

describe("resolveSources", () => {
  it("Minecraft lists Modrinth then CurseForge, honouring switches", () => {
    expect(resolveSources({ minecraft: true }, allSourcesOn)).toEqual(["modrinth", "curseforge"]);
    expect(resolveSources({ minecraft: true }, { ...allSourcesOn, modrinth: false })).toEqual(["curseforge"]);
  });
  it("CurseForge beats Nexus; Nexus needs a key", () => {
    expect(resolveSources({ curseforge: true, nexus: true, nexusKey: true }, allSourcesOn)).toEqual(["curseforge"]);
    expect(resolveSources({ nexus: true }, allSourcesOn)).toEqual([]);
    expect(resolveSources({ curseforge: true, nexus: true, nexusKey: true }, { ...allSourcesOn, curseforge: false })).toEqual(["nexus"]);
  });
  it("shaders fall back to CurseForge when Modrinth is off, worlds never use Modrinth", () => {
    expect(minecraftSourceFor("shader", "modrinth", { ...allSourcesOn, modrinth: false })).toBe("curseforge");
    expect(minecraftSourceFor("world", "modrinth", allSourcesOn)).toBe("curseforge");
    expect(minecraftSourceFor("world", "modrinth", { ...allSourcesOn, curseforge: false })).toBeNull();
  });
  it("tabs and public games", () => {
    expect(tabSource({ onCurseforge: false, onNexus: true }, allSourcesOn, false)).toBeNull();
    expect(isPublicCurseforgeGame({ apiStatus: 2 })).toBe(true);
    expect(isPublicCurseforgeGame({ apiStatus: 1 })).toBe(false);
  });
});
