import { describe, expect, it } from "vitest";
import { createPacer } from "./throttle";

describe("createPacer", () => {
  it("starts concurrent callers at least gapMs apart", async () => {
    const slept: number[] = [];
    const pace = createPacer(300, () => 1000, async (ms) => { slept.push(ms); });
    await Promise.all([pace(), pace(), pace()]);
    expect(slept).toEqual([300, 600]);
  });
  it("does not wait when calls are already far apart", async () => {
    let clock = 0;
    const slept: number[] = [];
    const pace = createPacer(300, () => clock, async (ms) => { slept.push(ms); clock += ms; });
    await pace(); clock += 1000; await pace();
    expect(slept).toEqual([]);
  });
});
