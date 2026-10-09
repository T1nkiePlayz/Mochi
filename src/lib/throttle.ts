/** Spaces out calls to one rate-limited service: each caller waits until `gapMs` has passed since the previous one started. */
export function createPacer(gapMs: number, now: () => number = Date.now, sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))) {
  let next = 0;
  return async () => {
    const at = Math.max(now(), next);
    next = at + gapMs;
    const wait = at - now();
    if (wait > 0) await sleep(wait);
  };
}
