import { useCallback, useEffect, useState } from "react";
import { applyDownloadPrefs, readDownloadPrefs, writeDownloadPrefs, type DownloadPrefs } from "../lib/downloadPacing";

/** Download pause, speed cap and allowed hours: stored on this device and re-applied every minute so the schedule takes effect. */
export function useDownloadPacing() {
  const [prefs, setPrefsState] = useState<DownloadPrefs>(readDownloadPrefs);
  const setPrefs = useCallback((change: (current: DownloadPrefs) => DownloadPrefs) => setPrefsState((current) => { const next = change(current); writeDownloadPrefs(next); return next; }), []);
  useEffect(() => {
    const apply = () => { void applyDownloadPrefs(prefs).catch(() => { /* browser/development mode */ }); };
    apply();
    const timer = window.setInterval(apply, 60_000);
    return () => window.clearInterval(timer);
  }, [prefs]);
  return { prefs, setPrefs };
}
