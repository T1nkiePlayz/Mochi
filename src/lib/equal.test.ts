import { describe, expect, it } from "vitest";
import { deepEqual, keepIfEqual } from "./equal";

describe("deepEqual", () => {
  it("compares primitives, arrays and objects structurally", () => {
    expect(deepEqual(1, 1)).toBe(true);
    expect(deepEqual(1, 2)).toBe(false);
    expect(deepEqual([{ a: 1, b: [1, 2] }], [{ b: [1, 2], a: 1 }])).toBe(true);
    expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(deepEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(deepEqual({ a: undefined }, { b: undefined })).toBe(false);
    expect(deepEqual([], {})).toBe(false);
    expect(deepEqual(null, {})).toBe(false);
  });
});

describe("keepIfEqual", () => {
  it("returns the previous reference when equal and the next one otherwise", () => {
    const previous = [{ id: "a" }];
    expect(keepIfEqual([{ id: "a" }])(previous)).toBe(previous);
    const next = [{ id: "b" }];
    expect(keepIfEqual(next)(previous)).toBe(next);
  });
});
