import { describe, expect, it } from "vitest";
import { applyProgress, buildRows, formatShare, scanRequestFor, sortRows, summarise, visibleRows, type Measurement, type StorageLocation } from "./diskUsage";
import type { Piko } from "../models";

const loc = (key: string, name: string, category: StorageLocation["category"], inside: StorageLocation["inside"] = null): StorageLocation => ({ key, name, category, path: null, clear: null, inside });
const done = (bytes: number): Measurement => ({ bytes, files: 1, truncated: false, done: true, error: null });
const locations = [loc("game:a", "Alpha", "games"), loc("game:b", "Beta", "games"), loc("tofu:t", "Pack", "mods"), loc("mochi:rollback", "Rollback", "rollback", "mods"), loc("mochi:artwork", "Artwork", "artwork")];

describe("storage breakdown", () => {
  it("applies progress events by key", () => {
    let state = applyProgress({}, { job: 1, key: "game:a", bytes: 5, files: 1, truncated: false, done: false, error: null });
    state = applyProgress(state, { job: 1, key: "game:a", bytes: 9, files: 2, truncated: true, done: true, error: null });
    expect(state["game:a"]).toEqual({ bytes: 9, files: 2, truncated: true, done: true, error: null });
  });

  it("sums categories and takes nested rows out of their parent", () => {
    const rows = buildRows(locations, { "game:a": done(1000), "game:b": done(500), "tofu:t": done(400), "mochi:rollback": done(150), "mochi:artwork": done(50) });
    const totals = summarise(rows);
    expect(totals.categories).toEqual([{ category: "games", bytes: 1500 }, { category: "mods", bytes: 250 }, { category: "rollback", bytes: 150 }, { category: "artwork", bytes: 50 }]);
    expect(totals.total).toBe(1950);
    expect(totals).toMatchObject({ measured: 5, pending: 0, failed: 0 });
  });

  it("counts pending and failed rows apart and ignores failed sizes", () => {
    const rows = buildRows(locations, { "game:a": done(10), "game:b": { bytes: 0, files: 0, truncated: false, done: true, error: "Folder missing" }, "tofu:t": { ...done(4), done: false } });
    const totals = summarise(rows);
    expect(totals).toMatchObject({ total: 14, measured: 1, failed: 1, pending: 3 });
  });

  it("never lets a nested row push its parent below zero", () => {
    const totals = summarise(buildRows(locations, { "mochi:rollback": done(100) }));
    expect(totals.categories).toEqual([{ category: "rollback", bytes: 100 }]);
  });

  it("sorts by size with unmeasured rows last in both directions", () => {
    const rows = buildRows(locations, { "game:a": done(10), "game:b": done(30), "tofu:t": done(20) });
    expect(sortRows(rows, { key: "bytes", dir: "desc" }).map((row) => row.name)).toEqual(["Beta", "Pack", "Alpha", "Artwork", "Rollback"]);
    expect(sortRows(rows, { key: "bytes", dir: "asc" }).map((row) => row.name)).toEqual(["Alpha", "Pack", "Beta", "Artwork", "Rollback"]);
  });

  it("sorts by name and by kind", () => {
    const rows = buildRows(locations, {});
    expect(sortRows(rows, { key: "name", dir: "asc" }).map((row) => row.name)).toEqual(["Alpha", "Artwork", "Beta", "Pack", "Rollback"]);
    expect(sortRows(rows, { key: "name", dir: "desc" })[0].name).toBe("Rollback");
    expect(sortRows(rows, { key: "category", dir: "asc" }).map((row) => row.category)).toEqual(["artwork", "games", "games", "mods", "rollback"]);
  });

  it("formats shares", () => {
    expect(formatShare(null, 100)).toBe("");
    expect(formatShare(5, 0)).toBe("");
    expect(formatShare(1, 10_000)).toBe("<0.1%");
    expect(formatShare(25, 1000)).toBe("2.5%");
    expect(formatShare(500, 1000)).toBe("50%");
  });

  it("caps long lists and says how many are hidden", () => {
    const many = Array.from({ length: 5000 }, (_, index) => index);
    expect(visibleRows(many, 200)).toMatchObject({ hidden: 4800 });
    expect(visibleRows(many, 200).shown).toHaveLength(200);
    expect(visibleRows([1, 2], 200)).toEqual({ shown: [1, 2], hidden: 0 });
  });

  it("builds the scan request from library folders only", () => {
    const library = [
      { id: "g1", name: "Game", installPath: " /games/one ", tofus: [{ id: "t1", name: "Vanilla", path: "/mods/one", contentRoot: "/mods/one" }, { id: "t2", name: "None" }] },
      { id: "g2", name: "No install", tofus: [{ id: "t3", name: "Pack", path: "/mods/two", contentRoot: "/mc" }] },
    ] as unknown as Piko[];
    expect(scanRequestFor(library)).toEqual({
      games: [{ id: "g1", name: "Game", path: "/games/one" }],
      tofus: [{ id: "g1:t1", name: "Vanilla (Game)", folders: ["/mods/one"] }, { id: "g2:t3", name: "Pack (No install)", folders: ["/mods/two", "/mc"] }],
    });
  });
});
