import { useState } from "react";
import { useTranslation } from "../../lib/useTranslation";
import { getTranslationLocale } from "../../lib/translationLocale";
import { hasRaCredentials, readRaConfig, testRaConnection, writeRaConfig } from "../../lib/retroAchievements";

/** RetroAchievements user name and Web API key (Settings > Achievements). Stored on this device only. */
export function RetroAchievementsSettings() {
  const t = useTranslation();
  const [config, setConfig] = useState(readRaConfig);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const ready = hasRaCredentials(config);
  const save = () => { writeRaConfig(config); setNote(t("Saved.")); };
  const test = async () => {
    writeRaConfig(config);
    setBusy(true); setNote("");
    const result = await testRaConnection(config);
    setBusy(false);
    setNote(result.ok ? t("Connected as {user} with {points} points.").replace("{user}", result.user ?? "").replace("{points}", (result.totalPoints ?? 0).toLocaleString(getTranslationLocale())) : t(result.message));
  };
  return <div className="settings-subgroup" role="group" aria-label={t("RetroAchievements")}>
    <div className="setting-row"><span><strong>{t("RetroAchievements")}</strong><small>{t("Show your RetroAchievements progress on game pages. Find your Web API key at retroachievements.org/settings. It stays on this device, is only sent to retroachievements.org, and is never synced, exported or copied into debug info.")}</small></span></div>
    <label className="setting-row"><span><strong>{t("RetroAchievements user name")}</strong></span>
      <input value={config.username} onChange={(event) => setConfig({ ...config, username: event.target.value })} autoComplete="off" spellCheck={false} aria-label={t("RetroAchievements user name")} /></label>
    <label className="setting-row"><span><strong>{t("RetroAchievements Web API key")}</strong></span>
      <input type="password" value={config.apiKey} onChange={(event) => setConfig({ ...config, apiKey: event.target.value })} autoComplete="off" spellCheck={false} aria-label={t("RetroAchievements Web API key")} /></label>
    <div className="setting-row"><span />
      <span><button type="button" className="secondary-button" onClick={save}>{t("Save")}</button> <button type="button" className="secondary-button" disabled={!ready || busy} onClick={() => void test()}>{busy ? t("Testing…") : t("Test connection")}</button></span></div>
    {note && <p className="metadata-note settings-note" role="status">{note}</p>}
  </div>;
}
