import { describe, expect, it } from "vitest";
import { buildInstallIndex, installStateOf } from "./installState";
import type { ModUpdateItem } from "./updates";

const update = { path: "/m/a.jar", filename: "a.jar", title: "A", source: "curseforge", enabled: true, currentVersion: "1", newVersion: "2", record: { source: "curseforge", projectId: "10", fileId: "2" }, apply: { kind: "manual", pageUrl: "https://x", reason: "r" } } as ModUpdateItem;

describe("install state of listed mods", () => {
  const index = buildInstallIndex("t", [
    { source: "curseforge", projectId: "10", version: "1" },
    { source: "modrinth", projectId: "AA", version: "0.6", enabled: false },
    { source: "manual", projectId: "" },
  ], [
    { tofuId: "t", projectId: "77", provider: "nexus", status: "downloading", downloaded: 50, total: 200, createdAt: 2 },
    { tofuId: "t", projectId: "77", provider: "nexus", status: "failed", downloaded: 0, createdAt: 1 },
    { tofuId: "other", projectId: "88", provider: "nexus", status: "downloading", downloaded: 0, createdAt: 1 },
    { tofuId: "t", projectId: "99", provider: "curseforge", status: "completed", downloaded: 1, createdAt: 1 },
  ], [update]);

  it("tells downloading, update, installed and nothing apart", () => {
    expect(installStateOf(index, { source: "nexus", id: "77" })).toEqual({ kind: "downloading", progress: 0.25 });
    expect(installStateOf(index, { source: "curseforge", id: "10" })).toMatchObject({ kind: "update", version: "1" });
    expect(installStateOf(index, { source: "modrinth", id: "AA" })).toEqual({ kind: "installed", version: "0.6", enabled: false });
    expect(installStateOf(index, { source: "curseforge", id: "99" })).toEqual({ kind: "installed", enabled: true });
    // Other Tofus' downloads and other sites with the same id do not count.
    expect(installStateOf(index, { source: "nexus", id: "88" })).toEqual({ kind: "none" });
    expect(installStateOf(index, { source: "modrinth", id: "10" })).toEqual({ kind: "none" });
  });
});
