import type { Piko } from "../models";

/** Per-game cloud state shown on cards: confirmed in the cloud, waiting to upload, failed, or not applicable. */
export type CloudStatus = "synced" | "pending" | "error" | "none";

/** The server rejects libraries larger than this (see sync_my_library). */
export const CLOUD_MAX_PIKOS = 5000;

/** A game is uploaded only when it has an id and a name (the server drops rows without them) and fits under the cap. */
export const isCloudEligible = (piko: Pick<Piko, "id" | "name">) => Boolean(piko.id) && Boolean(piko.name);

/** Pikos that a push will actually send, in order. */
export function eligibleForPush<T extends Pick<Piko, "id" | "name">>(library: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const piko of library) {
    if (!isCloudEligible(piko) || seen.has(piko.id)) continue;
    seen.add(piko.id);
    out.push(piko);
    if (out.length >= CLOUD_MAX_PIKOS) break;
  }
  return out;
}

/** Ids confirmed in the cloud after a successful push: exactly what was sent. */
export const confirmedAfterPush = (library: Pick<Piko, "id" | "name">[]): Set<string> => new Set(eligibleForPush(library).map((piko) => piko.id));

/** Ids confirmed in the cloud after a pull: exactly what the cloud listed. */
export const confirmedAfterPull = (cloud: Pick<Piko, "id">[]): Set<string> => new Set(cloud.map((piko) => piko.id));

/** After clearing the cloud nothing is confirmed. */
export const confirmedAfterClear = (): Set<string> => new Set();

export function cloudStatusFor(piko: Pick<Piko, "id" | "name">, ctx: { enabled: boolean; confirmed: ReadonlySet<string>; syncState: string }): CloudStatus {
  if (!ctx.enabled || !isCloudEligible(piko)) return "none";
  if (ctx.confirmed.has(piko.id)) return "synced";
  return ctx.syncState === "error" ? "error" : "pending";
}

const cacheKey = (userId: string) => `mochi:cloud-synced:${userId}`;

/** Local cache of confirmed ids so checkmarks survive a restart until the next pull re-verifies them. */
export function loadConfirmedCache(userId: string): Set<string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(cacheKey(userId)) ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []);
  } catch { return new Set(); }
}

export function saveConfirmedCache(userId: string, ids: ReadonlySet<string>) {
  try { localStorage.setItem(cacheKey(userId), JSON.stringify([...ids])); } catch { /* storage unavailable: cache is optional */ }
}

export type SyncScheduler = { notify: () => void; cancel: () => void };

/**
 * Debounced runner with a max wait (so a continuous stream of changes still flushes), no overlapping runs,
 * and exponential backoff retry when `run` rejects. A new `notify` supersedes a pending retry.
 */
export function createSyncScheduler(run: () => Promise<void>, opts: { debounceMs?: number; maxWaitMs?: number; retryBaseMs?: number; retryMaxMs?: number } = {}): SyncScheduler {
  const { debounceMs = 1500, maxWaitMs = 10000, retryBaseMs = 2000, retryMaxMs = 60000 } = opts;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let firstDirty = 0;
  let dirty = false;
  let running = false;
  let cancelled = false;
  let failures = 0;

  const arm = (delay: number) => { if (timer !== undefined) clearTimeout(timer); timer = setTimeout(fire, delay); };
  async function fire() {
    timer = undefined;
    if (cancelled) return;
    if (running) { dirty = true; return; }
    running = true; dirty = false; firstDirty = 0;
    try { await run(); failures = 0; }
    catch { failures += 1; if (!cancelled && !dirty) arm(Math.min(retryMaxMs, retryBaseMs * 2 ** (failures - 1))); }
    finally { running = false; }
    if (!cancelled && dirty && timer === undefined) { firstDirty = Date.now(); arm(debounceMs); }
  }
  return {
    notify() {
      if (cancelled) return;
      failures = 0; dirty = true;
      if (running) return;
      const now = Date.now();
      if (!firstDirty) firstDirty = now;
      arm(Math.max(0, Math.min(debounceMs, firstDirty + maxWaitMs - now)));
    },
    cancel() { cancelled = true; if (timer !== undefined) clearTimeout(timer); timer = undefined; },
  };
}
