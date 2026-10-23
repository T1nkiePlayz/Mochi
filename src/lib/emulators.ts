import { invoke } from "@tauri-apps/api/core";

export type RomFolder = { path: string; system: string };
export type SystemChoice = { emulator: string; core: string; args: string };
export type EmulatorSettings = { folders: RomFolder[]; systems: Record<string, Partial<SystemChoice>> };

export type EmulatorSystem = {
  id: string;
  name: string;
  extensions: string[];
  /** Emulators that can run the system (installed or not), best first. */
  emulators: string[];
  /** Installed RetroArch cores known for the system. */
  cores: string[];
  defaultEmulator: string | null;
  defaultCore: string | null;
};
export type EmulatorInfo = { id: string; name: string; installedVia: "native" | "flatpak" | "app" | null };
export type EmulatorOverview = { systems: EmulatorSystem[]; emulators: EmulatorInfo[]; settings: EmulatorSettings };

export const AUTO_SYSTEM = "auto";

export const getEmulatorOverview = () => invoke<EmulatorOverview>("get_emulator_overview");
export const setEmulatorSettings = (settings: EmulatorSettings) => invoke<EmulatorOverview>("set_emulator_settings", { settings });

/** Adds a folder (already-listed paths are ignored). New folders start on "auto by extension". */
export const addRomFolder = (settings: EmulatorSettings, path: string): EmulatorSettings =>
  settings.folders.some((folder) => folder.path === path) ? settings : { ...settings, folders: [...settings.folders, { path, system: AUTO_SYSTEM }] };

export const removeRomFolder = (settings: EmulatorSettings, path: string): EmulatorSettings =>
  ({ ...settings, folders: settings.folders.filter((folder) => folder.path !== path) });

export const setFolderSystem = (settings: EmulatorSettings, path: string, system: string): EmulatorSettings =>
  ({ ...settings, folders: settings.folders.map((folder) => folder.path === path ? { ...folder, system } : folder) });

/** Changes one field of a system's choice; the other fields are kept. Choosing another emulator forgets the core. */
export function setSystemChoice(settings: EmulatorSettings, system: string, patch: Partial<SystemChoice>): EmulatorSettings {
  const current = settings.systems[system] ?? {};
  const next = { ...current, ...patch, ...("emulator" in patch && patch.emulator !== current.emulator && !("core" in patch) ? { core: "" } : {}) };
  return { ...settings, systems: { ...settings.systems, [system]: next } };
}
