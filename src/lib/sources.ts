import { invoke } from "@tauri-apps/api/core";
import type { ImportSourceId } from "../models";

export type { ImportSourceId };

export type DetectedImportSource = {
  id: ImportSourceId;
  name: string;
  description: string;
  /** At least one importable item was found. */
  detected: boolean;
  /** The launcher is installed even if it has nothing to import. */
  installed?: boolean;
  gameCount: number | null;
  launcherCount?: number | null;
};

export type ImportedGame = {
  id: string;
  name: string;
  source: ImportSourceId;
  launchTarget: string;
  installPath?: string | null;
  kind?: "game" | "launcher";
  /** Which known launcher a launcher entry is, for its artwork. */
  launcherId?: string | null;
  /** The entry's own icon file (desktop entry `Icon=`, app bundle `.icns`), drawn as a fallback cover. */
  iconPath?: string | null;
};

export const detectImportSources = () => invoke<DetectedImportSource[]>("detect_import_sources");

export const scanImportGames = (source: ImportSourceId, libraryPath?: string) =>
  invoke<ImportedGame[]>("scan_import_games", { source, libraryPath: libraryPath ?? null });
