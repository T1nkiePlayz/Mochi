import { Check, Palette } from "lucide-react";
import type { ThemeDescriptor } from "../../lib/theme";

type Props = { themes: ThemeDescriptor[]; theme: string; setTheme: (themeId: string) => Promise<void> };

const swatch = (value: string | undefined, fallback: string) => value ?? fallback;

export function ThemeStep({ themes, theme, setTheme }: Props) {
  return (
    <section className="setup-page setup-theme-page">
      <div className="setup-icon"><Palette size={22} /></div>
      <h1>Choose your theme.</h1>
      <p className="setup-description">Themes restyle the whole launcher and apply as soon as you pick one. Change it any time in Settings, where you can also install your own.</p>
      <div className="setup-theme-scroll">
        <div className="setup-theme-grid" role="radiogroup" aria-label="Theme">
          {themes.map((option) => {
            const colors = option.colors ?? {};
            const selected = theme === option.id;
            return (
              <button type="button" role="radio" aria-checked={selected} key={option.id} className={"setup-theme-card" + (selected ? " selected" : "")} onClick={() => void setTheme(option.id)}>
                <span className="setup-swatch" aria-hidden="true" style={{ background: swatch(colors.background, "#111") }}>
                  <i style={{ background: swatch(colors.surface, "#222") }} />
                  <b style={{ background: swatch(colors.accent, "#8f8") }} />
                  <em style={{ background: swatch(colors.text, "#ddd") }} />
                  <u style={{ background: swatch(colors.surfaceRaised ?? colors.surface, "#333") }} />
                </span>
                <span className="setup-theme-copy">
                  <strong>{option.name}{option.source === "user" ? " (yours)" : ""}</strong>
                  <small>{option.description ?? (option.scheme === "light" ? "Light" : "Dark")}</small>
                </span>
                {selected && <span className="setup-theme-check" aria-hidden="true"><Check size={13} /></span>}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
