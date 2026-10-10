import { useSyncExternalStore } from "react";
import { readHoursCache, writeHoursCache } from "../lib/hoursCache";

let hours: ReadonlyMap<string, number> = readHoursCache();
const listeners = new Set<() => void>();

/** Adds newly learned hours; the cache is saved and every subscriber re-renders. */
export function mergeHours(extra: ReadonlyMap<string, number>) {
  if (!extra.size) return;
  const next = new Map(hours);
  let changed = false;
  for (const [id, value] of extra) if (next.get(id) !== value) { next.set(id, value); changed = true; }
  if (!changed) return;
  hours = next;
  writeHoursCache(hours);
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const getHours = () => hours;
/** The remembered time-to-beat hours, keyed by game id. */
export const useHours = () => useSyncExternalStore(subscribe, getHours);
