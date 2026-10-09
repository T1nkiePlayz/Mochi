import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNotifyBatcher } from "./notifyBatch";

describe("notifyBatch", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  const setup = () => { const emit = vi.fn(); return { emit, batcher: createNotifyBatcher(emit) }; };
  const entry = (n: number) => ({ title: "Achievement unlocked", message: `Desc ${n}`, item: `Ach ${n}` });

  it("emits a single notification unchanged after the debounce", () => {
    const { emit, batcher } = setup();
    batcher.add("achievements", entry(1));
    vi.advanceTimersByTime(1499);
    expect(emit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(emit).toHaveBeenCalledWith("achievements", { title: "Achievement unlocked", message: "Desc 1" });
  });

  it("coalesces a burst of 14 into one summary", () => {
    const { emit, batcher } = setup();
    for (let i = 1; i <= 14; i++) { batcher.add("achievements", entry(i)); vi.advanceTimersByTime(100); }
    vi.advanceTimersByTime(1500);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith("achievements", { title: "14 achievements earned", message: "Ach 1, Ach 2, Ach 3 and 11 more" });
  });

  it("lists names without a tail when 3 or fewer", () => {
    const { emit, batcher } = setup();
    batcher.add("achievements", entry(1)); batcher.add("achievements", entry(2));
    vi.advanceTimersByTime(1500);
    expect(emit).toHaveBeenCalledWith("achievements", { title: "2 achievements earned", message: "Ach 1, Ach 2" });
  });

  it("keeps bursts separated by more than the debounce apart", () => {
    const { emit, batcher } = setup();
    batcher.add("achievements", entry(1)); batcher.add("achievements", entry(2));
    vi.advanceTimersByTime(1600);
    batcher.add("achievements", entry(3));
    vi.advanceTimersByTime(1500);
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit.mock.calls[1][1]).toEqual({ title: "Achievement unlocked", message: "Desc 3" });
  });

  it("caps the wait so a steady trickle still flushes", () => {
    const { emit, batcher } = setup();
    for (let i = 0; i < 12; i++) { batcher.add("achievements", entry(i)); vi.advanceTimersByTime(1000); }
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit.mock.calls[0][1].title).toBe("5 achievements earned");
  });

  it("keeps groups independent", () => {
    const { emit, batcher } = setup();
    batcher.add("achievements", entry(1));
    vi.advanceTimersByTime(1000);
    batcher.add("downloads", { title: "Download finished", message: "A", item: "A" });
    vi.advanceTimersByTime(500);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][0]).toBe("achievements");
    vi.advanceTimersByTime(1000);
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit.mock.calls[1][0]).toBe("downloads");
  });

  it("flushAll emits pending groups immediately", () => {
    const { emit, batcher } = setup();
    batcher.add("achievements", entry(1));
    batcher.flushAll();
    expect(emit).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5000);
    expect(emit).toHaveBeenCalledTimes(1);
  });
});
