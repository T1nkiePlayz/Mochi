import { useCallback, useEffect, useRef, useState } from "react";
import { getPlaytime, type PlaytimeEntry } from "../lib/platform";

/** Playtime totals from the native tracker; refreshes every 15s while a game is running. */
export function usePlaytime(runningCount: number) {
  const [playtime, setPlaytime] = useState<PlaytimeEntry[]>([]);
  const seq = useRef(0);
  const refresh = useCallback(async () => {
    const mine = ++seq.current;
    // A slower, older response must not overwrite a newer one.
    try { const next = await getPlaytime(); if (mine === seq.current) setPlaytime(next); } catch { /* browser/development mode or an older backend */ }
  }, []);
  useEffect(() => {
    void refresh();
    if (!runningCount) return;
    const timer = window.setInterval(() => void refresh(), 15000);
    return () => window.clearInterval(timer);
  }, [runningCount, refresh]);
  return { playtime, refreshPlaytime: refresh };
}
