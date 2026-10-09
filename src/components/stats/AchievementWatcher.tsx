import { memo } from "react";
import { useAchievementWatcher } from "../../state/useAchievements";
import { useAchievementsCloudSync } from "../../state/useAchievementsCloud";

/** Renders nothing; keeps achievements up to date (and saved to the cloud when enabled) and announces new unlocks while Mochi is open. */
export const AchievementWatcher = memo(function AchievementWatcher() {
  useAchievementWatcher();
  useAchievementsCloudSync();
  return null;
});
