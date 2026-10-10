/** Connects the settings export/import logic to the app: reads the current state, talks to the native zip commands, commits an import. */
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import type { Collection, Piko } from "../models";
import type { Behavior } from "../state/settings";
import type { Accessibility } from "../state/accessibility";
import { getSoundSettings, updateSoundSettings } from "./sound/settings";
import { getControllerSettings, updateControllerSettings } from "../controller/settings";
import { readWishlist, replaceWishlist } from "./wishlist";
import { readOverrides, replaceOverrides } from "./launcherOverrides";
import { readViewMode, writeViewMode } from "./libraryView";
import { buildExportSections, checkManifest, sanitizeAppearance, SECTION_IDS, type LibrarySortChoice, type ImportResult, type SectionId, type Snapshot } from "./settingsExport";

export type ThemeEntry = { id: string; name: string; version: string; standalone: boolean };
export type SettingsFile = { path: string; manifest: { createdAt?: string; appVersion?: string; version: number }; sections: Record<string, unknown>; themes: ThemeEntry[] };
export type ThemeInstallResult = { installed: string[]; skipped: string[] };

export type SnapshotSources = { behavior: Behavior; accessibility: Accessibility; collections: Collection[]; library: Piko[]; theme: string; librarySort: string };

/** The current state as the export/import logic sees it. */
export function readSnapshot(source: SnapshotSources): Snapshot {
  return {
    behavior: source.behavior,
    appearance: sanitizeAppearance({ theme: source.theme, libraryView: readViewMode(), librarySort: source.librarySort }),
    sound: getSoundSettings(),
    controller: getControllerSettings(),
    accessibility: source.accessibility,
    collections: source.collections,
    wishlist: readWishlist(),
    launcherOverrides: readOverrides(),
    library: source.library,
  };
}

const zipFilter = [{ name: "Mochi settings", extensions: ["zip"] }];
const stamp = () => new Date().toISOString().slice(0, 10);

/** Asks where to save, then writes the zip. Resolves to false when the dialog was cancelled. */
export async function exportSettings(snapshot: Snapshot, includeThemes: boolean, sections: readonly SectionId[] = SECTION_IDS): Promise<boolean> {
  const path = await save({ title: "Export Mochi settings", defaultPath: `mochi-settings-${stamp()}.zip`, filters: zipFilter });
  if (!path) return false;
  const target = /\.zip$/i.test(path) ? path : `${path}.zip`;
  await invoke<void>("export_settings_zip", { path: target, sectionsJson: JSON.stringify(buildExportSections(snapshot, sections)), includeThemes });
  return true;
}

/** Asks for a settings zip and reads it (never applies anything). Resolves to null when cancelled. Throws a readable message for an invalid file. */
export async function pickSettingsFile(): Promise<SettingsFile | null> {
  const selected = await open({ title: "Import Mochi settings", multiple: false, directory: false, filters: zipFilter });
  if (typeof selected !== "string") return null;
  const file = await invoke<Omit<SettingsFile, "path">>("read_settings_zip", { path: selected });
  const check = checkManifest(file.manifest);
  if (!check.ok) throw new Error(check.error);
  return { ...file, path: selected };
}

export const installThemesFromFile = (path: string, themeIds: string[]) => invoke<ThemeInstallResult>("install_themes_from_settings_zip", { path, themeIds });

export type CommitTargets = {
  setBehavior: (behavior: Behavior) => void;
  updateAccessibility: (changes: Partial<Accessibility>) => void;
  replaceCollections: (items: Collection[]) => void;
  setLibrary: (library: Piko[]) => void;
  setLibrarySort: (sort: LibrarySortChoice) => void;
  currentTheme: string;
  selectTheme: (id: string) => Promise<void> | void;
  knownThemeIds: readonly string[];
};

/** Writes the result of `planImport` into the live state; every hook or store re-reads, so no restart is needed. */
export async function commitImport(result: ImportResult, targets: CommitTargets): Promise<void> {
  const { next, changed } = result;
  if (changed.includes("behavior")) targets.setBehavior(next.behavior);
  if (changed.includes("sound")) updateSoundSettings(next.sound);
  if (changed.includes("controller")) updateControllerSettings(next.controller);
  if (changed.includes("accessibility")) targets.updateAccessibility(next.accessibility);
  if (changed.includes("collections")) targets.replaceCollections(next.collections);
  if (changed.includes("wishlist")) replaceWishlist(next.wishlist);
  if (changed.includes("launcherOverrides")) replaceOverrides(next.launcherOverrides);
  if (changed.includes("games")) targets.setLibrary(next.library);
  if (changed.includes("appearance")) {
    writeViewMode(next.appearance.libraryView);
    targets.setLibrarySort(next.appearance.librarySort);
    if (next.appearance.theme && targets.knownThemeIds.includes(next.appearance.theme) && next.appearance.theme !== targets.currentTheme) await targets.selectTheme(next.appearance.theme);
  }
}
