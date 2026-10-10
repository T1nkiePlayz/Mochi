import { describe, expect, it } from "vitest";
import { defaultDownloadPrefs, downloadsHeld, inDownloadWindow, sanitizeDownloadPrefs } from "./downloadPacing";

const at = (hour: number, minute = 0) => new Date(2026, 0, 1, hour, minute);

describe("download pacing", () => {
  it("handles windows, including over midnight", () => {
    const day = { enabled: true, start: "09:00", end: "17:00" };
    expect(inDownloadWindow(day, at(10))).toBe(true);
    expect(inDownloadWindow(day, at(18))).toBe(false);
    const night = { enabled: true, start: "23:00", end: "06:00" };
    expect(inDownloadWindow(night, at(23, 30))).toBe(true);
    expect(inDownloadWindow(night, at(3))).toBe(true);
    expect(inDownloadWindow(night, at(12))).toBe(false);
    expect(inDownloadWindow({ ...night, enabled: false }, at(12))).toBe(true);
  });
  it("holds when paused or outside the window and cleans stored values", () => {
    expect(downloadsHeld({ ...defaultDownloadPrefs, paused: true }, at(12))).toBe(true);
    expect(sanitizeDownloadPrefs({ limitKiB: -5, window: { enabled: true, start: "bad" } })).toEqual({ paused: false, limitKiB: 0, window: { enabled: true, start: "01:00", end: "07:00" } });
  });
});
