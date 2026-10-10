import { describe, expect, it } from "vitest";
import { mergeCloudLibrary } from "./cloud";
import type { Piko } from "../models";

const tofu = (id: string, extra = {}) => ({ id, name: id, version: "1", runtime: "Native", mods: 0, status: "Ready" as const, ...extra });
const piko = (id: string, extra: Partial<Piko> = {}): Piko => ({ id, name: id, description: "", accent: "#fff", artwork: "", tofus: [tofu("default")], ...extra });

describe("mergeCloudLibrary", () => {
  it("keeps local-only data when the cloud copy wins", () => {
    const local = [piko("a", { installPath: "/g", collectionIds: ["c"], lockedFields: ["name"], artwork: "local-art", artworkCacheKey: "k", tofus: [tofu("default", { path: "/mods", launch: { wrappers: [], args: "-x", env: "" } })] })];
    const cloud = [piko("a", { name: "Cloud name", artwork: "", tofus: [tofu("default", { mods: 3 })] })];
    const [merged] = mergeCloudLibrary(local, cloud);
    expect(merged!.name).toBe("Cloud name");
    expect(merged!.installPath).toBe("/g");
    expect(merged!.collectionIds).toEqual(["c"]);
    expect(merged!.artwork).toBe("local-art");
    expect(merged!.tofus[0]).toMatchObject({ mods: 3, path: "/mods", launch: { args: "-x" } });
  });
  it("keeps device-only games after the cloud ones", () => {
    expect(mergeCloudLibrary([piko("x"), piko("a")], [piko("a"), piko("b")]).map((p) => p.id)).toEqual(["a", "b", "x"]);
  });
  it("keeps merge data local and does not bring back a game that was merged into another", () => {
    const local = [piko("a", { launchSources: [{ id: "a", label: "Steam", executablePath: "s" }, { id: "b", label: "Heroic", executablePath: "h" }], preferredSource: "b", mergedFrom: [piko("b")] })];
    const merged = mergeCloudLibrary(local, [piko("a"), piko("b")]);
    expect(merged.map((p) => p.id)).toEqual(["a"]);
    expect(merged[0]).toMatchObject({ preferredSource: "b", launchSources: [{ id: "a" }, { id: "b" }], mergedFrom: [{ id: "b" }] });
  });
});
