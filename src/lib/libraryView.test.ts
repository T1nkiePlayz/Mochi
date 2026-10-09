import { describe, expect, it } from "vitest";
import { cycleViewMode, normalizeViewMode, viewModes } from "./libraryView";

describe("library view modes", () => {
  it("cycles forwards and backwards through every mode and wraps", () => {
    let mode = viewModes[0].id;
    const seen = [mode];
    for (let i = 0; i < viewModes.length; i += 1) { mode = cycleViewMode(mode); seen.push(mode); }
    expect(seen.slice(0, -1)).toEqual(viewModes.map((entry) => entry.id));
    expect(seen.at(-1)).toBe(viewModes[0].id);
    expect(cycleViewMode("grid", -1)).toBe(viewModes.at(-1)!.id);
  });
  it("falls back to the grid for unknown stored values", () => {
    expect(normalizeViewMode("list")).toBe("list");
    expect(normalizeViewMode("carousel")).toBe("grid");
    expect(normalizeViewMode(3)).toBe("grid");
    expect(normalizeViewMode(null)).toBe("grid");
  });
});
