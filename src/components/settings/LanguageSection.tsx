import { Languages } from "lucide-react";
import { launcherLanguages, normalizeLanguage } from "../../lib/languages";
import { useApp } from "../../state/AppContext";
import { Select, type SelectOption } from "../ui/Select";
import { SettingsGroup } from "./Section";

const options: SelectOption[] = launcherLanguages.map((language) => ({
  value: language.code,
  label: language.name,
  description: language.englishName,
}));

export function LanguageSection() {
  const { behavior, setBehavior } = useApp();
  const language = normalizeLanguage(behavior.language);
  return <SettingsGroup title="Language" subtitle="Launcher-wide language preference" id="settings-language">
    <div className="setting-row language-setting-row">
      <span><strong><Languages size={15} aria-hidden="true" /> Display language</strong><small>Used throughout Mochi wherever translations are available. Game news follows this language automatically.</small></span>
      <Select value={language} onChange={(value) => setBehavior((current) => ({ ...current, language: normalizeLanguage(value) }))} options={options} label="Display language" searchable />
    </div>
  </SettingsGroup>;
}
