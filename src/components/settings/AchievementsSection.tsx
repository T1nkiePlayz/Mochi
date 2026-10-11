import { useState } from "react";
import { useTranslation } from "../../lib/useTranslation";
import { useApp } from "../../state/AppContext";
import { useStoredAchievements } from "../../state/useAchievements";
import { clearAllAchievements, setAchievementCloudSetting, useAchievementCloudAvailability, useAchievementCloudStatus } from "../../state/useAchievementsCloud";
import { confirmAction } from "../../lib/confirm";
import { formatRelativeTime } from "../../lib/format";
import { SettingsGroup, ToggleRow } from "./Section";

const statusText = (state: string, at: number | undefined, message: string | undefined, t: (message: string) => string): string => {
  switch (state) {
    case "syncing": return t("Saving to Mochi Cloud…");
    case "synced": return at ? t("Saved to Mochi Cloud {time}.").replace("{time}", formatRelativeTime(Math.floor(at / 1000))) : t("Saved to Mochi Cloud.");
    case "offline": return t("Offline. Achievements are kept on this device and saved when you are back online.");
    case "error": return t("Could not save to Mochi Cloud{error}. Achievements are kept on this device.").replace("{error}", message ? `: ${message}` : "");
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
  const description = !signedIn ? t("Sign in to keep unlocks and their dates on every device you use.")
    : !available ? t("Turn on Mochi cloud sync for this account to save achievements to the cloud.")
    : t("Keep unlocks and their dates in your Mochi account. Devices merge their achievements, keeping the earliest unlock.");

  const clear = async () => {
    const items = [t("{count} unlocked achievements and their unlock dates").replace("{count}", String(unlockedCount)), t("Recorded milestones (themes tried, sections opened, controller and Big Picture use)")];
    if (account.user) items.push(t("The copy saved in your Mochi account"));
    const ok = await confirmAction({
      title: t("Clear achievements data?"), danger: true, confirmLabel: t("Clear achievements"), items,
      message: t("Play history, playtime and your library are not touched, so achievements you still qualify for unlock again (with today's date). This cannot be undone."),
    });
    if (!ok) return;
    setBusy(true); setNote("");
    try { setNote(await clearAllAchievements(account.user?.id, active)); }
    catch (error) { setNote(error instanceof Error ? error.message : t("Could not clear achievements.")); }
    finally { setBusy(false); }
  };

  const line = active ? statusText(status.state, status.at, status.message, t) : "";
  return <SettingsGroup title={t("Achievements")} subtitle={t("Unlocks, cloud saving and reset")} id="settings-achievements">
    <ToggleRow title={t("Save achievements to cloud")} description={description} checked={available && enabled} disabled={!available} onChange={setAchievementCloudSetting} />
    {line && <p className={`metadata-note settings-note achievement-cloud-status is-${status.state}`} role="status">{line}</p>}
    <div className="setting-row">
      <span><strong>{t("Clear achievements data")}</strong><small>{unlockedCount ? t("{count} unlocked on this device{account}.").replace("{count}", String(unlockedCount)).replace("{account}", account.user ? t(" and in your account") : "") : t("No achievements unlocked yet.")} {t("Removes unlocks and recorded milestones.")}</small></span>
      <button type="button" className="secondary-button danger-outline" disabled={busy || (!unlockedCount && !account.user)} onClick={() => void clear()}>{busy ? t("Clearing…") : t("Clear achievements")}</button>
    </div>
    {note && <p className="metadata-note settings-note" role="status">{note}</p>}
  </SettingsGroup>;
}
