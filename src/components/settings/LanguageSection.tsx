import { Check, Languages, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { applyLauncherLanguage, launcherLanguages, normalizeLanguage } from "../../lib/languages";
import { useApp } from "../../state/AppContext";
import { useTranslation } from "../../lib/useTranslation";
import { SettingsGroup } from "./Section";

export function LanguageSection() {
  const t = useTranslation();
  const { behavior, setBehavior } = useApp();
  const [query, setQuery] = useState("");
  const language = normalizeLanguage(behavior.language);
  const selectedLanguage = launcherLanguages.find((item) => item.code === language) ?? launcherLanguages.find((item) => item.code === "en")!;

  const visibleLanguages = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return launcherLanguages;
    return launcherLanguages.filter((item) => `${item.name} ${item.englishName} ${item.code}`.toLocaleLowerCase().includes(needle));
  }, [query]);

  const changeLanguage = (value: string) => {
    const nextLanguage = normalizeLanguage(value);
    // Apply immediately so document language and direction update with the persisted app preference.
    applyLauncherLanguage(nextLanguage);
    setBehavior((current) => current.language === nextLanguage ? current : { ...current, language: nextLanguage });
  };

  return <SettingsGroup title={t("Language")} subtitle={t("Launcher-wide language preference")} id="settings-language">
    <div className="language-settings">
      <div className="language-settings-summary">
        <div className="language-settings-description">
          <strong><Languages size={16} aria-hidden="true" /> {t("Display language")}</strong>
          <small>Used throughout Mochi wherever translations are available. Game news follows this language automatically.</small>
        </div>
        <div className="language-current" aria-live="polite">
          <span>{t("Display language")}</span>
          <strong lang={selectedLanguage.locale}>{selectedLanguage.name}</strong>
        </div>
      </div>

      <label className="language-search">
        <Search size={16} aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("Search {label}…").replace("{label}", t("Language").toLowerCase())}
          aria-label={t("Search {label}").replace("{label}", t("Language"))}
        />
      </label>

      <div className="language-options" role="group" aria-label={t("Language")}>
        {visibleLanguages.map((item) => {
          const selected = item.code === language;
          return <button
            type="button"
            key={item.code}
            className={`language-option ${selected ? "selected" : ""}`}
            aria-pressed={selected}
            aria-label={`${item.name} (${item.englishName})`}
            onClick={() => changeLanguage(item.code)}
          >
            <span className="language-option-copy">
              <strong lang={item.locale} dir={item.code === "ar" ? "rtl" : "auto"}>{item.name}</strong>
              <small>{item.englishName}</small>
            </span>
            <span className="language-option-indicator" aria-hidden="true">{selected && <Check size={17} />}</span>
          </button>;
        })}
      </div>
      {!visibleLanguages.length && <p className="language-no-results">{t("Nothing matches “{query}”.").replace("{query}", query)}</p>}
    </div>
  </SettingsGroup>;
}
