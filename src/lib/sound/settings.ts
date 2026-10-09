import { useSyncExternalStore } from "react";
import { readJson, writeJson } from "../storage";

export const soundStorageKey = "mochi:sound";

/** "auto" = movement sounds are off while reduced motion is on (system or Mochi's accessibility setting). */
export type MovementSounds = "always" | "auto" | "never";

export type SoundSettings = {
  /** Sounds in Big Picture. */
  bigPicture: boolean;
  /** Sounds in the regular launcher window. */
  launcher: boolean;
  /** 0 - 1. */
  volume: number;
  muted: boolean;
  movement: MovementSounds;
  /** A built-in or installed pack id, or "theme" to use the active theme's pack. */
  pack: string;
};

export const defaultSoundSettings: SoundSettings = { bigPicture: true, launcher: false, volume: 0.6, muted: false, movement: "auto", pack: "theme" };

const packPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function normalizeSoundSettings(raw: unknown): SoundSettings {
  const stored = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const bool = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);
  const volume = typeof stored.volume === "number" && Number.isFinite(stored.volume) ? Math.min(1, Math.max(0, stored.volume)) : defaultSoundSettings.volume;
  return {
    bigPicture: bool(stored.bigPicture, defaultSoundSettings.bigPicture),
    launcher: bool(stored.launcher, defaultSoundSettings.launcher),
    volume: Math.round(volume * 100) / 100,
    muted: bool(stored.muted, false),
    movement: stored.movement === "always" || stored.movement === "never" ? stored.movement : "auto",
    pack: typeof stored.pack === "string" && packPattern.test(stored.pack) ? stored.pack : "theme",
  };
}

let current = normalizeSoundSettings(readJson<unknown>(soundStorageKey, {}));
const listeners = new Set<() => void>();

export const getSoundSettings = () => current;

export function updateSoundSettings(patch: Partial<SoundSettings>): void {
  current = normalizeSoundSettings({ ...current, ...patch });
  writeJson(soundStorageKey, current);
  listeners.forEach((listener) => listener());
}

export const subscribeSoundSettings = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function useSoundSettings(): [SoundSettings, (patch: Partial<SoundSettings>) => void] {
  return [useSyncExternalStore(subscribeSoundSettings, getSoundSettings, getSoundSettings), updateSoundSettings];
}

export function prefersReducedMotion(): boolean {
  try {
    return document.documentElement.getAttribute("data-reduce-motion") === "true" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  } catch { return false; }
}
