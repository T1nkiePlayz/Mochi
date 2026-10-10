import { describe, expect, it } from "vitest";
import { defaultPlayLimits, inBedtime, limitStatus, normalizePlayLimits, parseClock, formatClock } from "./playLimits";

const on = { ...defaultPlayLimits, enabled: true };

describe("play limits", () => {
  it("is off by default and ignores everything when disabled", () => {
    expect(defaultPlayLimits.enabled).toBe(false);
    expect(limitStatus({ ...defaultPlayLimits, dailyMinutes: 1 }, "g", 999, 999, 0)).toEqual({ kind: "ok" });
  });
  it("warns, then reports reached, for daily and per-game limits", () => {
    const limits = { ...on, dailyMinutes: 100, perGame: { g: 30 } };
    expect(limitStatus(limits, "h", 79, 0, 600).kind).toBe("ok");
    expect(limitStatus(limits, "h", 80, 0, 600)).toMatchObject({ kind: "warn", scope: "daily" });
    expect(limitStatus(limits, "h", 100, 0, 600)).toMatchObject({ kind: "reached", scope: "daily" });
    expect(limitStatus(limits, "g", 10, 30, 600)).toMatchObject({ kind: "reached", scope: "game", limitMinutes: 30 });
  });
  it("handles bedtime windows that wrap past midnight", () => {
    const limits = { ...on, bedtimeEnabled: true, bedtimeStart: 22 * 60, bedtimeEnd: 7 * 60 };
    expect([inBedtime(limits, 23 * 60), inBedtime(limits, 3 * 60), inBedtime(limits, 12 * 60)]).toEqual([true, true, false]);
  });
  it("normalises junk and keeps hostile keys harmless", () => {
    const parsed = normalizePlayLimits(JSON.parse('{"enabled":true,"dailyMinutes":-5,"warnAtPercent":500,"enforce":"x","perGame":{"__proto__":30,"a":"no","b":45}}'));
    expect([parsed.dailyMinutes, parsed.warnAtPercent, parsed.enforce, Object.keys(parsed.perGame)]).toEqual([0, 100, "remind", ["__proto__", "b"]]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(limitStatus({ ...on, dailyMinutes: 10 }, "__proto__", 0, 0, 600).kind).toBe("ok");
  });
  it("parses and formats clock times", () => {
    expect([parseClock("7:05"), parseClock("24:00"), parseClock("x")]).toEqual([425, null, null]);
    expect(formatClock(425)).toBe("07:05");
  });
});

import { breaksDue, minutesToday } from "./playLimits";
describe("minutesToday and breaks", () => {
  it("counts finished sessions after midnight and running ones, clipping at midnight", () => {
    const midnight = 1000;
    const { total, byGame } = minutesToday(
      [{ gameId: "a", start: 940, seconds: 120, kind: "session" }, { gameId: "a", start: 0, seconds: 60, kind: "session" }, { gameId: "b", start: 1100, seconds: 600, kind: "daily" }],
      [{ gameId: "b", startedAt: 1200 }], 1300, midnight);
    expect(byGame.get("a")).toBeCloseTo(1); // only the 60s after midnight of the straddling session
    expect(byGame.get("b")).toBeCloseTo(100 / 60);
    expect(total).toBeCloseTo(1 + 100 / 60);
  });
  it("counts whole break intervals", () => {
    expect([breaksDue({ ...defaultPlayLimits, enabled: true, breakEveryMinutes: 60 }, 125), breaksDue({ ...defaultPlayLimits, breakEveryMinutes: 60 }, 125), breaksDue({ ...defaultPlayLimits, enabled: true, breakEveryMinutes: 0 }, 125)]).toEqual([2, 0, 0]);
  });
});
