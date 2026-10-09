import { invoke } from "@tauri-apps/api/core";

export type SystemStatus = { hasBattery: boolean; batteryPercent: number | null; charging: boolean | null };
export type PowerAction = "suspend" | "restart" | "shutdown";
export type PowerCapabilities = Record<PowerAction, boolean>;

export const getSystemStatus = () => invoke<SystemStatus>("get_system_status");
export const getPowerCapabilities = () => invoke<PowerCapabilities>("get_power_capabilities");
export const powerAction = (action: PowerAction) => invoke<void>("power_action", { action });

async function currentWindow() { return (await import("@tauri-apps/api/window")).getCurrentWindow(); }
export async function minimizeWindow() { await (await currentWindow()).minimize(); }
export async function toggleFullscreen() {
  const window = await currentWindow();
  await window.setFullscreen(!(await window.isFullscreen()));
}
