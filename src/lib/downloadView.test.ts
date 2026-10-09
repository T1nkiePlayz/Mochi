import { describe, expect, it } from "vitest";
import type { DownloadEntry } from "./modrinth";
import { describeDownload, groupDownloads, hasFinished } from "./downloadView";

const entry = (over: Partial<DownloadEntry> = {}): DownloadEntry => ({
  id: "d1", tofuId: "t1", tofuName: "Pack", itemName: "Sodium", filename: "sodium.jar", downloaded: 0, status: "downloading", createdAt: 1, provider: "modrinth", dir: "/mods", ...over,
});

describe("describeDownload", () => {
  it("shows progress, unknown sizes, completion, failure and cancellation", () => {
    expect(describeDownload(entry({ downloaded: 512, total: 1024 }))).toMatchObject({ percent: 50, state: "active", canCancel: true });
    expect(describeDownload(entry({ downloaded: 2048 }))).toMatchObject({ percent: null, state: "active", detail: "2.0 KB downloaded" });
    expect(describeDownload(entry({ status: "completed", downloaded: 10, total: 10 }))).toMatchObject({ percent: 100, state: "done", canCancel: false });
    expect(describeDownload(entry({ status: "failed", error: "SHA-1 mismatch" }))).toMatchObject({ state: "failed", detail: "SHA-1 mismatch" });
    expect(describeDownload(entry({ status: "failed" })).detail).toBe("Failed");
    expect(describeDownload(entry({ status: "cancelled" }))).toMatchObject({ state: "cancelled", canCancel: false });
  });
  it("never reports more than 100 percent", () => {
    expect(describeDownload(entry({ downloaded: 5000, total: 1000 })).percent).toBe(100);
  });
});

describe("groupDownloads", () => {
  it("groups per Tofu with running downloads first", () => {
    const groups = groupDownloads([
      entry({ id: "a", createdAt: 1, status: "completed" }), entry({ id: "b", createdAt: 2 }), entry({ id: "c", tofuId: "t2", tofuName: "Other", createdAt: 5, provider: "curseforge" }),
    ]);
    expect(groups.map((group) => group.tofuId)).toEqual(["t2", "t1"]);
    expect(groups[1].items.map((item) => item.id)).toEqual(["b", "a"]);
  });
  it("knows when something can be cleared", () => {
    expect(hasFinished([entry()])).toBe(false);
    expect(hasFinished([entry(), entry({ status: "cancelled" })])).toBe(true);
  });
});
