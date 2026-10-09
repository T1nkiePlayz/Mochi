import { describe, expect, it, vi } from "vitest";
import { SnapshotError, cleanSnapshotError, lastWorkingSnapshot, snapshotFolders, withSnapshot, type SnapshotInfo } from "./snapshots";

const tofu = { id: "t1", path: "/g/store", gameDir: "/g/game", contentRoot: "/g/game" };
const snap = (id: string, createdAt: number, isRestore = false): SnapshotInfo => ({ id, createdAt, reason: "", isRestore, files: 1, size: 1, folders: 1, reused: false });

describe("withSnapshot", () => {
  it("saves the snapshot first, then runs the work, and returns its result", async () => {
    const order: string[] = [];
    const result = await withSnapshot(tofu, "Before x", async () => { order.push("fn"); return 7; }, { create: async (id, folders, reason) => { order.push(`snapshot ${id} ${reason} ${folders.length}`); } });
    expect(order).toEqual(["snapshot t1 Before x 3", "fn"]);
    expect(result).toBe(7);
  });
  it("does not run the work when the snapshot fails", async () => {
    const fn = vi.fn(async () => 1);
    await expect(withSnapshot(tofu, "r", fn, { create: async () => { throw "disk full"; } })).rejects.toBeInstanceOf(SnapshotError);
    await expect(withSnapshot(tofu, "r", fn, { create: async () => { throw new Error("disk full"); } })).rejects.toThrow(/nothing was changed: disk full/);
    expect(fn).not.toHaveBeenCalled();
  });
  it("carries on without a snapshot when the Tofu is too big or empty", async () => {
    const fn = vi.fn(async () => "done");
    const skipped = vi.fn();
    expect(await withSnapshot(tofu, "r", fn, { create: async () => { throw "snapshot-too-large: over the limit."; }, onSkipped: skipped })).toBe("done");
    expect(await withSnapshot(tofu, "r", fn, { create: async () => { throw "snapshot-empty: no folder."; }, onSkipped: skipped })).toBe("done");
    expect(skipped.mock.calls).toEqual([["over the limit."], ["no folder."]]);
  });
  it("lets errors from the work through unchanged and skips Tofus without a folder", async () => {
    const create = vi.fn(async () => undefined);
    const boom = new Error("update failed");
    await expect(withSnapshot(tofu, "r", async () => { throw boom; }, { create })).rejects.toBe(boom);
    expect(create).toHaveBeenCalledTimes(1);
    expect(await withSnapshot({ ...tofu, path: undefined }, "r", async () => 2, { create })).toBe(2);
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe("snapshot helpers", () => {
  it("covers the mods, resource pack and shader folders once each", () => {
    expect(snapshotFolders(tofu)).toEqual(["/g/store", "/g/store/resourcepacks", "/g/store/shaderpacks"]);
    expect(snapshotFolders({ path: "/g/game/mods", gameDir: "/g/game/mods", contentRoot: "/g/game" })).toEqual(["/g/game/mods", "/g/game/resourcepacks", "/g/game/shaderpacks"]);
    expect(snapshotFolders({ path: "/g/mods" })).toEqual(["/g/mods"]);
  });
  it("picks the newest snapshot that is not a restore's safety copy", () => {
    expect(lastWorkingSnapshot([snap("a", 1), snap("c", 3, true), snap("b", 2)])?.id).toBe("b");
    expect(lastWorkingSnapshot([snap("c", 3, true)])).toBeUndefined();
  });
  it("hides the machine prefixes", () => { expect(cleanSnapshotError("snapshot-too-large: too big")).toBe("too big"); expect(cleanSnapshotError("plain")).toBe("plain"); });
});
