import { describe, expect, it } from "vitest";
import { formatRuntimeSize, installPercent } from "./runtimeInstaller";

describe("runtime installer helpers", () => {
  it("computes a capped percentage and handles unknown totals", () => {
    expect(installPercent({ downloaded: 50, total: 200 })).toBe(25);
    expect(installPercent({ downloaded: 500, total: 200 })).toBe(100);
    expect(installPercent({ downloaded: 5, total: null })).toBeNull();
    expect(installPercent({ downloaded: 5, total: 0 })).toBeNull();
  });

  it("formats sizes", () => {
    expect(formatRuntimeSize(1_500_000_000)).toBe("1.5 GB");
    expect(formatRuntimeSize(480_000_000)).toBe("480 MB");
    expect(formatRuntimeSize(10)).toBe("1 MB");
  });
});
