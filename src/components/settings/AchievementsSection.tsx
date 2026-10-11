import { useState } from "react";
import { useTranslation } from "../../lib/useTranslation";
import { useApp } from "../../state/AppContext";
import { useStoredAchievements } from "../../state/useAchievements";
import { clearAllAchievements, setAchievementCloudSetting, useAchievementCloudAvailability, useAchievementCloudStatus } from "../../state/useAchievementsCloud";
import { confirmAction } from "../../lib/confirm";
import { formatRelativeTime } from "../../lib/format";
import { SettingsGroup, ToggleRow } from "./Section";

const statusText = (state: string, at?: number, message?: string): string => {
  switch (state) {
    case "syncing": return "Saving to Mochi Cloud…";
    case "synced": return at ? `Saved to Mochi Cloud ${formatRelativeTime(Math.floor(at / 1000))}.` : "Saved to Mochi Cloud.";
    case "offline": return "Offline. Achievements are kept on this device and saved when you are back online.";
    case "error": return `Could not save to Mochi Cloud${message ? `: ${message}` : "."} Achievements are kept on this device.`;
    default: return "";
  }
};

export function AchievementsSection() {
  const t = useTranslation();
  const { account } = useApp();
  const stored = useStoredAchievements();
  const { available, enabled, active, signedIn } = useAchievementCloudAvailability();
  const status = useAchievementCloudStatus();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const unlockedCount = Object.keys(stored.unlocked).length;
  const description = !signedIn ? "Sign in to keep unlocks and their dates on every device you use."
    : !available ? "Turn on Mochi cloud sync for this account to save achievements to the cloud."
    : "Keep unlocks and their dates in your Mochi account. Devices merge their achievements, keeping the earliest unlock.";

  const clear = async () => {
    const items = [`${unlockedCount} unlocked achievement${unlockedCount === 1 ? "" : "s"} and their unlock dates`, "Recorded milestones (themes tried, sections opened, controller and Big Picture use)"];
    if (account.user) items.push("The copy saved in your Mochi account");
    const ok = await confirmAction({
      title: "Clear achievements data?", danger: true, confirmLabel: "Clear achievements", items,
      message: "Play history, playtime and your library are not touched, so achievements you still qualify for unlock again (with today's date). This cannot be undone.",
    });
    if (!ok) return;
    setBusy(true); setNote("");
    try { setNote(await clearAllAchievements(account.user?.id, active)); }
    catch (error) { setNote(error instanceof Error ? error.message : "Could not clear achievements."); }
    finally { setBusy(false); }
  };

  const line = active ? statusText(status.state, status.at, status.message) : "";
  return <SettingsGroup title={t("Achievements")} subtitle={t("Unlocks, cloud saving and reset")} id="settings-achievements">
    <ToggleRow title={t("Save achievements to cloud")} description={description} checked={available && enabled} disabled={!available} onChange={setAchievementCloudSetting} />
    {line && <p className={`metadata-note settings-note achievement-cloud-status is-${status.state}`} role="status">{line}</p>}
    <div className="setting-row">
      <span><strong>Clear achievements data</strong><small>{unlockedCount ? `${unlockedCount} unlocked on this device${account.user ? " and in your account" : ""}.` : "No achievements unlocked yet."} Removes unlocks and recorded milestones.</small></span>
      <button type="button" className="secondary-button danger-outline" disabled={busy || (!unlockedCount && !account.user)} onClick={() => void clear()}>{busy ? "Clearing…" : "Clear achievements"}</button>
    </div>
    {note && <p className="metadata-note settings-note" role="status">{note}</p>}
  </SettingsGroup>;
}
