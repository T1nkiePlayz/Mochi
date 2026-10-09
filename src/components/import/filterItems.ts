import type { ImportedGame } from "../../lib/sources";

export type PickerFilter = "all" | "launchers";

/** Keeps only the items the picker should show: everything, or just game launchers. */
export const filterItems = (items: ImportedGame[], filter: PickerFilter = "all"): ImportedGame[] => (filter === "launchers" ? items.filter((item) => item.kind === "launcher") : items);
