import { describe, expect, it } from "vitest";
import { DEFAULT_AUTO_EXTEND_BELOW, clampAutoExtendBelow, extendNote, interleave, mergeUnique, shouldAutoExtend } from "./autoExtend";

describe("auto extend", () => {
  it("default is 15 and the setting is clamped to 0..100", () => {
    expect(DEFAULT_AUTO_EXTEND_BELOW).toBe(15);
    expect(clampAutoExtendBelow(undefined)).toBe(15);
    expect(clampAutoExtendBelow("abc")).toBe(15);
    expect(clampAutoExtendBelow(-4)).toBe(0);
    expect(clampAutoExtendBelow(250)).toBe(100);
    expect(clampAutoExtendBelow("30")).toBe(30);
    expect(clampAutoExtendBelow(7.6)).toBe(8);
    expect(clampAutoExtendBelow(0)).toBe(0);
  });
  it("extends only below the threshold, and never at 0", () => {
    expect(shouldAutoExtend(1, 15)).toBe(true);
    expect(shouldAutoExtend(14, 15)).toBe(true);
    expect(shouldAutoExtend(15, 15)).toBe(false);
    expect(shouldAutoExtend(0, 0)).toBe(false);
  });
  it("merges without duplicates by name and author", () => {
    const merged = mergeUnique([{ name: "Better Chests!", author: "Ann" }], [{ name: "better chests", author: "ann" }, { name: "Better Chests", author: "Bob" }]);
    expect(merged.map((item) => item.author)).toEqual(["Ann", "Bob"]);
  });
  it("interleaves lists", () => {
    expect(interleave<number | string>([[1, 2, 3], ["a"], []])).toEqual([1, "a", 2, 3]);
  });
  it("words the note", () => {
    expect(extendNote("CurseForge", 1, ["Nexus Mods"])).toBe("Showing mods from CurseForge and Nexus Mods because CurseForge has only 1 for this game.");
  });
});
