import { describe, expect, it } from "vitest";
import { LEAST_PLAYED_SECONDS, pickGame, pickerCandidates, pickerWeight, seededRandom, type PickerContext, type PickerOptions } from "./picker";

const mk = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: id, ...extra }) as never;
const play = (entries: Record<string, number>) => new Map(Object.entries(entries).map(([id, seconds]) => [id, { gameId: id, name: id, seconds, lastPlayed: 1 }]));
const ctx = (entries: Record<string, number> = {}, installed = true): PickerContext => ({ playtime: play(entries), isInstalled: () => installed });
const opts: PickerOptions = { mood: "relaxed", time: "hour", length: "any" };

describe("pickerCandidates", () => {
  it("drops launchers, extras, finished/dropped, uninstalled and well-played games", () => {
    const lib = [mk("a"), mk("launcher", { kind: "launcher" }), mk("ost", { contentType: "soundtrack" }), mk("done", { backlog: { status: "finished", addedAt: 1 } }),
      mk("drop", { backlog: { status: "dropped", addedAt: 1 } }), mk("old"), mk("want-old", { backlog: { status: "want", addedAt: 1 } })];
    const ids = pickerCandidates(lib, ctx({ old: LEAST_PLAYED_SECONDS + 1, "want-old": 99999 })).map((p) => p.id);
    expect(ids).toEqual(["a", "want-old"]);
    expect(pickerCandidates(lib, ctx({}, false))).toEqual([]);
  });
});

describe("pickerWeight", () => {
  it("prefers wanted over unplayed over barely played", () => {
    const w = (p: never, e = {}) => pickerWeight(p, opts, ctx(e));
    expect(w(mk("a", { backlog: { status: "want", addedAt: 1 } }))).toBeGreaterThan(w(mk("b")));
    expect(w(mk("b"))).toBeGreaterThan(w(mk("c"), { c: 60 }));
  });
  it("boosts genre matches for the mood", () => {
    const puzzle = mk("p", { categories: ["Puzzle"] });
    expect(pickerWeight(puzzle, opts, ctx())).toBeGreaterThan(pickerWeight(mk("x"), opts, ctx()));
    const shooter = mk("s", { categories: ["Shooter"] });
    expect(pickerWeight(shooter, { ...opts, mood: "competitive" }, ctx())).toBeGreaterThan(pickerWeight(shooter, opts, ctx()));
  });
  it("short length and quick time penalise long genres", () => {
    const rpg = mk("r", { categories: ["Role-playing (RPG)"] });
    const base = pickerWeight(rpg, opts, ctx());
    expect(pickerWeight(rpg, { ...opts, length: "short" }, ctx())).toBeLessThan(base);
    expect(pickerWeight(rpg, { ...opts, time: "evening" }, ctx())).toBeGreaterThan(base);
    expect(pickerWeight(rpg, { ...opts, time: "quick", length: "short" }, ctx())).toBeGreaterThan(0);
  });
});

describe("pickGame", () => {
  const lib = [mk("a", { backlog: { status: "want", addedAt: 1 } }), mk("b"), mk("c", { categories: ["Puzzle"] })];
  it("is deterministic for a seed and returns null when empty", () => {
    expect(pickGame(lib, opts, ctx(), seededRandom(7))?.id).toBe(pickGame(lib, opts, ctx(), seededRandom(7))?.id);
    expect(pickGame([], opts, ctx())).toBeNull();
  });
  it("follows the weights over many draws", () => {
    const rng = seededRandom(1); const counts: Record<string, number> = { a: 0, b: 0, c: 0 };
    for (let i = 0; i < 3000; i++) counts[pickGame(lib, opts, ctx(), rng)!.id]!++;
    // weights: a 4, b 2.5, c 7.5 (unplayed + relaxed puzzle)
    expect(counts.c).toBeGreaterThan(counts.a!);
    expect(counts.a).toBeGreaterThan(counts.b!);
  });
  it("skips already shown games until all were shown", () => {
    const rng = seededRandom(3); const shown = new Set<string>();
    for (let i = 0; i < 3; i++) shown.add(pickGame(lib, opts, ctx(), rng, shown)!.id);
    expect(shown.size).toBe(3);
    expect(pickGame(lib, opts, ctx(), rng, shown)).not.toBeNull();
  });
});
