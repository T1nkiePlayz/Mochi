export type BatchEntry = { title: string; message: string; item?: string };
export type BatchedNotice = { title: string; message: string };
export type GroupFormatter = (entries: BatchEntry[]) => BatchedNotice;

export const DEBOUNCE_MS = 1500;
export const MAX_WAIT_MS = 5000;
const MAX_NAMES = 3;

/** "A, B, C and 11 more" for the item names of a burst. */
export function listItems(names: string[], max = MAX_NAMES): string {
  const shown = names.slice(0, max);
  const rest = names.length - shown.length;
  return rest > 0 ? `${shown.join(", ")} and ${rest} more` : shown.join(", ");
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** Per-group summaries for bursts of two or more; a lone notification is never reformatted. */
export const GROUP_FORMATTERS: Record<string, GroupFormatter> = {
  achievements: (entries) => ({ title: `${plural(entries.length, "achievement", "achievements")} earned`, message: listItems(entries.map((entry) => entry.item ?? entry.title)) }),
  news: (entries) => ({ title: `${plural(entries.length, "news update", "news updates")}`, message: listItems([...new Set(entries.map((entry) => entry.item ?? entry.title))]) }),
  deals: (entries) => ({ title: `${plural(entries.length, "new deal", "new deals")}`, message: listItems(entries.map((entry) => entry.item ?? entry.title)) }),
  downloads: (entries) => ({ title: `${plural(entries.length, "download", "downloads")} finished`, message: listItems(entries.map((entry) => entry.item ?? entry.title)) }),
};

export function defaultFormatter(entries: BatchEntry[]): BatchedNotice {
  return { title: `${entries.length} notifications`, message: listItems(entries.map((entry) => entry.item ?? entry.title)) };
}

/** Collapses a burst into the single notification to show. */
export function summarise(group: string, entries: BatchEntry[]): BatchedNotice {
  if (entries.length === 1) return { title: entries[0].title, message: entries[0].message };
  return (GROUP_FORMATTERS[group] ?? defaultFormatter)(entries);
}

export type NotifyBatcher = { add: (group: string, entry: BatchEntry) => void; flushAll: () => void; dispose: () => void };

type Timers = { setTimer?: (fn: () => void, ms: number) => unknown; clearTimer?: (handle: unknown) => void; now?: () => number; debounceMs?: number; maxWaitMs?: number };

/**
 * Coalesces notifications of the same group: emits once `debounceMs` after the last one, but never later than
 * `maxWaitMs` after the first. Groups are independent. Timers are injectable for tests.
 */
export function createNotifyBatcher(emit: (group: string, notice: BatchedNotice) => void, options: Timers = {}): NotifyBatcher {
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const now = options.now ?? Date.now;
  const debounceMs = options.debounceMs ?? DEBOUNCE_MS;
  const maxWaitMs = options.maxWaitMs ?? MAX_WAIT_MS;
  const pending = new Map<string, { entries: BatchEntry[]; first: number; timer: unknown }>();

  const flush = (group: string) => {
    const batch = pending.get(group);
    if (!batch) return;
    clearTimer(batch.timer);
    pending.delete(group);
    emit(group, summarise(group, batch.entries));
  };

  return {
    add(group, entry) {
      const current = now();
      const batch = pending.get(group);
      if (batch) clearTimer(batch.timer);
      const first = batch?.first ?? current;
      const entries = batch ? [...batch.entries, entry] : [entry];
      const wait = Math.max(0, Math.min(debounceMs, first + maxWaitMs - current));
      pending.set(group, { entries, first, timer: setTimer(() => flush(group), wait) });
    },
    flushAll() { [...pending.keys()].forEach(flush); },
    dispose() { pending.forEach((batch) => clearTimer(batch.timer)); pending.clear(); },
  };
}
