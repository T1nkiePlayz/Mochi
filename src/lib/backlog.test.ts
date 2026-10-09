import { describe, expect, it } from "vitest";
import { isInBacklog, sanitizeBacklog, withBacklogNote, withBacklogStatus } from "./backlog";
import { matchesFilter, sanitizeFilter, smartFilters } from "./library";

const ctx = { playtime: new Map(), installed: new Map(), isRunning: () => false };
const game = (status?: "want" | "playing" | "finished" | "dropped") => ({ id: "g", name: "G", ...(status ? { backlog: { status, addedAt: 1 } } : {}) }) as never;

describe("backlog", () => {
  it("smart filter keeps wanted and in-progress games only", () => {
    const f = { kind: "smart", id: "backlog" } as const;
    expect([undefined, "want", "playing", "finished", "dropped"].map((s) => matchesFilter(game(s as never), f, ctx))).toEqual([false, true, true, false, false]);
    expect(isInBacklog(game("want"))).toBe(true);
  });
  it("is a known, stored-filter-safe smart filter", () => {
    expect(smartFilters.some((f) => f.id === "backlog")).toBe(true);
    expect(sanitizeFilter({ kind: "smart", id: "backlog" })).toEqual({ kind: "smart", id: "backlog" });
  });
  it("status changes keep the note and original add time; null clears", () => {
    const first = withBacklogStatus(undefined, "want", 5)!;
    const noted = withBacklogNote(first, "  friend rec  ");
    expect(withBacklogStatus(noted, "playing", 99)).toEqual({ status: "playing", note: "friend rec", addedAt: 5 });
    expect(withBacklogStatus(noted, null)).toBeUndefined();
    expect(withBacklogNote(noted, "   ")).toEqual({ status: "want", addedAt: 5 });
  });
  it("sanitizeBacklog drops unknown statuses", () => {
    expect(sanitizeBacklog({ status: "x", addedAt: 1 })).toBeUndefined();
    expect(sanitizeBacklog({ status: "want", note: "n", addedAt: "bad" })).toEqual({ status: "want", note: "n", addedAt: 0 });
    expect(sanitizeBacklog(null)).toBeUndefined();
  });
});
