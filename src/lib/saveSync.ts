import { invoke } from "@tauri-apps/api/core";
import type { Piko } from "../models";
import { hasSaveSources, saveHints, type SaveHints } from "./saveBackups";

export type SyncStatus = { enabled: boolean; folder: string; deviceName: string; lastSyncAt: number | null; imported: number; exported: number; pending: number; errors: string[]; available: boolean };
export type SyncGame = { pikoId: string; hints: SaveHints };

export const getSaveSyncStatus = () => invoke<SyncStatus>("get_save_sync_status");
export const setSaveSyncFolder = (folder: string, enabled: boolean) => invoke<SyncStatus>("set_save_sync_folder", { folder, enabled });
export const syncSavesNow = (games: SyncGame[], force: boolean) => invoke<SyncStatus>("sync_saves_now", { games, force });
export const removeSaveSyncData = () => invoke<number>("remove_save_sync_data");

/** The games that can have saves, with what the native side needs to find them. */
export const syncGames = (library: Piko[]): SyncGame[] => library.map((piko) => ({ pikoId: piko.id, hints: saveHints(piko) })).filter((game) => hasSaveSources(game.hints));
