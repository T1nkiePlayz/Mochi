import { useSyncExternalStore } from "react";
import { readJson, writeJson } from "../lib/storage";
import type { PromptStyle, RepeatSpeed } from "./types";

export const controllerStorageKey = "mochi:controller";

export type ControllerSettings = {
  /** `null` means automatic: turns on the first time a controller is used. */
  enabled: boolean | null;
  swapConfirmBack: boolean;
  /** Stick dead zone, 0.1 to 0.8. */
  deadZone: number;
  repeatSpeed: RepeatSpeed;
  promptStyle: PromptStyle;
  /** Open the built-in keyboard when a text field is confirmed with a controller. */
  onScreenKeyboard: boolean;
  /** Short synthesized sounds in Big Picture. */
  uiSounds: boolean;
};

export const defaultControllerSettings: ControllerSettings = {
  enabled: null,
  swapConfirmBack: false,
  deadZone: 0.35,
  repeatSpeed: "normal",
  promptStyle: "auto",
  onScreenKeyboard: true,
  uiSounds: false,
};

const styles: PromptStyle[] = ["auto", "xbox", "playstation", "switch", "deck", "keyboard"];

export function normalizeControllerSettings(raw: unknown): ControllerSettings {
  const stored = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const bool = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);
  const dz = typeof stored.deadZone === "number" && Number.isFinite(stored.deadZone) ? stored.deadZone : defaultControllerSettings.deadZone;
  return {
    enabled: typeof stored.enabled === "boolean" ? stored.enabled : null,
    swapConfirmBack: bool(stored.swapConfirmBack, false),
    deadZone: Math.min(0.8, Math.max(0.1, dz)),
    repeatSpeed: stored.repeatSpeed === "slow" || stored.repeatSpeed === "fast" ? stored.repeatSpeed : "normal",
    promptStyle: styles.includes(stored.promptStyle as PromptStyle) ? (stored.promptStyle as PromptStyle) : "auto",
    onScreenKeyboard: bool(stored.onScreenKeyboard, true),
    uiSounds: bool(stored.uiSounds, false),
  };
}

let current = normalizeControllerSettings(readJson<unknown>(controllerStorageKey, {}));
const listeners = new Set<() => void>();

export const getControllerSettings = () => current;

export function updateControllerSettings(patch: Partial<ControllerSettings>): void {
  current = normalizeControllerSettings({ ...current, ...patch });
  writeJson(controllerStorageKey, current);
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function useControllerSettings(): [ControllerSettings, (patch: Partial<ControllerSettings>) => void] {
  return [useSyncExternalStore(subscribe, getControllerSettings, getControllerSettings), updateControllerSettings];
}
