import { useMemo, useState } from "react";
import { useTranslation } from "../../lib/useTranslation";
import { getTranslationLocale } from "../../lib/translationLocale";
import { Download, Upload, X } from "lucide-react";
import { useApp } from "../../state/AppContext";
import { announce, useAccessibility } from "../../state/accessibility";
import { Select } from "../ui/Select";
import { SECTION_IDS, planImport, sanitizeSections, sectionInfo, type ImportMode, type Selection } from "../../lib/settingsExport";
import { commitImport, exportSettings, installThemesFromFile, pickSettingsFile, readSnapshot, type SettingsFile } from "../../lib/settingsTransfer";

const MODES: Array<{ value: ImportMode; label: string; description: string }> = [
  { value: "merge", label: "Merge", description: "Keep what you have and add what is missing." },
  { value: "replace", label: "Replace", description: "Overwrite with the file's version." },
];
const message = (error: unknown, t: (message: string) => string) => (error instanceof Error ? error.message : typeof error === "string" ? error : t("Something went wrong."));

/** Export and import of portable settings (Settings > Data). Import shows a preview first and changes nothing until confirmed. */
export function SettingsTransfer() {
  const t = useTranslation();
  const app = useApp();
  const { settings: accessibility } = useAccessibility();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [file, setFile] = useState<SettingsFile | null>(null);
  const snapshot = () => readSnapshot({ behavior: app.behavior, accessibility, collections: app.collections.collections, library: app.lib.library, theme: app.themeEngine.theme, librarySort: app.lib.librarySort });

  const runExport = async () => {
    setBusy(true); setNote("");
    try { setNote((await exportSettings(snapshot(), true)) ? t("Settings exported. The file holds no passwords, keys or sign-in data.") : ""); }
    catch (error) { setNote(t("Could not export: {error}").replace("{error}", message(error, t))); }
    finally { setBusy(false); }
  };
  const runPick = async () => {
    setBusy(true); setNote("");
    try { setFile(await pickSettingsFile()); }
    catch (error) { setNote(t("Could not read that file: {error}").replace("{error}", message(error, t))); }
    finally { setBusy(false); }
  };

  return <>
    <div className="setting-row"><span><strong>{t("Settings backup")}</strong><small>{t("Export your settings, themes, collections, wishlist and per-game choices to a zip, or restore them on another device. Passwords, keys and sign-in data are never included.")}</small></span>
      <span className="data-source-actions">
        <button type="button" className="secondary-button" disabled={busy} onClick={() => void runExport()}><Download size={14} aria-hidden="true" /> {t("Export settings…")}</button>
        <button type="button" className="secondary-button" disabled={busy} onClick={() => void runPick()}><Upload size={14} aria-hidden="true" /> {t("Import settings…")}</button>
      </span></div>
    {note && <p className="metadata-note settings-note" role="status">{note}</p>}
    {file && <ImportSheet file={file} onClose={() => setFile(null)} onDone={(text) => { setFile(null); setNote(text); announce(text); }} />}
  </>;
}

function ImportSheet({ file, onClose, onDone }: { file: SettingsFile; onClose: () => void; onDone: (text: string) => void }) {
  const t = useTranslation();
  const app = useApp();
  const { settings: accessibility, update: updateAccessibility } = useAccessibility();
  const present = SECTION_IDS.filter((id) => file.sections[id] !== undefined);
  const installed = useMemo(() => new Set(app.themeEngine.themes.map((theme) => theme.id)), [app.themeEngine.themes]);
  const [selection, setSelection] = useState<Selection>(() => Object.fromEntries(present.map((id) => [id, { enabled: true, mode: "merge" as ImportMode }])));
  const [themeIds, setThemeIds] = useState<string[]>(() => file.themes.filter((theme) => !installed.has(theme.id)).map((theme) => theme.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const knownThemes = useMemo(() => [...installed, ...themeIds], [installed, themeIds]);
  const sections = useMemo(() => sanitizeSections(file.sections, knownThemes), [file, knownThemes]);
  const snapshot = useMemo(() => readSnapshot({ behavior: app.behavior, accessibility, collections: app.collections.collections, library: app.lib.library, theme: app.themeEngine.theme, librarySort: app.lib.librarySort }),
    [app.behavior, accessibility, app.collections.collections, app.lib.library, app.themeEngine.theme, app.lib.librarySort]);
  const plan = useMemo(() => planImport(snapshot, sections, selection), [snapshot, sections, selection]);
  const nothing = !present.some((id) => selection[id]?.enabled) && themeIds.length === 0;
  const set = (id: (typeof SECTION_IDS)[number], change: Partial<{ enabled: boolean; mode: ImportMode }>) => setSelection((current) => ({ ...current, [id]: { enabled: true, mode: "merge", ...current[id], ...change } }));

  const apply = async () => {
    setBusy(true); setError("");
    try {
      let themeNote = "";
      let available = app.themeEngine.themes.map((theme) => theme.id);
      if (themeIds.length) {
        const result = await installThemesFromFile(file.path, themeIds);
        available = (await app.themeEngine.reloadThemes()).map((theme) => theme.id);
        themeNote = result.installed.length ? t("{count} themes installed. ").replace("{count}", String(result.installed.length)) : "";
      }
      await commitImport(plan, {
        setBehavior: app.setBehavior, updateAccessibility, replaceCollections: app.collections.replaceCollections, setLibrary: app.lib.setLibrary,
        setLibrarySort: app.lib.setLibrarySort, selectTheme: app.themeEngine.setTheme, currentTheme: app.themeEngine.theme, knownThemeIds: available,
      });
      onDone(t("{themes}Imported {count} settings sections. Everything is applied now.").replace("{themes}", themeNote).replace("{count}", String(plan.changed.length)));
    } catch (failure) { setError(message(failure, t); setBusy(false); }
  };

  const created = file.manifest.createdAt ? new Date(file.manifest.createdAt).toLocaleString(getTranslationLocale()) : t("unknown date");
  return <div className="modal-backdrop" onClick={onClose}>
    <div role="dialog" aria-modal="true" aria-labelledby="settings-import-title" className="modal settings-import-modal" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}>
      <div className="modal-header">
        <div><p className="eyebrow">{t("Settings backup")}</p><h2 id="settings-import-title">{t("Import settings")}</h2></div>
        <button type="button" className="icon-button" aria-label={t("Close")} onClick={onClose}><X size={17} /></button>
      </div>
      <p className="modal-description">{t("Exported {date}{version}.").replace("{date}", created).replace("{version}", file.manifest.appVersion ? ` by Mochi ${file.manifest.appVersion}` : "")} {t("Nothing changes until you press Import.")}</p>
      <div className="settings-import-list" role="list">
        {present.map((id) => {
          const entry = selection[id] ?? { enabled: false, mode: "merge" as ImportMode };
          const summary = plan.summary.find((item) => item.id === id);
          return <div className="settings-import-row" role="listitem" key={id}>
            <label className="settings-import-check"><input type="checkbox" checked={entry.enabled} onChange={(event) => set(id, { enabled: event.target.checked })} /><span><strong>{t(sectionInfo[id].label)}</strong><small>{t(sectionInfo[id].detail)}</small></span></label>
            {sectionInfo[id].modes && <Select<ImportMode> label={t("{section}: how to apply").replace("{section}", t(sectionInfo[id].label))} value={entry.mode} options={MODES.map((mode) => ({ ...mode, label: t(mode.label), description: t(mode.description) }))} disabled={!entry.enabled} onChange={(mode) => set(id, { mode })} align="end" />}
            <small className="settings-import-summary" aria-live="polite">{entry.enabled ? summary?.lines.join(" · ") : t("Skipped")}</small>
          </div>;
        })}
        {file.themes.length > 0 && <div className="settings-import-row" role="listitem">
          <strong>{t("Themes")}</strong>
          {file.themes.map((theme) => {
            const exists = installed.has(theme.id);
            return <label className="settings-import-check" key={theme.id}><input type="checkbox" checked={themeIds.includes(theme.id)} disabled={exists} onChange={(event) => setThemeIds((current) => (event.target.checked ? [...current, theme.id] : current.filter((id) => id !== theme.id)))} /><span><strong>{theme.name}</strong><small>{exists ? t("Already installed, kept as is") : t("Install theme {id} v{version}").replace("{id}", theme.id).replace("{version}", theme.version)}</small></span></label>;
          })}
        </div>}
        {present.length === 0 && file.themes.length === 0 && <p className="modal-description">{t("This file has nothing to import.")}</p>}
      </div>
      {error && <p className="metadata-note settings-note" role="alert">{error}</p>}
      <div className="settings-import-actions">
        <button type="button" className="secondary-button" onClick={onClose}>{t("Cancel")}</button>
        <button type="button" className="play-button" disabled={busy || nothing} onClick={() => void apply()}>{busy ? t("Importing…") : t("Import")}</button>
      </div>
    </div>
  </div>;
}
