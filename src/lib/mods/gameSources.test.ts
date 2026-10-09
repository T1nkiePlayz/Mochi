import { describe, expect, it } from "vitest";
import { resolveGameSources } from "./gameSources";
import { allSourcesOn } from "./resolveSources";

const both = { onCurseforge: true, onNexus: true, nexusKey: true, choice: "auto" as const };
describe("resolveGameSources", () => {
  it("auto: CurseForge first, Nexus offered as the extra", () => {
    const sources = resolveGameSources(both, allSourcesOn);
    expect(sources).toMatchObject({ primary: "curseforge", extras: ["nexus"], needsNexusKey: false });
    expect(sources.choices).toEqual(["auto", "curseforge", "nexus"]);
  });
  it("a pinned site uses only that site", () => {
    expect(resolveGameSources({ ...both, choice: "nexus" }, allSourcesOn)).toMatchObject({ primary: "nexus", extras: [] });
    expect(resolveGameSources({ ...both, choice: "curseforge" }, allSourcesOn)).toMatchObject({ primary: "curseforge", extras: [] });
  });
  it("Nexus without a key asks to connect and never lists", () => {
    expect(resolveGameSources({ ...both, nexusKey: false }, allSourcesOn)).toMatchObject({ primary: "curseforge", extras: [], needsNexusKey: true });
    expect(resolveGameSources({ onCurseforge: false, onNexus: true, nexusKey: false, choice: "auto" }, allSourcesOn)).toMatchObject({ primary: null, needsNexusKey: true });
  });
  it("switched-off sites disappear", () => {
    expect(resolveGameSources(both, { ...allSourcesOn, nexus: false })).toMatchObject({ primary: "curseforge", extras: [], choices: [], needsNexusKey: false });
    expect(resolveGameSources({ ...both, choice: "curseforge" }, { ...allSourcesOn, curseforge: false })).toMatchObject({ primary: "nexus" });
    expect(resolveGameSources({ ...both, choice: "nexus" }, { ...allSourcesOn, nexus: false })).toMatchObject({ primary: "curseforge" });
  });
});
