import { describe, expect, it } from "vitest";
import { matchesSmartFilter, sanitizeFilter, sanitizeLibrary, withTag, toggleInList, mostPlayedIds } from "./library";

describe("sanitizeLibrary", () => {
  it("drops junk, dedupes ids and guarantees a tofu", () => {
    const out = sanitizeLibrary([null, 5, "x", { id: "" }, { id: "a", name: "A" }, { id: "a", name: "dup" }, { id: "b", tofus: [{ id: "t", mods: NaN }, 3] }]);
    expect(out.map((p) => p.id)).toEqual(["a", "b"]);
    expect(out[0]!.tofus).toHaveLength(1);
    expect(out[1]!.tofus).toEqual([expect.objectContaining({ id: "t", mods: 0 })]);
    expect(out[1]!.name).toBe("Untitled");
  });
  it("accepts non-arrays", () => { expect(sanitizeLibrary({})).toEqual([]); expect(sanitizeLibrary(null)).toEqual([]); });
});

describe("sanitizeFilter", () => {
  it("falls back for unknown smart ids so the library is never filtered to nothing", () => {
    expect(sanitizeFilter({ kind: "smart", id: "gone" })).toEqual({ kind: "smart", id: "all" });
    expect(sanitizeFilter({ kind: "smart", id: "favorites" })).toEqual({ kind: "smart", id: "favorites" });
    expect(sanitizeFilter({ kind: "source", id: "steam" })).toEqual({ kind: "source", id: "steam" });
    expect(sanitizeFilter("x")).toEqual({ kind: "smart", id: "all" });
  });
  it("matchesSmartFilter never returns undefined", () => {
    const ctx = { playtime: new Map(), installed: new Map(), isRunning: () => false };
    expect(matchesSmartFilter({ id: "a" } as never, "bogus" as never, ctx)).toBe(true);
  });
});

describe("list helpers", () => {
  it("withTag is case-insensitive", () => { expect(withTag(["RPG"], "rpg")).toEqual(["RPG"]); expect(withTag(undefined, "  a   b ")).toEqual(["a b"]); });
  it("toggleInList", () => { expect(toggleInList(["a"], "a", true)).toEqual(["a"]); expect(toggleInList(["a"], "a", false)).toEqual([]); });
  it("mostPlayedIds ignores unplayed", () => {
    const m = new Map([["a", { gameId: "a", name: "", seconds: 5, lastPlayed: 1 }]]);
    expect([...mostPlayedIds([{ id: "a" }, { id: "b" }] as never, m)]).toEqual(["a"]);
  });
});
