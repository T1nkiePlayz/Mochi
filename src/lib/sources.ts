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
export type MinecraftScan = { version?: string | null; loader: string; gameDir: string } & MinecraftPackHint;

export const detectImportSources = () => invoke<DetectedImportSource[]>("detect_import_sources");

export const scanImportGames = (source: ImportSourceId, libraryPath?: string) =>
  invoke<ImportedGame[]>("scan_import_games", { source, libraryPath: libraryPath ?? null });
