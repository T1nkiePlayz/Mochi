/** A small promise queue: at most `max` tasks run at once, the rest wait in order. */
export function createLimiter(max: number) {
  let running = 0;
  const waiting: Array<() => void> = [];
  const next = () => {
    while (running < max && waiting.length > 0) waiting.shift()!();
  };
  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const start = () => {
          running += 1;
          let promise: Promise<T>;
          try { promise = task(); } catch (error) { promise = Promise.reject(error); }
          promise.then(resolve, reject).finally(() => { running -= 1; next(); });
        };
        waiting.push(start);
        next();
      });
    },
    get active() { return running; },
    get queued() { return waiting.length; },
  };
}

/** Shared by every Discover > All section, so a long page never has more than three requests in flight. */
export const sectionLimiter = createLimiter(3);
