import { describe, expect, it } from "vitest";
import { formatBytes, formatPlaytime, formatRelativeTime } from "./format";

describe("format", () => {
  it("handles bad byte counts", () => { expect(formatBytes(NaN)).toBe("0 KiB"); expect(formatBytes(-5)).toBe("0 KiB"); expect(formatBytes(2 * 1024 * 1024)).toBe("2.0 MiB"); });
  it("pluralises relative times", () => {
    const ago = (s: number) => formatRelativeTime(Date.now() / 1000 - s);
    expect(ago(3700)).toBe("1 hour ago");
    expect(ago(7300)).toBe("2 hours ago");
    expect(ago(3599 - 60 + 1 + 3000)).toMatch(/hour|minute/);
    expect(ago(100)).toBe("1 minute ago");
    expect(ago(10)).toBe("just now");
  });
  it("playtime", () => { expect(formatPlaytime(3700)).toBe("1h 1m"); });
});
