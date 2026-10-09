import { describe, expect, it } from "vitest";
import { createLimiter } from "./limit";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createLimiter", () => {
  it("never runs more than max tasks at once and keeps order", async () => {
    const limiter = createLimiter(3);
    let live = 0, peak = 0;
    const started: number[] = [];
    const tasks = Array.from({ length: 10 }, (_, index) => limiter.run(async () => {
      started.push(index); live += 1; peak = Math.max(peak, live);
      await tick(); live -= 1; return index;
    }));
    expect(await Promise.all(tasks)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(peak).toBe(3);
    expect(started).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("keeps going after a task fails or throws synchronously", async () => {
    const limiter = createLimiter(1);
    const failed = limiter.run(async () => { throw new Error("boom"); });
    const thrown = limiter.run(() => { throw new Error("sync"); });
    const ok = limiter.run(async () => "fine");
    await expect(failed).rejects.toThrow("boom");
    await expect(thrown).rejects.toThrow("sync");
    expect(await ok).toBe("fine");
    expect(limiter.active).toBe(0);
  });
});
