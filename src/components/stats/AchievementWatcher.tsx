import { useAchievementWatcher } from "../../state/useAchievements";
import { useAchievementsCloudSync } from "../../state/useAchievementsCloud";
import { useApp } from "../../state/AppContext";

/** Renders nothing; keeps achievements up to date, announces new unlocks and syncs them to Mochi Cloud when enabled. */
export function AchievementWatcher() {
  const { account, cloud, behavior } = useApp();
  useAchievementWatcher();
  useAchievementsCloudSync(account.user?.id, cloud.cloudSyncEnabled && behavior.achievementsToCloud);
  return null;
}
