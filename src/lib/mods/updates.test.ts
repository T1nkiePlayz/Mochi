import { describe, expect, it } from "vitest";
import { dueForCheck, installableUpdates, pickUpdate, type ModUpdateItem, type UpdateCandidate } from "./updates";

const file = (over: Partial<UpdateCandidate>): UpdateCandidate => ({ id: "2", fileName: "m-2.jar", date: "2025-02-01T00:00:00Z", channel: "release", gameVersions: ["1.20.1"], loaders: ["fabric"], ...over });
const target = { loader: "fabric" as const, gameVersion: "1.20.1" };
const installed = { fileId: "1", fileDate: "2025-01-01T00:00:00Z" };

describe("pickUpdate", () => {
  it("offers the newest compatible release", () => {
    const files = [file({ id: "3", date: "2025-03-01T00:00:00Z" }), file({ id: "2" }), file({ id: "1", date: "2025-01-01T00:00:00Z" })];
    expect(pickUpdate(installed, files, target)?.id).toBe("3");
  });
  it("ignores older, same, beta and incompatible files", () => {
    const files = [file({ id: "1" }), file({ id: "0", date: "2024-01-01T00:00:00Z" }), file({ id: "5", channel: "beta" }), file({ id: "6", gameVersions: ["1.16.5"] }), file({ id: "7", loaders: ["forge"] })];
    expect(pickUpdate(installed, files, target)).toBeUndefined();
  });
  it("prefers a compatible file over a newer maybe", () => {
    const files = [file({ id: "9", date: "2025-09-01T00:00:00Z", gameVersions: ["1.20.4"] }), file({ id: "2" })];
    expect(pickUpdate(installed, files, target)?.id).toBe("2");
    expect(pickUpdate(installed, [files[0]], target)?.id).toBe("9");
  });
  it("never replaces a file whose date is unknown", () => {
    expect(pickUpdate({ fileId: "1" }, [file({})], target)).toBeUndefined();
    expect(pickUpdate({ fileId: "1", fileDate: "not a date" }, [file({})], target)).toBeUndefined();
  });
  it("still offers updates when the Tofu has no loader or version set", () => {
    expect(pickUpdate(installed, [file({})], {})?.id).toBe("2");
  });
});

describe("scheduling", () => {
  it("is due when never checked, stale or the clock went backwards", () => {
    const now = 10_000_000_000;
    expect(dueForCheck(undefined, now)).toBe(true);
    expect(dueForCheck(now - 1000, now)).toBe(false);
    expect(dueForCheck(now - 7 * 3600_000, now)).toBe(true);
    expect(dueForCheck(now + 5000, now)).toBe(true);
  });
  it("separates installable from manual updates", () => {
    const base = { path: "/a", filename: "a.jar", title: "A", source: "curseforge", enabled: true, currentVersion: "1", newVersion: "2", record: { source: "curseforge", projectId: "1", fileId: "2" } } as const;
    const items: ModUpdateItem[] = [{ ...base, apply: { kind: "download", provider: "curseforge", url: "https://edge.forgecdn.net/a.jar", filename: "a.jar" } }, { ...base, path: "/b", apply: { kind: "manual", pageUrl: "https://x", reason: "r" } }];
    expect(installableUpdates(items)).toHaveLength(1);
  });
});
