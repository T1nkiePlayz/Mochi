import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { Piko, Tofu } from "../models";
import { modSyncFor } from "./mods/targets";
import { buildLaunchConfig } from "./launch";

export type PlatformId = "linux" | "macos";
export type LaunchMethodId = "file" | "app" | "flatpak" | "custom";

export type FlatpakApp = {
  id: string;
  name: string;
  category: "Games" | "Other";
};

export type PlatformCapabilities = {
  platform: PlatformId;
  displayName: string;
  launchMethods: LaunchMethodId[];
  supportsFlatpak: boolean;
  supportsAppBundles: boolean;
  supportsStartup: boolean;
  supportsSystemNotifications: boolean;
  supportsShortcuts: boolean;
  /** Running on a Steam Deck. */
  isSteamDeck: boolean;
  /** Running inside a gamescope (Steam Gaming Mode) session. */
  isGamescope: boolean;
};

export type RuntimeInfo = {
  id: string;
  name: string;
  kind: "compat" | "wrapper";
  path: string;
};

export type ActiveSession = { gameId: string; startedAt: number; canStop: boolean };
export type PlaytimeEntry = { gameId: string; name: string; seconds: number; lastPlayed: number };

export const getPlatformCapabilities = () => invoke<PlatformCapabilities>("get_platform_capabilities");
export const listInstalledFlatpaks = () => invoke<FlatpakApp[]>("list_flatpaks");
export const listRuntimes = () => invoke<RuntimeInfo[]>("list_runtimes");
export const getPlaytime = () => invoke<PlaytimeEntry[]>("get_playtime");
export const getActiveSessions = () => invoke<ActiveSession[]>("get_active_sessions");
export const stopGame = (gameId: string) => invoke<void>("stop_game", { gameId });
export const openPath = (path: string) => invoke<void>("open_path_in_file_manager", { path });
export const openExternalUrl = (url: string) => invoke<void>("open_external_url", { url });
export const createGameShortcut = (gameId: string, name: string) => invoke<string>("create_game_shortcut", { gameId, name });
export const removeGameShortcut = (gameId: string) => invoke<void>("remove_game_shortcut", { gameId });

export function launchGame(piko: Piko, tofu: Tofu | undefined): Promise<void> {
  if (!piko.executablePath) return Promise.reject(new Error("This game does not have a launch target. Edit the game to set one."));
  return invoke("launch_game_tracked", {
    request: {
      gameId: piko.id,
      name: piko.name,
      launchTarget: piko.executablePath,
      installPath: piko.installPath ?? null,
      tofuId: tofu?.id ?? null,
      config: buildLaunchConfig(tofu?.launch),
      // Only a Tofu that keeps its own mods needs them copied into the game's folder; the native side does it right before starting.
      modSync: modSyncFor(tofu) ?? null,
    },
  });
}

export async function chooseGameLibraryPath(): Promise<string | null> {
  const selected = await open({ multiple: false, directory: true, title: "Choose game library" });
  return typeof selected === "string" ? selected : null;
}

export async function chooseGameTarget(): Promise<string | null> {
  const selected = await open({ multiple: false, directory: false, title: "Choose game executable or launcher" });
  return typeof selected === "string" ? selected : null;
}

export async function chooseGameAppBundle(): Promise<string | null> {
  const selected = await open({ multiple: false, directory: true, title: "Choose macOS application" });
  return typeof selected === "string" ? selected : null;
}

export function normalizeLaunchTarget(target: string, method: LaunchMethodId): string {
  const trimmed = target.trim();
  if (method !== "flatpak") return trimmed;
  const appId = trimmed.replace(/^flatpak:\/\//i, "").replace(/^flatpak\s+run\s+/i, "").trim();
  return appId ? `flatpak://${appId}` : "";
}
