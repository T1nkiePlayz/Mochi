import { useSyncExternalStore } from "react";
import type { Piko, Tofu } from "../models";
import { applyModUpdate, checkTofuUpdates } from "../lib/mods/updateService";
import type { ModSourceSettings } from "../lib/mods/resolveSources";
import { dueForCheck, installableUpdates, type ModUpdateItem, type UpdateCheck } from "../lib/mods/updates";

/** Update state per Tofu, held in memory only: nothing from a mod site is written to disk. */
export type TofuUpdateState = {
  status: "idle" | "checking" | "done";
  check?: UpdateCheck;
  /** Paths of files being updated right now. */
  updating: readonly string[];
  /** Last result of applying updates, for display. */
  message?: string;
};

const IDLE: TofuUpdateState = { status: "idle", updating: [] };
const states = new Map<string, TofuUpdateState>();
const inflight = new Map<string, Promise<UpdateCheck>>();
const listeners = new Set<() => void>();
/** After a check that found a problem, wait before trying again on its own. */
const RETRY_AFTER_FAILURE_MS = 15 * 60 * 1000;

let version = 0;

function set(tofuId: string, next: TofuUpdateState) {
  states.set(tofuId, next);
  version += 1;
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export const getUpdateState = (tofuId: string): TofuUpdateState => states.get(tofuId) ?? IDLE;

/** Live update state of one Tofu. */
export function useTofuUpdates(tofuId: string | undefined): TofuUpdateState {
  return useSyncExternalStore(subscribe, () => (tofuId ? getUpdateState(tofuId) : IDLE), () => IDLE);
}

/** Changes whenever any Tofu's update state changes; for lists that read several Tofus with `getUpdateState`. */
export function useUpdateVersion(): number {
  return useSyncExternalStore(subscribe, () => version, () => 0);
}

/** Number of updates Mochi can install for the Tofu (manual ones are listed but not counted as installable). */
export const updateCount = (state: TofuUpdateState) => state.check?.items.length ?? 0;

/**
 * Starts a check unless one is running or the last one is recent. Returns immediately-ish: callers do not need to await it,
 * and a failing check only leaves a note. `force` skips the interval (the "Check now" buttons).
 */
export function ensureChecked(tofu: Tofu, piko: Piko | undefined, modSources: ModSourceSettings, force = false): Promise<UpdateCheck | undefined> {
  const running = inflight.get(tofu.id);
  if (running) return running;
  const current = getUpdateState(tofu.id);
  const lastAt = current.check?.checkedAt;
  const failed = (current.check?.notes.length ?? 0) > 0 && !current.check?.items.length;
  if (!force && lastAt && !dueForCheck(lastAt, Date.now(), failed ? RETRY_AFTER_FAILURE_MS : undefined)) return Promise.resolve(current.check);
  set(tofu.id, { ...current, status: "checking" });
  const promise = checkTofuUpdates(tofu, piko, modSources).then((check) => {
    set(tofu.id, { ...getUpdateState(tofu.id), status: "done", check, message: undefined });
    return check;
  }).finally(() => { inflight.delete(tofu.id); });
  inflight.set(tofu.id, promise);
  return promise;
}

export type ApplyResult = { updated: number; failed: Array<{ title: string; error: string }> };

/** Applies updates one after another (each verified); the rest of the list stays usable while this runs. */
export async function applyUpdates(tofu: Tofu, items: readonly ModUpdateItem[], options: { deadline?: number } = {}): Promise<ApplyResult> {
  const result: ApplyResult = { updated: 0, failed: [] };
  for (const item of installableUpdates(items)) {
    if (options.deadline && Date.now() > options.deadline) break;
    const before = getUpdateState(tofu.id);
    set(tofu.id, { ...before, updating: [...before.updating, item.path] });
    try {
      await applyModUpdate(tofu, item);
      result.updated += 1;
      const state = getUpdateState(tofu.id);
      set(tofu.id, { ...state, check: state.check && { ...state.check, items: state.check.items.filter((entry) => entry.path !== item.path) } });
    } catch (error) {
      result.failed.push({ title: item.title, error: error instanceof Error ? error.message : String(error) });
    } finally {
      const state = getUpdateState(tofu.id);
      set(tofu.id, { ...state, updating: state.updating.filter((path) => path !== item.path) });
    }
  }
  const state = getUpdateState(tofu.id);
  set(tofu.id, { ...state, message: result.failed.length ? `Updated ${result.updated}; ${result.failed.length} failed (${result.failed[0].title}: ${result.failed[0].error}).` : result.updated ? `Updated ${result.updated} mod${result.updated === 1 ? "" : "s"}.` : state.message });
  return result;
}

/**
 * Called when a game starts and the user turned on "Automatically update mods": checks (bounded wait) and installs
 * what it can before the game is launched. Never throws; the caller launches regardless.
 */
export async function updateBeforeLaunch(tofu: Tofu, piko: Piko, modSources: ModSourceSettings, notify: (title: string, message: string) => void): Promise<void> {
  if (!tofu.path) return;
  try {
    const check = await Promise.race([ensureChecked(tofu, piko, modSources, true), new Promise<undefined>((resolve) => window.setTimeout(() => resolve(undefined), 12_000))]);
    const wanted = installableUpdates(check?.items ?? []);
    if (!wanted.length) return;
    notify("Updating mods", `Updating ${wanted.length} mod${wanted.length === 1 ? "" : "s"} for ${tofu.name} before launch.`);
    const result = await applyUpdates(tofu, wanted, { deadline: Date.now() + 25_000 });
    if (result.failed.length) notify("Some mods were not updated", `${result.failed[0].title}: ${result.failed[0].error}`);
  } catch { /* launching matters more than updating */ }
}
