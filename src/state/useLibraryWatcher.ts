import { useEffect, useRef } from "react";
import type { Piko } from "../models";
import { describeWatch, diffLibrary, unseen } from "../lib/libraryWatch";
import { detectImportSources, scanImportGames, type ImportedGame } from "../lib/sources";
import { readJson, writeJson } from "../lib/storage";

const KNOWN_KEY = "mochi:watch-known";
const EVERY_MS = 10 * 60 * 1000;
const FIRST_MS = 45 * 1000;

const readKnown = (): Set<string> | null => { const raw = readJson<unknown>(KNOWN_KEY, null); return Array.isArray(raw) ? new Set(raw.filter((item): item is string => typeof item === "string")) : null; };

/** Re-scans the import sources in the background (off with Settings > Screenshots & library) and notes new or vanished games. */
export function useLibraryWatcher(enabled: boolean, ready: boolean, library: Piko[], notify: (title: string, message: string) => void) {
  const latest = useRef({ library, notify });
  latest.current = { library, notify };

  useEffect(() => {
    if (!enabled || !ready) return;
    let cancelled = false, running = false;
    const check = async () => {
      if (running || document.visibilityState === "hidden") return;
      running = true;
      try {
        const detected = (await detectImportSources()).filter((source) => source.detected);
        const scans = new Map<string, ImportedGame[]>();
        for (const source of detected) { if (cancelled) return; scans.set(source.id, await scanImportGames(source.id).catch(() => [])); }
        const { added, missing } = diffLibrary(latest.current.library, scans);
        const known = readKnown();
        const keys = [...added.map((game) => `new:${game.source}:${game.id}`), ...missing.map((piko) => `gone:${piko.id}`)];
        const fresh = unseen(keys, known);
        writeJson(KNOWN_KEY, [...new Set([...(known ?? []), ...keys])].slice(-2000));
        const summary = describeWatch(fresh.filter((key) => key.startsWith("new:")).length, fresh.filter((key) => key.startsWith("gone:")).length);
        if (summary && !cancelled) latest.current.notify(summary.title, summary.message);
      } catch { /* browser/development mode, or a scan failed: try again next time */ }
      finally { running = false; }
    };
    const first = window.setTimeout(() => void check(), FIRST_MS);
    const timer = window.setInterval(() => void check(), EVERY_MS);
    return () => { cancelled = true; window.clearTimeout(first); window.clearInterval(timer); };
  }, [enabled, ready]);
}
