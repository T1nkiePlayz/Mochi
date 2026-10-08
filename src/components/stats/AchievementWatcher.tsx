import { useAchievementWatcher } from "../../state/useAchievements";

/** Renders nothing; keeps achievements up to date and announces new unlocks while Mochi is open. */
export function AchievementWatcher() {
  useAchievementWatcher();
  return null;
}
