// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPendingWrites, readJson, writeJson, writeJsonDebounced } from "./storage";

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

describe("debounced writes", () => {
  it("coalesces bursts into one write of the latest value", async () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(Storage.prototype, "setItem");
    writeJsonDebounced("d", 1); writeJsonDebounced("d", 2); writeJsonDebounced("d", 3);
    expect(spy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem("d")).toBe("3");
    spy.mockRestore(); vi.useRealTimers();
  });
  it("lets reads see pending values and direct writes win over older pending ones", () => {
    writeJsonDebounced("r", { v: 1 });
    expect(readJson("r", null)).toEqual({ v: 1 });
    writeJsonDebounced("w", "old");
    writeJson("w", "new");
    flushPendingWrites();
    expect(readJson("w", "")).toBe("new");
  });
  it("flushes when the page is hidden", () => {
    writeJsonDebounced("p", 7);
    window.dispatchEvent(new Event("pagehide"));
    expect(window.localStorage.getItem("p")).toBe("7");
  });
});
