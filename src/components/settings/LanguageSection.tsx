import { Languages } from "lucide-react";
import { applyLauncherLanguage, launcherLanguages, normalizeLanguage } from "../../lib/languages";
import { useApp } from "../../state/AppContext";
import { Select, type SelectOption } from "../ui/Select";
import { SettingsGroup } from "./Section";
import { useTranslation } from "../../lib/useTranslation";

const options: SelectOption[] = launcherLanguages.map((language) => ({
  value: language.code,
  label: language.name,
  description: language.englishName,
}));

export function LanguageSection() {
  const t = useTranslation();
  const { behavior, setBehavior } = useApp();
  const language = normalizeLanguage(behavior.language);
  const changeLanguage = (value: string) => {
    const nextLanguage = normalizeLanguage(value);
    // Update the document locale immediately; React state then refreshes every translated component.
    applyLauncherLanguage(nextLanguage);
    setBehavior((current) => current.language === nextLanguage ? current : { ...current, language: nextLanguage });
  };
  return <SettingsGroup title={t("Language")} subtitle={t("Launcher-wide language preference")} id="settings-language">
    <div className="setting-row language-setting-row">
      <span><strong><Languages size={15} aria-hidden="true" /> Display language</strong><small>Used throughout Mochi wherever translations are available. Game news follows this language automatically.</small></span>
      <Select value={language} onChange={changeLanguage} options={options} label={t("Display language")} searchable className="language-select" />
    </div>
  </SettingsGroup>;
}
