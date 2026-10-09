import { describe, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
import type { Piko } from "../models";
import { addFolder, autoBackupEnabled, closedGames, describeAuto, describeResult, groupLocations, hasSaveSources, removeFolder, saveHints, type SaveLocation } from "./saveBackups";

const piko = (over: Partial<Piko>): Piko => ({ id: "g", name: "Game", description: "", accent: "#000", artwork: "", tofus: [], ...over });
const location = (over: Partial<SaveLocation>): SaveLocation => ({ key: "k", kind: "custom", label: "L", group: null, path: "/p", source: null, problem: null, backups: 0, lastBackup: null, backupBytes: 0, ...over });

describe("save backup hints", () => {
  it("lists Minecraft instances with a game folder", () => {
    const mc = piko({ id: "minecraft", tofus: [
      { id: "a", name: "Fabric", version: "1", runtime: "prism", mods: 0, status: "Ready", contentRoot: "/inst/a/.minecraft" },
      { id: "b", name: "No folder", version: "1", runtime: "prism", mods: 0, status: "Ready" },
    ] });
    expect(saveHints(mc).instances).toEqual([{ id: "a", name: "Fabric", contentRoot: "/inst/a/.minecraft" }]);
    expect(saveHints(piko({ id: "other", tofus: mc.tofus })).instances).toEqual([]);
  });
  it("reads the Steam id and user folders", () => {
    const hints = saveHints(piko({ id: "steam:480", sourceId: "steam", saveBackup: { folders: ["/a"] } }));
    expect(hints.steamAppId).toBe(480);
    expect(hints.folders).toEqual(["/a"]);
    expect(hasSaveSources(hints)).toBe(true);
    expect(hasSaveSources(saveHints(piko({})))).toBe(false);
  });
  it("backs up on exit by default only for Minecraft", () => {
    expect(autoBackupEnabled(piko({ id: "minecraft" }))).toBe(true);
    expect(autoBackupEnabled(piko({ id: "x" }))).toBe(false);
    expect(autoBackupEnabled(piko({ id: "x", saveBackup: { auto: true } }))).toBe(true);
    expect(autoBackupEnabled(piko({ id: "minecraft", saveBackup: { auto: false } }))).toBe(false);
  });
});

describe("folders and exits", () => {
  it("adds a folder once and removes it", () => {
    const one = addFolder(undefined, "/saves/game/");
    expect(one).toEqual(["/saves/game"]);
    expect(addFolder(one, "/saves/game")).toBe(one);
    expect(addFolder(one, "  ")).toBe(one);
    expect(removeFolder(one, "/saves/game")).toEqual([]);
    expect(removeFolder(undefined, "/x")).toEqual([]);
  });
  it("finds the games that stopped running", () => {
    expect(closedGames(new Set(["a", "b"]), new Set(["b", "c"]))).toEqual(["a"]);
    expect(closedGames(new Set(), new Set(["a"]))).toEqual([]);
  });
});

describe("grouping and messages", () => {
  it("groups worlds by instance, then Steam, then added folders", () => {
    const groups = groupLocations([location({ key: "1", kind: "minecraft", group: "Pack A" }), location({ key: "2", kind: "steam" }), location({ key: "3", kind: "minecraft", group: "Pack A" }), location({ key: "4" })]);
    expect(groups.map(([heading, items]) => [heading, items.map((item) => item.key)])).toEqual([["Pack A", ["1", "3"]], ["Steam", ["2"]], ["Added folders", ["4"]]]);
  });
  it("explains why no backup was made", () => {
    expect(describeResult({ backup: null, skipped: "unchanged" })).toMatch(/Nothing changed/);
    expect(describeResult({ backup: null, skipped: "empty" })).toMatch(/empty/);
  });
  it("only reports automatic backups that did something", () => {
    expect(describeAuto({ created: 0, unchanged: 3, failed: 0, firstError: null })).toBeNull();
    expect(describeAuto({ created: 2, unchanged: 0, failed: 0, firstError: null })?.message).toBe("2 save folders backed up.");
    expect(describeAuto({ created: 1, unchanged: 0, failed: 0, firstError: null })?.message).toBe("1 save folder backed up.");
    expect(describeAuto({ created: 1, unchanged: 0, failed: 1, firstError: "No space" })).toEqual({ title: "Save backup failed", message: "No space" });
  });
});
