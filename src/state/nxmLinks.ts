import { useSyncExternalStore } from "react";

/**
 * nxm:// links waiting for the user (the prompt asks which Tofu), and which Tofu the user was working in when they went to
 * Nexus Mods for a file, so the prompt can preselect it. In memory only.
 */
let queue: readonly string[] = [];
const intents = new Map<string, { pikoId: string; tofuId: string; at: number }>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

export function queueNxmLink(url: string) {
  if (queue.includes(url) || queue.length >= 20) return;
  queue = [...queue, url];
  emit();
}
export function dismissNxmLink(url: string) { queue = queue.filter((item) => item !== url); emit(); }

/** Remembered when the user opens a Nexus files page from a Tofu (free accounts download through "Mod Manager Download"). */
export function rememberNxmIntent(gameDomain: string, modId: number | string, pikoId: string, tofuId: string) {
  intents.set(`${gameDomain}:${modId}`, { pikoId, tofuId, at: Date.now() });
  if (intents.size > 50) intents.delete(intents.keys().next().value as string);
}
export const nxmIntent = (gameDomain: string, modId: number) => intents.get(`${gameDomain}:${modId}`) ?? [...intents.entries()].find(([key]) => key.startsWith(`${gameDomain}:`))?.[1];

export function useNxmQueue(): readonly string[] {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => queue, () => queue);
}
