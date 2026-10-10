import { Check, Languages } from "lucide-react";
import { useMemo, useState } from "react";
import { launcherLanguages, normalizeLanguage, type LauncherLanguage } from "../../lib/languages";

export function LanguageStep({ language, setLanguage }: { language: string; setLanguage: (language: LauncherLanguage) => void }) {
  const [query, setQuery] = useState("");
  const options = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return launcherLanguages.filter((item) => !needle || item.name.toLocaleLowerCase().includes(needle) || item.englishName.toLocaleLowerCase().includes(needle) || item.code.toLocaleLowerCase().includes(needle));
  }, [query]);
  const selected = normalizeLanguage(language);
  return <section className="setup-page setup-language-page">
    <div className="setup-icon"><Languages size={22} /></div>
    <h1>Choose your language.</h1>
    <p className="setup-description">Choose the language Mochi should use wherever a translation is available. Game news will automatically follow this choice. You can change it any time in Settings.</p>
    <label className="setup-language-search">
      <span className="sr-only">Search languages</span>
      <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search languages…" autoComplete="off" />
    </label>
    <div className="setup-language-list" role="radiogroup" aria-label="Launcher language">
      {options.map((item) => {
        const active = item.code === selected;
        return <button type="button" role="radio" aria-checked={active} key={item.code} className={`setup-language-option${active ? " selected" : ""}`} onClick={() => setLanguage(item.code)}>
          <span className="setup-language-name">{item.name}<small>{item.englishName}</small></span>
          {active && <Check size={16} aria-hidden="true" />}
        </button>;
      })}
      {!options.length && <p className="setup-language-empty">No languages match “{query}”.</p>}
    </div>
  </section>;
}
