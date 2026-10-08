import { settingsSections } from "../components/settings";

export function SettingsView() {
  return <section className="settings-page">
    <div className="settings-intro"><p className="eyebrow">Preferences</p><h2>Make Mochi yours.</h2><p>These settings are stored locally on this device. Cloud sync can be enabled later without changing your library.</p></div>
    {settingsSections.map(({ id, Section }) => <Section key={id} />)}
  </section>;
}
