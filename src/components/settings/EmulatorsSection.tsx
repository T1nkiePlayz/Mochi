import { useCallback, useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { X } from "lucide-react";
import { useTranslation } from "../../lib/useTranslation";
import { Select } from "../ui/Select";
import { SettingsGroup } from "./Section";
import {
  AUTO_SYSTEM, addRomFolder, getEmulatorOverview, removeRomFolder, setEmulatorSettings, setFolderSystem, setSystemChoice,
  type EmulatorOverview, type EmulatorSettings,
} from "../../lib/emulators";

/** ROM folders, and which emulator (and RetroArch core) runs each system. Stored on this device by the native side. */
export function EmulatorsSection() {
  const t = useTranslation();
  const [overview, setOverview] = useState<EmulatorOverview | null>(null);
  const [error, setError] = useState("");
  const [args, setArgs] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    getEmulatorOverview().then((next) => { if (!cancelled) { setOverview(next); setArgs(Object.fromEntries(Object.entries(next.settings.systems).map(([id, choice]) => [id, choice.args ?? ""]))); } })
      .catch((reason) => { if (!cancelled) setError(String(reason)); });
    return () => { cancelled = true; };
  }, []);

  const save = useCallback(async (next: EmulatorSettings) => {
    try { setOverview(await setEmulatorSettings(next)); setError(""); } catch (reason) { setError(String(reason)); }
  }, []);

  const addFolder = async () => {
    const chosen = await openDialog({ title: t("Choose a ROM folder"), directory: true, multiple: false }).catch(() => null);
    if (overview && typeof chosen === "string" && chosen) void save(addRomFolder(overview.settings, chosen));
  };

  const settings = overview?.settings;
  const installedName = (id: string | null) => overview?.emulators.find((emulator) => emulator.id === id)?.name ?? "";
  const systemOptions = [{ value: AUTO_SYSTEM, label: t("Auto by extension") }, ...(overview?.systems ?? []).map((system) => ({ value: system.id, label: system.name }))];
  return <SettingsGroup title={t("Emulators")} subtitle={t("ROM folders and the emulators that run them. Stored on this device only.")} id="settings-emulators">
    {error && <small className="metadata-note" role="alert">{error}</small>}
    {!overview && !error && <small className="metadata-note">{t("Loading…")}</small>}
    {overview && settings && <>
      <div className="setting-row"><span><strong>{t("ROM folders")}</strong><small>{t("Scanned when you import from Emulators and ROMs. Pick a system for a folder, or let Mochi tell by folder name and file extension.")}</small></span>
        <button type="button" className="secondary-button" onClick={() => void addFolder()}>{t("Add ROM folder")}</button></div>
      {settings.folders.length === 0 ? <small className="metadata-note">{t("No ROM folders yet.")}</small> : <ul className="screenshot-folders" aria-label={t("ROM folders")}>{settings.folders.map((folder) => <li key={folder.path}>
        <span title={folder.path}>{folder.path}</span>
        <Select value={folder.system} options={systemOptions} label={t("System for {name}").replace("{name}", folder.path)} onChange={(system) => void save(setFolderSystem(settings, folder.path, system))} />
        <button type="button" className="icon-button" aria-label={t("Remove {name}").replace("{name}", folder.path)} onClick={() => void save(removeRomFolder(settings, folder.path))}><X size={14} /></button>
      </li>)}</ul>}
      <div className="setting-row"><span><strong>{t("Detected emulators")}</strong><small>{overview.emulators.map((emulator) => `${emulator.name}: ${emulator.installedVia === null ? t("Not installed") : emulator.installedVia === "flatpak" ? t("Installed (Flatpak)") : t("Installed")}`).join(" · ")}</small></span></div>
      <div className="setting-row"><span><strong>{t("Systems")}</strong><small>{t("Leave Default to use the first installed emulator and RetroArch core for a system.")}</small></span></div>
      {overview.systems.map((system) => {
        const choice = settings.systems[system.id] ?? {};
        const emulator = choice.emulator || system.defaultEmulator || "";
        const defaultLabel = (name: string) => name ? t("Default ({name})").replace("{name}", name) : t("Default");
        return <div className="setting-row" key={system.id}>
          <span><strong>{system.name}</strong><small>{system.extensions.map((extension) => `.${extension}`).join(" ")}</small></span>
          <span className="setting-controls">
            <Select value={choice.emulator ?? ""} label={t("Emulator for {name}").replace("{name}", system.name)} onChange={(value) => void save(setSystemChoice(settings, system.id, { emulator: value }))}
              options={[{ value: "", label: defaultLabel(installedName(system.defaultEmulator)) }, ...system.emulators.map((id) => ({ value: id, label: installedName(id) || id, disabled: overview.emulators.find((item) => item.id === id)?.installedVia === null }))]} />
            {emulator === "retroarch" && <Select value={choice.core ?? ""} label={t("RetroArch core for {name}").replace("{name}", system.name)} onChange={(value) => void save(setSystemChoice(settings, system.id, { core: value }))}
              options={[{ value: "", label: defaultLabel(system.defaultCore ?? "") }, ...system.cores.map((core) => ({ value: core, label: core }))]} />}
            <input className="compact-input" type="text" value={args[system.id] ?? ""} placeholder={t("Extra arguments")} aria-label={t("Extra arguments for {name}").replace("{name}", system.name)}
              onChange={(event) => setArgs({ ...args, [system.id]: event.target.value })}
              onBlur={() => { if ((args[system.id] ?? "") !== (choice.args ?? "")) void save(setSystemChoice(settings, system.id, { args: args[system.id] ?? "" })); }} />
          </span>
        </div>;
      })}
    </>}
  </SettingsGroup>;
}
