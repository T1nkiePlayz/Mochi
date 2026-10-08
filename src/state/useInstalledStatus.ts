import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Piko } from "../models";

const TTL_MS = 60_000;
/** Results are cached per launch target so scrolling/filtering never re-hits the disk. */
const cache = new Map<string, { exists: boolean; at: number }>();

/** Which launch targets still exist (files, `.app` bundles). Unknown targets are treated as present. */
export function useInstalledStatus(library: Piko[]): Map<string, boolean> {
  const [installed, setInstalled] = useState<Map<string, boolean>>(() => new Map());
  const targets = library.map((piko) => piko.executablePath ?? "").filter(Boolean);
  const signature = targets.join("\n");

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const now = Date.now();
      const unique = [...new Set(signature ? signature.split("\n") : [])];
      const stale = unique.filter((target) => { const hit = cache.get(target); return !hit || now - hit.at > TTL_MS; });
      if (stale.length) {
        try {
          const results = await invoke<boolean[]>("check_launch_targets", { targets: stale });
          stale.forEach((target, index) => cache.set(target, { exists: results[index] !== false, at: Date.now() }));
        } catch { /* browser/dev mode or old backend: assume everything is present */ }
      }
      if (!cancelled) setInstalled(new Map(unique.map((target) => [target, cache.get(target)?.exists ?? true])));
    };
    void check();
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    return () => { cancelled = true; window.removeEventListener("focus", onFocus); };
  }, [signature]);

  return installed;
}
