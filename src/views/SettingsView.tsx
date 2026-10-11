import { settingsSections } from "../components/settings";
import { useTranslation } from "../lib/useTranslation";

export function SettingsView() {
  const t = useTranslation();
  return <section className="settings-page">
    <div className="settings-intro"><p className="eyebrow">{t("Preferences")}</p><h2>{t("Make Mochi yours.")}</h2><p>These settings are stored locally on this device. Cloud sync can be enabled later without changing your library.</p></div>
    {settingsSections.map(({ id, Section }) => <Section key={id} />)}
  </section>;
}
