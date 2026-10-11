import { describe, expect, it } from "vitest";
import { formatBytes, formatPlaytime, formatRelativeTime } from "./format";
import { launcherLanguages } from "./languages";

describe("format", () => {
  it("handles bad byte counts", () => { expect(formatBytes(NaN, "en")).toBe("0 KiB"); expect(formatBytes(-5, "en")).toBe("0 KiB"); expect(formatBytes(2 * 1024 * 1024, "en")).toBe("2.0 MiB"); });
  it("formats byte quantities using the selected locale", () => {
    expect(formatBytes(1.5 * 1024 * 1024, "fr")).toContain("1,5");
    expect(formatBytes(1.5 * 1024 * 1024, "de")).toContain("1,5");
    expect(formatBytes(1.5 * 1024 * 1024, "en")).toBe("1.5 MiB");
  });
  it("pluralises relative times", () => {
    const ago = (s: number) => formatRelativeTime(Date.now() / 1000 - s);
    expect(ago(3700)).toBe("1 hour ago");
    expect(ago(7300)).toBe("2 hours ago");
    expect(ago(3599 - 60 + 1 + 3000)).toMatch(/hour|minute/);
    expect(ago(100)).toBe("1 minute ago");
    expect(ago(10)).toBe("just now");
  });
  it("playtime", () => { expect(formatPlaytime(3700, "en")).toBe("1h 1m"); });
  it("formats relative time using the selected locale", () => {
    expect(formatRelativeTime(Date.now() / 1000 - 120, "fr")).toContain("il y a");
    expect(formatRelativeTime(Date.now() / 1000 - 120, "de")).toContain("vor");
  });
  it("localizes playtime units", () => {
    expect(formatPlaytime(3700, "fr")).not.toBe("1h 1m");
    expect(formatPlaytime(3700, "ja")).not.toBe("1h 1m");
  });
  it("uses locale-specific unit and plural rules across every supported language", () => {
    for (const { code, locale } of launcherLanguages) {
      const hours = Math.floor(3700 / 3600);
      const minutes = Math.floor((3700 % 3600) / 60);
      const expectedPlaytime = code === "en"
        ? "1h 1m"
        : `${new Intl.NumberFormat(locale, { style: "unit", unit: "hour", unitDisplay: "short", maximumFractionDigits: 0 }).format(hours)} ${new Intl.NumberFormat(locale, { style: "unit", unit: "minute", unitDisplay: "short", maximumFractionDigits: 0 }).format(minutes)}`;
      expect(formatPlaytime(3700, code), `playtime locale: ${code}`).toBe(expectedPlaytime);

      const relativeLocale = code === "en"
        ? "2 hours ago"
        : new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-2, "hour");
      expect(formatRelativeTime(Date.now() / 1000 - 7200, code), `relative-time locale: ${code}`).toBe(relativeLocale);

      const epoch = 1_700_000_000;
      expect(formatRelativeTime(epoch, code), `long-date locale: ${code}`).toBe(new Date(epoch * 1000).toLocaleDateString(locale));
    }
  });

  it("formats numeric quantities with locale-specific decimal conventions across every supported language", () => {
    for (const { code, locale } of launcherLanguages) {
      const expected = code === "en"
        ? "1.5 MiB"
        : new Intl.NumberFormat(locale, { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(1.5) + " MiB";
      expect(formatBytes(1.5 * 1024 * 1024, code), `byte-size locale: ${code}`).toBe(expected);
    }
  });
});
