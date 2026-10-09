import { useSyncExternalStore } from "react";
import { readJson, writeJson } from "../lib/storage";

export type TileShape = "portrait" | "landscape" | "square";
export type TileSize = "small" | "medium" | "large";
export type TileTitles = "always" | "focus" | "never";
export type ShelfLayout = "rows" | "grid";

/** How Big Picture shows games; kept per device. */
export type DisplaySettings = { shape: TileShape; size: TileSize; titles: TileTitles; layout: ShelfLayout };

export const displayStorageKey = "mochi:bigpicture-display";
export const defaultDisplay: DisplaySettings = { shape: "portrait", size: "medium", titles: "always", layout: "rows" };

export const DISPLAY_OPTIONS = {
  shape: [{ value: "portrait", label: "Portrait" }, { value: "landscape", label: "Landscape" }, { value: "square", label: "Square" }],
  size: [{ value: "small", label: "Small" }, { value: "medium", label: "Medium" }, { value: "large", label: "Large" }],
  titles: [{ value: "always", label: "Always" }, { value: "focus", label: "On focus" }, { value: "never", label: "Never" }],
  layout: [{ value: "rows", label: "Shelves" }, { value: "grid", label: "Grid" }],
} as const satisfies { [K in keyof DisplaySettings]: ReadonlyArray<{ value: DisplaySettings[K]; label: string }> };

export function normalizeDisplay(raw: unknown): DisplaySettings {
  const stored = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const pick = <K extends keyof DisplaySettings>(key: K): DisplaySettings[K] => {
    const allowed = DISPLAY_OPTIONS[key].map((option) => option.value) as readonly string[];
    return (allowed.includes(stored[key] as string) ? stored[key] : defaultDisplay[key]) as DisplaySettings[K];
  };
  return { shape: pick("shape"), size: pick("size"), titles: pick("titles"), layout: pick("layout") };
}

let current = normalizeDisplay(readJson<unknown>(displayStorageKey, {}));
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const get = () => current;

export function updateDisplay(patch: Partial<DisplaySettings>) {
  current = normalizeDisplay({ ...current, ...patch });
  writeJson(displayStorageKey, current);
  listeners.forEach((listener) => listener());
}

export const useDisplaySettings = (): [DisplaySettings, (patch: Partial<DisplaySettings>) => void] => [useSyncExternalStore(subscribe, get, get), updateDisplay];
