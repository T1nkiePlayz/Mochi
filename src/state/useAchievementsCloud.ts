import { useEffect } from "react";
import { supabase } from "../lib/supabase";
import { isNetworkError } from "../lib/offline";
import { mergeAchievements, pullAchievements, pushAchievements, sameAchievements, toSynced } from "../lib/achievementsCloud";
import { ACHIEVEMENTS_CHANGED, readAchievements, saveAchievements } from "./useAchievements";

const PUSH_DELAY_MS = 1500;

/**
 * Keeps the signed-in account's achievements in Mochi Cloud while Cloud sync and the "save achievements" switch are on.
 * On start it merges the cloud copy into this device (union, earliest unlock wins) and uploads the result;
 * afterwards every local change is uploaded after a short pause.
 */
export function useAchievementsCloudSync(userId: string | undefined, enabled: boolean) {
  useEffect(() => {
    if (!supabase || !userId || !enabled) return;
    const client = supabase;
    let cancelled = false;
    let ready = false;
    let timer: number | undefined;
    const report = (error: unknown) => { if (!isNetworkError(error)) console.warn("Mochi achievements sync failed", error); };

    const push = () => {
      const local = readAchievements();
      // Nothing worth uploading before the first check has run (or right after a reset).
      if (!local.seeded && Object.keys(local.unlocked).length === 0) return;
      void pushAchievements(client, userId, toSynced(local)).catch(report);
    };
    const onChange = () => {
      if (!ready) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(push, PUSH_DELAY_MS);
    };

    void (async () => {
      try {
        const cloud = await pullAchievements(client, userId);
        if (cancelled) return;
        const local = readAchievements();
        const merged = cloud ? mergeAchievements(local, cloud) : local;
        if (!sameAchievements(toSynced(local), toSynced(merged))) saveAchievements(merged);
        if (!cloud || !sameAchievements(cloud, toSynced(merged))) await pushAchievements(client, userId, toSynced(merged));
        if (!cancelled) ready = true;
      } catch (error) { if (!cancelled) report(error); }
    })();

    window.addEventListener(ACHIEVEMENTS_CHANGED, onChange);
    return () => { cancelled = true; window.clearTimeout(timer); window.removeEventListener(ACHIEVEMENTS_CHANGED, onChange); };
  }, [userId, enabled]);
}
