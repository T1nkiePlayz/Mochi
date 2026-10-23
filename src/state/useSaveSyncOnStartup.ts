import { useEffect, useRef } from "react";
import type { Piko } from "../models";
import { getSaveSyncStatus, syncGames, syncSavesNow } from "../lib/saveSync";

const START_DELAY_MS = 20_000;

/** One debounced sync shortly after start (only when save sync is on): exports missing snapshots, imports new ones. Never restores anything. */
export function useSaveSyncOnStartup(ready: boolean, library: Piko[]) {
  const libraryRef = useRef(library);
  libraryRef.current = library;
  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => {
      void getSaveSyncStatus().then((status) => status.enabled ? syncSavesNow(syncGames(libraryRef.current), false) : undefined).catch(() => { /* development mode, or the folder is offline: the status line shows it */ });
    }, START_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [ready]);
}
