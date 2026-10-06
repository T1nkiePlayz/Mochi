import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export type PlatformId = "linux" | "macos" | "other";
export type LaunchMethodId = "file" | "flatpak" | "custom";

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
};

export async function getPlatformCapabilities(): Promise<PlatformCapabilities> {
  return invoke<PlatformCapabilities>("get_platform_capabilities");
}

export async function launchGame(launchTarget: string): Promise<void> {
  await invoke("launch_game", { launchTarget });
}

export async function listInstalledFlatpaks(): Promise<FlatpakApp[]> {
  return invoke<FlatpakApp[]>("list_flatpaks");
}

export async function chooseGameTarget(): Promise<string | null> {
  const selected = await open({
    multiple: false,
    directory: false,
    title: "Choose game executable or launcher",
  });
  return typeof selected === "string" ? selected : null;
}

export function normalizeLaunchTarget(target: string, method: LaunchMethodId): string {
  const trimmed = target.trim();
  if (method !== "flatpak") return trimmed;

  const appId = trimmed
    .replace(/^flatpak:\/\//i, "")
    .replace(/^flatpak\s+run\s+/i, "")
    .trim();

  return appId ? `flatpak://${appId}` : "";
}
