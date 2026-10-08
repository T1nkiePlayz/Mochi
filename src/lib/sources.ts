import { invoke } from "@tauri-apps/api/core";
import type { ImportSourceId } from "../models";

export type { ImportSourceId };

export type DetectedImportSource = {
  id: ImportSourceId;
  name: string;
  description: string;
  detected: boolean;
  gameCount: number | null;
};

export type ImportedGame = { id: string; name: string; source: ImportSourceId; launchTarget: string; installPath?: string | null };

export const detectImportSources = () => invoke<DetectedImportSource[]>("detect_import_sources");

export const scanImportGames = (source: ImportSourceId, libraryPath?: string) =>
  invoke<ImportedGame[]>("scan_import_games", { source, libraryPath: libraryPath ?? null });
