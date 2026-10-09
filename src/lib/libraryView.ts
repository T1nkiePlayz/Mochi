import { readJson, writeJson } from "./storage";

/** How the library lays out its games. The top-bar switcher cycles through these in order. */
export const viewModes = [
  { id: "grid", label: "Grid", hint: "Covers in a grid" },
  { id: "compact", label: "Compact grid", hint: "Smaller covers, more games on screen" },
  { id: "list", label: "List", hint: "One game per row" },
  { id: "shelves", label: "Shelves", hint: "One scrolling shelf per category" },
  { id: "large", label: "Large cards", hint: "Big covers" },
] as const;

export type LibraryViewMode = (typeof viewModes)[number]["id"];
export const defaultViewMode: LibraryViewMode = "grid";
export const viewModeKey = "mochi:library-view";

export const isViewMode = (value: unknown): value is LibraryViewMode => viewModes.some((mode) => mode.id === value);

/** Anything read from storage becomes a valid mode. */
export const normalizeViewMode = (value: unknown): LibraryViewMode => (isViewMode(value) ? value : defaultViewMode);

/** The mode after `current`, wrapping around (negative `step` goes backwards). */
export function cycleViewMode(current: LibraryViewMode, step = 1): LibraryViewMode {
  const index = viewModes.findIndex((mode) => mode.id === current);
  return viewModes[(index + step + viewModes.length * 2) % viewModes.length].id;
}

export const viewModeLabel = (mode: LibraryViewMode) => viewModes.find((entry) => entry.id === mode)?.label ?? "Grid";

export const readViewMode = (): LibraryViewMode => normalizeViewMode(readJson<unknown>(viewModeKey, null));
export const writeViewMode = (mode: LibraryViewMode) => { writeJson(viewModeKey, mode); };
