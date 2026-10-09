import { useEffect, useSyncExternalStore } from "react";
import { supabase } from "../lib/supabase";
import { isNetworkError } from "../lib/offline";
import { readString, writeString } from "../lib/storage";
import { deleteCloudAchievements, mergeAchievements, pullCloudAchievements, pushCloudAchievements, toCloudAchievements } from "../lib/achievementsCloud";
import { useApp } from "./AppContext";
import { ACHIEVEMENTS_CHANGED, clearLocalAchievements, readAchievements, writeAchievements } from "./useAchievements";

const SETTING_KEY = "mochi:achievements-cloud";
const SETTING_CHANGED = "mochi-achievements-cloud-setting";
const PUSH_DELAY_MS = 2000;

export type AchievementCloudStatus = { state: "off" | "unavailable" | "syncing" | "synced" | "offline" | "error"; message?: string; at?: number };

// Tiny store so Settings can show what the app-wide sync is doing without another context.
let status: AchievementCloudStatus = { state: "unavailable" };
const listeners = new Set<() => void>();
const setStatus = (next: AchievementCloudStatus) => { status = next; listeners.forEach((listener) => listener()); };
const subscribeStatus = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const useAchievementCloudStatus = () => useSyncExternalStore(subscribeStatus, () => status);

/** "Save achievements to cloud": on unless the user turned it off on this device. */
export const readAchievementCloudSetting = () => readString(SETTING_KEY) !== "off";
export function setAchievementCloudSetting(on: boolean) {
  writeString(SETTING_KEY, on ? "on" : "off");
  window.dispatchEvent(new Event(SETTING_CHANGED));
}
const subscribeSetting = (listener: () => void) => { window.addEventListener(SETTING_CHANGED, listener); return () => window.removeEventListener(SETTING_CHANGED, listener); };
export const useAchievementCloudSetting = () => useSyncExternalStore(subscribeSetting, readAchievementCloudSetting);

/** Cloud saving needs a signed-in account with Mochi cloud sync on, plus the setting. */
export function useAchievementCloudAvailability() {
  const { account, cloud } = useApp();
  const enabled = useAchievementCloudSetting();
  const available = Boolean(supabase && account.user && cloud.cloudSyncEnabled);
  return { available, enabled, active: available && enabled, signedIn: Boolean(account.user) };
}

const describe = (error: unknown) => (error instanceof Error ? error.message : typeof error === "object" && error && "message" in error ? String((error as { message: unknown }).message) : "Unknown error");

/**
 * App-wide (mounted by AchievementWatcher): on sign-in pulls the cloud row and merges it into the local copy
 * (union of unlocks, earliest time wins), then pushes local changes, debounced, while Mochi runs.
 */
export function useAchievementsCloudSync() {
  const { account } = useApp();
  const { active, available } = useAchievementCloudAvailability();
  const userId = account.user?.id;
  useEffect(() => {
    if (!active || !supabase || !userId) { setStatus({ state: available ? "off" : "unavailable" }); return; }
    const client = supabase;
    let cancelled = false;
    let lastPushed = "";
    let timer = 0;
    const fail = (error: unknown) => {
      if (cancelled) return;
      if (isNetworkError(error)) { setStatus({ state: "offline" }); return; }
      console.warn("Mochi achievements cloud sync failed", error);
      setStatus({ state: "error", message: describe(error) });
    };
    const push = async () => {
      const payload = toCloudAchievements(readAchievements());
      const json = JSON.stringify(payload);
      if (json === lastPushed) { setStatus({ state: "synced", at: Date.now() }); return; }
      setStatus({ state: "syncing" });
      await pushCloudAchievements(client, userId, payload);
      if (cancelled) return;
      lastPushed = json;
      setStatus({ state: "synced", at: Date.now() });
    };
    const onChange = () => { window.clearTimeout(timer); timer = window.setTimeout(() => void push().catch(fail), PUSH_DELAY_MS); };
    window.addEventListener(ACHIEVEMENTS_CHANGED, onChange);
    setStatus({ state: "syncing" });
    void (async () => {
      const remote = await pullCloudAchievements(client, userId);
      if (cancelled) return;
      if (remote) {
        lastPushed = JSON.stringify(remote);
        const local = readAchievements();
        const merged = mergeAchievements(local, remote);
        if (JSON.stringify(merged) !== JSON.stringify(local)) writeAchievements(merged);
      }
      await push();
    })().catch(fail);
    return () => { cancelled = true; window.clearTimeout(timer); window.removeEventListener(ACHIEVEMENTS_CHANGED, onChange); };
  }, [active, available, userId]);
}

/**
 * Clears local achievements and, when signed in, the cloud row too (first, so a later sync cannot bring them back).
 * Returns a message for the UI; throws only when nothing was cleared.
 */
export async function clearAllAchievements(userId: string | undefined, syncActive: boolean): Promise<string> {
  let cloudNote = "";
  if (supabase && userId) {
    try { await deleteCloudAchievements(supabase, userId); cloudNote = " Your cloud copy was deleted too."; }
    catch (error) {
      // While syncing, clearing only this device would be undone by the next merge, so stop here.
      if (syncActive) throw new Error(`Nothing was cleared: Mochi Cloud could not be reached (${describe(error)}).`);
      cloudNote = " Mochi Cloud could not be reached, so a cloud copy (if any) was kept.";
    }
  }
  clearLocalAchievements();
  return `Achievements cleared.${cloudNote} Achievements you still qualify for unlock again on the next check.`;
}
