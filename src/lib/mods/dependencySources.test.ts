import { describe, expect, it, vi } from "vitest";
import type { CfFile, CfMod } from "../curseforge";
import type { ModrinthVersion } from "../modrinth";

vi.mock("../curseforge", async (original) => ({ ...(await original<typeof import("../curseforge")>()), cfMod: vi.fn(async (id: number) => ({ id, gameId: 432, name: "Lib", slug: "lib", summary: "", downloadCount: 0, classId: 6552 })) }));
const getNexusRequirements = vi.fn();
vi.mock("../nexus", async (original) => ({ ...(await original<typeof import("../nexus")>()), getNexusRequirements: (...args: unknown[]) => getNexusRequirements(...args) }));

const { curseforgeFile, createCurseforgeSource, CF_RELATION } = await import("./curseforgeSource");
const { modrinthFile } = await import("./modrinthSource");
const { createNexusSource } = await import("./nexusSource");

describe("CurseForge relation types", () => {
  const file = { id: 1, modId: 9, displayName: "x", fileName: "x.jar", releaseType: 1, dependencies: [1, 2, 3, 4, 5, 6].map((relationType) => ({ modId: 100 + relationType, relationType })) } as CfFile;
  it("keeps only required (3) as dependencies and incompatible (5) as conflicts", () => {
    const mapped = curseforgeFile(file, { id: 9 } as CfMod);
    expect(CF_RELATION).toMatchObject({ required: 3, incompatible: 5 });
    expect(mapped.dependencies?.map((dependency) => dependency.id)).toEqual(["103"]);
    expect(mapped.incompatibles?.map((dependency) => dependency.id)).toEqual(["105"]);
  });
  it("builds the dependency's listing with the folder kind of its class", async () => {
    const source = createCurseforgeSource({ gameId: 432, gameSlug: "minecraft", classId: 6, kind: "Mods" });
    expect((await source.dependencyItem!({ id: "77", url: "", required: true }))).toMatchObject({ id: "77", kind: "Shaders", source: "curseforge" });
  });
});

describe("Modrinth dependency types", () => {
  it("maps required (with a pinned version) and incompatible, ignoring optional, embedded and version-only entries", () => {
    const version = { id: "v", name: "v", version_number: "1", game_versions: [], loaders: [], featured: false, date_published: "", files: [{ filename: "a.jar", url: "u", primary: true, size: 1, hashes: {} }],
      dependencies: [{ project_id: "req", version_id: "pin", dependency_type: "required" }, { project_id: "opt", dependency_type: "optional" }, { project_id: "emb", dependency_type: "embedded" }, { project_id: "bad", dependency_type: "incompatible" }, { version_id: "only", dependency_type: "required" }] } as unknown as ModrinthVersion;
    const mapped = modrinthFile(version)!;
    expect(mapped.dependencies).toEqual([expect.objectContaining({ id: "req", versionId: "pin" })]);
    expect(mapped.incompatibles?.map((dependency) => dependency.id)).toEqual(["bad"]);
  });
});

describe("Nexus requirements", () => {
  const source = createNexusSource({} as never, { domain: "skyrimspecialedition", name: "Skyrim" });
  const item = { source: "nexus" as const, id: "12604", name: "SkyUI", summary: "", pageUrl: "", native: {} };
  it("maps same-game requirements to installable dependencies and outside ones to links", async () => {
    getNexusRequirements.mockResolvedValueOnce([
      { modId: 30379, name: "SKSE64", external: false },
      { modId: 5, name: "Framework", external: true, url: "https://example.com/fw" },
      { modId: 8, name: "Other game mod", external: false, gameDomain: "skyrim" },
    ]);
    const { required } = await source.requirements!(item);
    expect(getNexusRequirements).toHaveBeenCalledWith("skyrimspecialedition", 12604);
    expect(required).toEqual([
      { id: "30379", name: "SKSE64", url: "https://www.nexusmods.com/skyrimspecialedition/mods/30379", required: true },
      { id: "5", name: "Framework", url: "https://example.com/fw", required: true, external: true },
      { id: "8", name: "Other game mod", url: "https://www.nexusmods.com/skyrim/mods/8", required: true, external: true, gameDomain: "skyrim" },
    ]);
  });
  it("never builds a listing for an external requirement", async () => {
    expect(await source.dependencyItem!({ id: "5", url: "https://example.com", required: true, external: true })).toBeNull();
    expect(await source.dependencyItem!({ id: "30379", name: "SKSE64", url: "https://www.nexusmods.com/skyrimspecialedition/mods/30379", required: true })).toMatchObject({ id: "30379", name: "SKSE64", source: "nexus" });
  });
});
