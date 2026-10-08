// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readJson, writeJson } from "./storage";

beforeEach(() => window.localStorage.clear());

describe("storage", () => {
  it("treats a stored literal null as missing (callers expect an object or array)", () => {
    window.localStorage.setItem("k", "null");
    expect(readJson("k", { a: 1 })).toEqual({ a: 1 });
  });
  it("returns the fallback for corrupt JSON", () => {
    window.localStorage.setItem("k", "{oops");
    expect(readJson<number[]>("k", [])).toEqual([]);
  });
  it("reports quota failures instead of throwing", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("full", "QuotaExceededError"); });
    expect(writeJson("k", { a: 1 })).toBe(false);
    spy.mockRestore();
    expect(writeJson("k", { a: 1 })).toBe(true);
  });
});
