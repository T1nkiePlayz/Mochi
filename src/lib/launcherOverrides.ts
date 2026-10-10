import { useSyncExternalStore } from "react";
import type { Piko } from "../models";
import { launcherArt } from "./launcherArt";
import { launcherForPiko } from "./launchers";
import { platformLabel } from "./importMapping";
import { readJson, storageKeys, writeJson } from "./storage";
import type { ImportedGame } from "./sources";

/** The user's correction of a wrong game/launcher detection. */
export type KindOverride = "game" | "launcher";
export type KindOverrides = Record<string, KindOverride>;

/** Keeps only valid entries of whatever was stored. */
export function sanitizeOverrides(value: unknown): KindOverrides {
  const out: KindOverrides = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [key, kind] of Object.entries(value)) if (key && (kind === "game" || kind === "launcher")) out[key] = kind;
  return out;
}

let cache: KindOverrides | null = null;
const listeners = new Set<() => void>();

/** The stored overrides (cached; the same object until something changes). */
export function readOverrides(): KindOverrides {
  if (!cache) cache = sanitizeOverrides(readJson<unknown>(storageKeys.launcherOverrides, {}));
  return cache;
}

/** Sets (or, with null, clears) the override for one key and notifies subscribers. */
export function setOverride(key: string, kind: KindOverride | null): void {
  if (!key) return;
  const next = { ...readOverrides() };
  if (kind) next[key] = kind; else delete next[key];
  cache = next;
  writeJson(storageKeys.launcherOverrides, next);
  listeners.forEach((listener) => listener());
}

/** Replaces every override (settings import) and notifies subscribers. */
export function replaceOverrides(next: KindOverrides): void {
  cache = sanitizeOverrides(next);
  writeJson(storageKeys.launcherOverrides, cache);
  listeners.forEach((listener) => listener());
}

export function subscribeOverrides(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** React hook: the current overrides, re-rendering when they change. */
export const useLauncherOverrides = (): KindOverrides => useSyncExternalStore(subscribeOverrides, readOverrides, readOverrides);

/** Test helper: forget the cached value so the next read goes to storage. */
export function resetOverridesCache(): void { cache = null; }

export const overrideKeyForImport = (item: Pick<ImportedGame, "id">): string => item.id;

/** The key of the import item a library entry came from: its stored import id, else source + launch target. */
export const overrideKeyForPiko = (piko: Pick<Piko, "importKey" | "sourceId" | "executablePath">): string =>
  piko.importKey || `${piko.sourceId ?? ""}:${piko.executablePath ?? ""}`;

/** Applies the override (if any) to a scanned item. Returns the same object when nothing changes. */
export function applyKindOverride(item: ImportedGame, overrides: KindOverrides): ImportedGame {
  const kind = overrides[overrideKeyForImport(item)];
  if (!kind || (item.kind ?? "game") === kind) return item;
  return kind === "launcher" ? { ...item, kind } : { ...item, kind, launcherId: null };
}

export const applyKindOverrides = (items: ImportedGame[], overrides: KindOverrides): ImportedGame[] => items.map((item) => applyKindOverride(item, overrides));

/** Applies the override (if any) to a library entry. Returns the same object when nothing changes. */
export function applyPikoKindOverride(piko: Piko, overrides: KindOverrides): Piko {
  const kind = overrides[overrideKeyForPiko(piko)];
  if (!kind) return piko;
  const categories = (piko.categories ?? []).filter((category) => category !== "Launcher");
  if (kind === "launcher") {
    if (piko.kind === "launcher" && piko.platformCategory === "Launchers" && (piko.categories ?? []).includes("Launcher")) return piko;
    const launcherId = piko.launcherId ?? launcherForPiko(piko)?.id;
    return {
      ...piko, kind, ...(launcherId ? { launcherId } : {}), trailerId: undefined, platformCategory: "Launchers",
      categories: categories.length ? [...categories, "Launcher"] : ["Launcher"],
      ...(!piko.artwork && !piko.artworkSource && !piko.artworkUrl ? { artwork: launcherArt(launcherId) } : {}),
    };
  }
  const bundledArt = piko.launcherId ? launcherArt(piko.launcherId) : "";
  if (piko.kind === "game" && !piko.launcherId && !(piko.categories ?? []).includes("Launcher") && piko.platformCategory !== "Launchers") return piko;
  const { launcherId: _launcherId, ...rest } = piko;
  void _launcherId;
  return {
    ...rest, kind,
    platformCategory: piko.platformCategory === "Launchers" || piko.kind === "launcher" ? (piko.sourceId ? platformLabel(piko.sourceId) : undefined) : piko.platformCategory,
    categories,
    ...(bundledArt && piko.artwork === bundledArt ? { artwork: "" } : {}),
  };
}
