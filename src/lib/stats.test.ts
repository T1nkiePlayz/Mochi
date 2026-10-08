import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { analyse, computeStreaks, dayKey, dayTotals, groupByWeek, hourHistogram, splitAtMidnight, type SessionRecord } from "./stats";

const proc = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process;
const original = proc.env.TZ;
beforeAll(() => { proc.env.TZ = "America/New_York"; });
afterAll(() => { if (original === undefined) delete proc.env.TZ; else proc.env.TZ = original; });

const at = (y: number, m: number, d: number, h = 0, min = 0) => Math.floor(new Date(y, m - 1, d, h, min).getTime() / 1000);
const session = (start: number, seconds: number, gameId = "g"): SessionRecord => ({ gameId, name: gameId, start, seconds, kind: "session", count: 1 });

describe("stats", () => {
  it("splits a session at local midnight", () => {
    const pieces = splitAtMidnight(session(at(2026, 3, 9, 23, 0), 7200));
    expect(pieces.map((p) => [p.day, p.seconds])).toEqual([["2026-03-09", 3600], ["2026-03-10", 3600]]);
  });
  it("handles the DST gap day (23 hours long)", () => {
    const pieces = splitAtMidnight(session(at(2026, 3, 8, 0, 0), 24 * 3600));
    expect(pieces.reduce((s, p) => s + p.seconds, 0)).toBe(24 * 3600);
    expect(pieces.map((p) => p.day)).toEqual(["2026-03-08", "2026-03-09"]);
  });
  it("tolerates negative and NaN durations", () => {
    expect(splitAtMidnight(session(at(2026, 1, 1), -5))).toHaveLength(1);
    expect(splitAtMidnight(session(at(2026, 1, 1), NaN))).toHaveLength(1);
  });
  it("hour histogram sums to the session length", () => {
    const hours = hourHistogram([session(at(2026, 5, 1, 10, 30), 5400)]);
    expect(hours.reduce((a, b) => a + b, 0)).toBe(5400);
    expect(hours[10]).toBe(1800);
  });
  it("streaks stay alive through today", () => {
    const now = at(2026, 6, 10, 12);
    const totals = new Map([["2026-06-09", 600], ["2026-06-08", 600], ["2026-06-01", 600]]);
    expect(computeStreaks(totals, now * 1000)).toMatchObject({ current: 2, longest: 2 });
    expect(computeStreaks(new Map(), now * 1000)).toMatchObject({ current: 0, longest: 0 });
  });
  it("analyse and groupByWeek do not divide by zero on empty data", () => {
    const a = analyse([], 30, at(2026, 6, 10) * 1000);
    expect(a).toMatchObject({ totalSeconds: 0, averageSeconds: 0, hasData: false });
    expect(a.buckets).toHaveLength(30);
    expect(groupByWeek(a.buckets).every((w) => w.seconds === 0)).toBe(true);
  });
  it("analyse totals only the range", () => {
    const now = at(2026, 6, 10, 12) * 1000;
    const a = analyse([session(at(2026, 6, 10, 9), 3600), session(at(2026, 1, 1, 9), 3600)], 7, now);
    expect(a.totalSeconds).toBe(3600);
    expect(dayTotals([session(at(2026, 6, 10, 9), 60)]).get(dayKey(new Date(2026, 5, 10)))).toBe(60);
  });
});
