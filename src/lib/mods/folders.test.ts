import { describe, expect, it } from "vitest";
import type { Tofu } from "../../models";
import { applyLocation, applyManualFolder, bestPick, describeFolders, setSeparateStore } from "./folders";

const tofu = (over: Partial<Tofu> = {}): Tofu => ({ id: "t", name: "T", version: "Local", runtime: "Native", mods: 0, status: "Ready", ...over });
const location = { modsDir: "/pm/inst/.minecraft/mods", contentRoot: "/pm/inst/.minecraft", loader: "fabric" as const, gameVersion: "1.20.1" };

describe("folder choices", () => {
  it("works directly on a detected folder and learns loader and version", () => {
    expect(applyLocation(tofu(), location)).toEqual({ path: location.modsDir, gameDir: location.modsDir, contentRoot: location.contentRoot, loader: "fabric", version: "1.20.1" });
  });
  it("can keep the Tofu's mods apart in a store", () => {
    expect(applyLocation(tofu(), location, { keepSeparate: true, storeDir: "/data/t/files" })).toMatchObject({ path: "/data/t/files", gameDir: location.modsDir });
    // Without a store dir the request cannot be honoured, so it falls back to the game folder.
    expect(applyLocation(tofu(), location, { keepSeparate: true }).path).toBe(location.modsDir);
  });
  it("keeps what the user typed when detection knows nothing", () => {
    const patch = applyLocation(tofu({ loader: "forge", version: "1.12.2" }), { modsDir: "/x/mods" });
    expect(patch).not.toHaveProperty("loader");
    expect(patch).not.toHaveProperty("version");
  });
  it("manual folders keep an existing separate store", () => {
    expect(applyManualFolder(tofu(), "/g/mods")).toMatchObject({ path: "/g/mods", gameDir: "/g/mods" });
    expect(applyManualFolder(tofu({ path: "/store", gameDir: "/old" }), "/g/mods")).toMatchObject({ path: "/store", gameDir: "/g/mods" });
  });
  it("toggles the separate store", () => {
    expect(setSeparateStore(tofu({ path: "/g", gameDir: "/g" }), true, "/store")).toEqual({ path: "/store" });
    expect(setSeparateStore(tofu({ path: "/store", gameDir: "/g" }), false, "/store")).toEqual({ path: "/g" });
    expect(setSeparateStore(tofu(), true, "/store")).toBeUndefined();
  });
  it("describes folders and picks only an unambiguous location", () => {
    expect(describeFolders(tofu())).toBe("No folder chosen yet.");
    expect(describeFolders(tofu({ path: "/g", gameDir: "/g" }))).toContain("directly");
    expect(describeFolders(tofu({ path: "/s", gameDir: "/g" }))).toContain("copied to /g");
  });
  it("picks the best detected location", () => {
    expect(bestPick([{ exists: true, id: 1 }, { exists: false, id: 2 }])?.id).toBe(1);
    expect(bestPick([])).toBeUndefined();
    expect(bestPick([{ exists: false }])).toBeUndefined();
    // Several folders: the one with mods in it, else the first (table order).
    expect(bestPick([{ exists: true, id: "Mods", fileCount: 0 }, { exists: true, id: "BepInEx", fileCount: 4 }])?.id).toBe("BepInEx");
    expect(bestPick([{ exists: true, id: "a" }, { exists: true, id: "b" }])?.id).toBe("a");
    // Minecraft: the instance changed last among those with mods.
    const instances = [{ exists: true, id: "old", fileCount: 3, modifiedMs: 10 }, { exists: true, id: "new", fileCount: 9, modifiedMs: 99 }, { exists: true, id: "empty", fileCount: 0, modifiedMs: 500 }];
    expect(bestPick(instances, true)?.id).toBe("new");
    expect(bestPick(instances, false)?.id).toBe("old");
  });
});
