import { readJson, writeJson } from "../storage";
import type { ProviderId, ProviderResult } from "./types";

const TTL_MS = 7 * 24 * 60 * 60 * 1000;
type Entry = { at: number; result: ProviderResult };

const storageKey = (provider: ProviderId, userId?: string) => `mochi:meta-cache:${provider}:${userId || "local"}`;

/** Per-provider lookup cache in local storage; misses are cached too so unmatched games are not re-queried every run. */
export class ProviderCache {
  private entries: Record<string, Entry>;
  private dirty = false;
  constructor(private provider: ProviderId, private userId?: string) {
    this.entries = readJson<Record<string, Entry>>(storageKey(provider, userId), {});
  }
  get(key: string, now = Date.now()): ProviderResult | undefined {
    const entry = this.entries[key];
    return entry && now - entry.at < TTL_MS ? entry.result : undefined;
  }
  set(key: string, result: ProviderResult, now = Date.now()) { this.entries[key] = { at: now, result }; this.dirty = true; }
  delete(key: string) { if (key in this.entries) { delete this.entries[key]; this.dirty = true; } }
  flush() {
    if (!this.dirty) return;
    const now = Date.now();
    for (const [key, entry] of Object.entries(this.entries)) if (now - entry.at >= TTL_MS) delete this.entries[key];
    writeJson(storageKey(this.provider, this.userId), this.entries);
    this.dirty = false;
  }
}

export function clearProviderCaches(userId?: string) {
  for (const provider of ["igdb", "steamgriddb", "steam"] as const) {
    try { window.localStorage.removeItem(storageKey(provider, userId)); } catch { /* storage unavailable */ }
  }
}
