import { FileJson, FolderOpen, Palette } from "lucide-react";
import { MochiIcon } from "../MochiIcon";
import { importThemeFile, importThemeFolder } from "../../lib/theme";
import { useApp } from "../../state/AppContext";
import { SettingsGroup, ToggleRow } from "./Section";
import { useTranslation } from "../../lib/useTranslation";

export function AppearanceSection() {
  const t = useTranslation();
  const { themeEngine, actions, behavior, setBehavior } = useApp();
  const { themes, theme, setTheme, reloadThemes, configInfo } = themeEngine;
  const report = (error: unknown) => actions.setLaunchError(error instanceof Error ? error.message : String(error));
  return <SettingsGroup title={t("Appearance")} subtitle={t("Personalize the launcher")} id="settings-appearance">
    <div className="theme-grid">
      {themes.map((option) => (
        <button key={option.id} className={"theme-card " + (theme === option.id ? "selected" : "")} aria-pressed={theme === option.id} onClick={() => void setTheme(option.id)}>
          <MochiIcon name="palette" fallback={Palette} size={16} />
          {option.colors && <span className="theme-swatches" aria-hidden="true">{[option.colors.background, option.colors.surface, option.colors.accent, option.colors.text].map((color, index) => <i key={index} style={{ background: color }} />)}</span>}
          <strong>{option.name}</strong>
          <small>{option.description || t("Mochi theme")}</small>
          <small className="theme-card-meta">{option.source === "builtin" ? t("Built-in") : "v" + option.version + " · " + (option.author || t("User theme"))}</small>
        </button>
      ))}
    </div>
    <div className="theme-actions">
      <button className="secondary-button" onClick={() => void importThemeFile().then((result) => { if (result) void reloadThemes(); }).catch(report)}><MochiIcon name="theme-file" fallback={FileJson} size={14} /> {t("Import theme file")}</button>
      <button className="secondary-button" onClick={() => void importThemeFolder().then((result) => { if (result) void reloadThemes(); }).catch(report)}><MochiIcon name="folder" fallback={FolderOpen} size={14} /> {t("Import theme folder")}</button>
    </div>
    {configInfo && <div className="theme-config-path"><span>{t("Theme directory")}</span><code>{configInfo.themesPath}</code></div>}
    <ToggleRow title={t("Game themes")} description="While a game's page is open, use that game's own colour (taken from its cover) as the accent. Works with every theme; nothing to set up per game." checked={behavior.gameThemes} onChange={(gameThemes) => setBehavior((current) => ({ ...current, gameThemes }))} />
  </SettingsGroup>;
}
