import { describe, expect, it } from "vitest";
import { describeModSync } from "./nativeEvents";

const report = (over: Partial<NonNullable<Parameters<typeof describeModSync>[0]["report"]>> = {}) => ({ added: 0, removed: 0, unchanged: 0, conflicts: [], errors: [], ...over });

describe("describeModSync", () => {
  it("stays quiet when nothing changed", () => {
    expect(describeModSync({ tofuId: "t", report: report({ unchanged: 5 }) }, "Pack")).toBeNull();
  });
  it("summarises changes, conflicts and errors", () => {
    expect(describeModSync({ tofuId: "t", report: report({ added: 2, removed: 1 }) }, "Pack")?.message).toBe("Pack: 2 added, 1 removed.");
    expect(describeModSync({ tofuId: "t", report: report({ conflicts: ["x.jar already exists"] }) }, "Pack")?.title).toBe("Mods left untouched");
    expect(describeModSync({ tofuId: "t", report: report({ errors: ["boom"] }) }, "Pack")?.message).toBe("boom");
    expect(describeModSync({ tofuId: "t", error: "no folder" }, "Pack")?.title).toBe("Mods were not synced");
  });
});
