import { Github, LayoutDashboard } from "lucide-react";
import { useTranslation } from "../../lib/useTranslation";
import { openExternalUrl } from "../../lib/platform";
import { useApp } from "../../state/AppContext";
import { SettingsGroup } from "./Section";

const DASHBOARD_URL = "https://mochi.ashtontink.com/#/dashboard";

export function HelpSection() {
  const t = useTranslation();
  const { resetLocalData } = useApp();
  return <>
    <SettingsGroup title={t("Help & feedback")} subtitle={t("Report a problem or request a feature")} id="settings-help">
      <a className="setting-row help-link" href={DASHBOARD_URL} target="_blank" rel="noreferrer" onClick={(event) => { event.preventDefault(); void openExternalUrl(DASHBOARD_URL).catch(() => undefined); }}><span><strong>{t("Open Mochi dashboard")}</strong><small>{t("Manage your account, devices and cloud library on the website.")}</small></span><LayoutDashboard size={16}/></a>
      <a className="setting-row help-link" href="https://github.com/T1nkiePlayz/Mochi/issues" target="_blank" rel="noreferrer" onClick={(event) => { event.preventDefault(); void openExternalUrl("https://github.com/T1nkiePlayz/Mochi/issues").catch(() => undefined); }}><span><strong>{t("GitHub issues")}</strong><small>{t("View known issues or report a new one.")}</small></span><Github size={16}/></a>
    </SettingsGroup>
    <button className="reset-button" onClick={() => void resetLocalData()}>{t("Clear all Mochi app data")}</button>
  </>;
}
