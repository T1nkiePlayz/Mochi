import { describe, expect, it } from "vitest";
import type { Tofu } from "../../models";
import { contentFolder, contentKindOf, hasSeparateStore, modSyncFor } from "./targets";

const tofu = (over: Partial<Tofu> = {}): Tofu => ({ id: "t1", name: "T", version: "1.20.1", runtime: "Native", mods: 0, status: "Ready", ...over });

describe("content targets", () => {
  it("knows when a Tofu has its own store", () => {
    expect(hasSeparateStore(tofu({ path: "/a", gameDir: "/b" }))).toBe(true);
    expect(hasSeparateStore(tofu({ path: "/a/", gameDir: "/a" }))).toBe(false);
    expect(hasSeparateStore(tofu({ path: "/a" }))).toBe(false);
  });
  it("routes mods, resource packs and shaders", () => {
    const separate = tofu({ path: "/store", gameDir: "/game/mods", contentRoot: "/game" });
    expect(contentFolder(separate, "mod")).toEqual({ path: "/store" });
    expect(contentFolder(separate, "resourcepack")).toEqual({ path: "/store", subdir: "resourcepacks" });
    const direct = tofu({ path: "/game/mods", gameDir: "/game/mods", contentRoot: "/game" });
    expect(contentFolder(direct, "shader")).toEqual({ path: "/game", subdir: "shaderpacks" });
    expect(contentFolder(tofu({ path: "/legacy" }), "resourcepack")).toEqual({ path: "/legacy" });
    expect(contentFolder(tofu(), "mod")).toBeUndefined();
  });
  it("only syncs separate stores", () => {
    expect(modSyncFor(tofu({ path: "/a", gameDir: "/a" }))).toBeUndefined();
    expect(modSyncFor(tofu({ path: "/a", gameDir: "/b", contentRoot: "/c" }))).toEqual({ tofuId: "t1", storeDir: "/a", gameDir: "/b", contentRoot: "/c" });
    expect(modSyncFor(tofu({ path: "/a", gameDir: "/b", syncReplaceExisting: true }))?.adoptUnmanaged).toBe(true);
    expect(modSyncFor(undefined)).toBeUndefined();
  });
  it("reads content kinds from labels", () => {
    expect([contentKindOf("Resource Packs"), contentKindOf("Shaders"), contentKindOf("Mods"), contentKindOf(undefined)]).toEqual(["resourcepack", "shader", "mod", "mod"]);
  });
});
