import { invoke } from "@tauri-apps/api/core";
import type { ImportSourceId } from "../models";
import { noteSourceHealth } from "./sourceHealth";

export type { ImportSourceId };

export type SourceHealthStatus = "ok" | "not_installed" | "empty" | "partial" | "parse_error";
export type SourceHealth = {
  id: ImportSourceId;
  name: string;
  status: SourceHealthStatus;
  filesExamined: number;
  /** Files that exist but could not be read or parsed, with a short reason (home folder shown as `~`). */
  failures: Array<{ path: string; reason: string }>;
  gameCount: number;
};

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
  health?: SourceHealth;
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
  /** Minecraft instances (Prism, MultiMC, PolyMC, Fjord): version, loader and game folder for the default Tofu. */
  /** "soundtrack" / "extra" when the entry is not a game (guessed from its name). */
  contentType?: "soundtrack" | "extra" | null;
  minecraft?: MinecraftScan | null;
};

/** Pack facts the launcher left in an instance: `pack` is its own record (Prism `ManagedPack*`), `index` the name/version of a pack manifest. */
export type MinecraftPackHint = {
  pack?: { source: "modrinth" | "curseforge"; projectId: string; versionId?: string | null; name?: string | null; versionName?: string | null } | null;
  index?: { source: "modrinth" | "curseforge"; name: string; version?: string | null } | null;
};
export type MinecraftScan = { version?: string | null; loader: string; gameDir: string; /** A Mochi copy of this instance already exists next to it. */ copyExists?: boolean } & MinecraftPackHint;

export const detectImportSources = () => invoke<DetectedImportSource[]>("detect_import_sources").then((sources) => { noteSourceHealth(sources); return sources; });

/** Re-scans every source and reports how readable each one's files were. */
export const scannerHealth = () => invoke<SourceHealth[]>("scanner_health").then((report) => { noteSourceHealth(report.map((health) => ({ health }))); return report; });

export const scanImportGames = (source: ImportSourceId, libraryPath?: string) =>
  invoke<ImportedGame[]>("scan_import_games", { source, libraryPath: libraryPath ?? null });
