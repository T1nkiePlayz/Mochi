import { invoke } from "@tauri-apps/api/core";

export type SystemStatus = { hasBattery: boolean; batteryPercent: number | null; charging: boolean | null };

export const getSystemStatus = () => invoke<SystemStatus>("get_system_status");
export const suspendSystem = () => invoke<void>("suspend_system");
