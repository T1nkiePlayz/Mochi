import { describe, expect, it, vi } from "vitest";
import { identifyFiles, matchCurseforge, titleFromFile, type FileHashes } from "./identify";

const file = (name: string, n: number): FileHashes => ({ path: `/mods/${name}`, filename: name, size: 10, sha1: `${n}`.padStart(40, "a"), md5: `${n}`.padStart(32, "b"), fingerprint: 1000 + n });

describe("identifying installed mods", () => {
  it("derives titles from file names", () => {
    expect(titleFromFile("jei-1.20.1-forge-15.2.0.27.jar")).toBe("jei");
    expect(titleFromFile("BetterUI.dll.disabled")).toBe("BetterUI");
    expect(titleFromFile("Calamity_Mod_v2.0.tmod")).toBe("Calamity Mod");
    expect(titleFromFile("1.2.3.zip")).toBe("1.2.3");
  });

  it("asks each site only about what is still unknown and records file dates", async () => {
    const files = [file("sodium.jar", 1), file("jei.jar", 2), file("skyui.7z", 3), file("mystery.jar", 4)];
    const modrinth = vi.fn(async () => ({ [files[0].sha1]: { projectId: "AANobbMI", versionId: "v6", versionNumber: "0.6.0", title: "Sodium", datePublished: "2024-05-01T00:00:00Z" } }));
    const curseforge = vi.fn(async (prints: number[]) => {
      expect(prints).toEqual([1002, 1003, 1004]);
      return [{ id: 238222, file: { id: 55, displayName: "JEI 15.2", fileName: "jei.jar", fileDate: "2024-01-01T00:00:00Z", fileFingerprint: 1002 } }];
    });
    const curseforgeNames = vi.fn(async () => new Map([[238222, "Just Enough Items"]]));
    const nexus = vi.fn(async (md5s: string[]) => {
      expect(md5s).toEqual([files[2].md5, files[3].md5]);
      return [{ md5: files[2].md5, modId: 3863, fileId: 1000, name: "SkyUI", version: "5.2", fileName: "skyui.7z", uploadedAt: 1_600_000_000 }];
    });
    const { found, notes } = await identifyFiles(files, { modrinth, curseforge, curseforgeNames, nexus });
    expect(notes).toEqual([]);
    expect(found.get("/mods/sodium.jar")).toMatchObject({ source: "modrinth", projectId: "AANobbMI", fileId: "v6", title: "Sodium" });
    expect(found.get("/mods/jei.jar")).toMatchObject({ source: "curseforge", projectId: "238222", fileId: "55", title: "Just Enough Items", fileDate: "2024-01-01T00:00:00Z" });
    expect(found.get("/mods/skyui.7z")).toMatchObject({ source: "nexus", projectId: "3863", fileId: "1000", version: "5.2", fileDate: "2020-09-13T12:26:40.000Z" });
    expect(found.has("/mods/mystery.jar")).toBe(false);
  });

  it("keeps going when a site fails and skips sites with nothing left to ask", async () => {
    const files = [file("a.jar", 1)];
    const nexus = vi.fn(async () => []);
    const result = await identifyFiles(files, {
      modrinth: async () => { throw new Error("offline"); },
      curseforge: async () => [{ id: 9, file: { id: 1, fileName: "a-1.0.jar", fileFingerprint: 1001 } }],
      nexus,
    });
    expect(result.notes).toEqual(["Modrinth: offline"]);
    expect(result.found.get("/mods/a.jar")?.title).toBe("a");
    expect(nexus).not.toHaveBeenCalled();
  });

  it("ignores fingerprint answers for other files", () => {
    expect(matchCurseforge([file("a.jar", 1)], [{ id: 1, file: { id: 2, fileFingerprint: 42 } }], new Map()).size).toBe(0);
  });
});
