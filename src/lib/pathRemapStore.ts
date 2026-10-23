import { useSyncExternalStore } from "react";
import type { PathSlot } from "./pathRemap";

/** Games whose paths do not exist on this device (with the paths), and whether the review sheet is open. Module state so cards and pages need no props. */
let missing: ReadonlyMap<string, PathSlot[]> = new Map();
let reviewOpen = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const same = (a: PathSlot[] | undefined, b: PathSlot[]) => Boolean(a) && a!.length === b.length && a!.every((slot, i) => slot.path === b[i].path && slot.field === b[i].field && slot.tofuId === b[i].tofuId && slot.launchSourceId === b[i].launchSourceId);

/** Replaces the missing set. Per-game arrays keep their identity when unchanged, so subscribers re-render only for real changes. */
export function setMissing(next: Map<string, PathSlot[]>) {
  const merged = new Map<string, PathSlot[]>();
  for (const [id, slots] of next) merged.set(id, same(missing.get(id), slots) ? missing.get(id)! : slots);
  const unchanged = merged.size === missing.size && [...merged].every(([id, slots]) => missing.get(id) === slots);
  if (unchanged) return;
  missing = merged;
  emit();
}

export const getMissing = () => missing;
export const missingCount = () => missing.size;
export const openPathReview = () => { reviewOpen = true; emit(); };
export const closePathReview = () => { reviewOpen = false; emit(); };

const NONE: PathSlot[] = [];
/** The missing paths of one game (a stable empty array when it has none). */
export const useMissingSlots = (gameId: string) => useSyncExternalStore(subscribe, () => missing.get(gameId) ?? NONE);
export const useMissingCount = () => useSyncExternalStore(subscribe, () => missing.size);
export const usePathReviewOpen = () => useSyncExternalStore(subscribe, () => reviewOpen);
