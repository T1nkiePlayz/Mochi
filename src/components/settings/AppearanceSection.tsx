import { FileJson, FolderOpen, Palette } from "lucide-react";
import { MochiIcon } from "../MochiIcon";
import { importThemeFile, importThemeFolder } from "../../lib/theme";
import { useApp } from "../../state/AppContext";
import { SettingsGroup } from "./Section";

export function AppearanceSection() {
  const { themeEngine, actions } = useApp();
  const { themes, theme, setTheme, reloadThemes, configInfo } = themeEngine;
  const report = (error: unknown) => actions.setLaunchError(error instanceof Error ? error.message : String(error));
  return <SettingsGroup title="Appearance" subtitle="Personalize the launcher" id="settings-appearance">
    <div className="theme-grid">
      {themes.map((option) => (
        <button key={option.id} className={"theme-card " + (theme === option.id ? "selected" : "")} aria-pressed={theme === option.id} onClick={() => void setTheme(option.id)}>
          <MochiIcon name="palette" fallback={Palette} size={16} />
          {option.colors && <span className="theme-swatches" aria-hidden="true">{[option.colors.background, option.colors.surface, option.colors.accent, option.colors.text].map((color, index) => <i key={index} style={{ background: color }} />)}</span>}
          <strong>{option.name}</strong>
          <small>{option.description || "Mochi theme"}</small>
          <small className="theme-card-meta">{option.source === "builtin" ? "Built-in" : "v" + option.version + " · " + (option.author || "User theme")}</small>
        </button>
      ))}
    </div>
    <div className="theme-actions">
      <button className="secondary-button" onClick={() => void importThemeFile().then((result) => { if (result) void reloadThemes(); }).catch(report)}><MochiIcon name="theme-file" fallback={FileJson} size={14} /> Import theme file</button>
      <button className="secondary-button" onClick={() => void importThemeFolder().then((result) => { if (result) void reloadThemes(); }).catch(report)}><MochiIcon name="folder" fallback={FolderOpen} size={14} /> Import theme folder</button>
    </div>
    {configInfo && <div className="theme-config-path"><span>Theme directory</span><code>{configInfo.themesPath}</code></div>}
  </SettingsGroup>;
}
