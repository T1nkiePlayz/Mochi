import { invoke } from "@tauri-apps/api/core";

export type ImportSourceId = "flatpak" | "heroic" | "steam" | "lutris" | "bottles" | "itch";

export type DetectedImportSource = {
  id: ImportSourceId;
  name: string;
  description: string;
  detected: boolean;
  gameCount: number | null;
};

export async function detectImportSources(): Promise<DetectedImportSource[]> {
  return invoke<DetectedImportSource[]>("detect_import_sources");
}

export async function refreshImportSources(): Promise<DetectedImportSource[]> {
  return detectImportSources();
}

export type ImportedGame={id:string;name:string;source:ImportSourceId;launchTarget:string;installPath?:string|null};
export async function scanImportGames(source:ImportSourceId):Promise<ImportedGame[]>{return invoke<ImportedGame[]>("scan_import_games",{source})}
