import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { subscribeNative } from "../../lib/nativeEvents";

type Progress = { tofuId: string; done: number; total: number };

/** Shows "Syncing mods 12 of 40" while the native side copies this Tofu's mods into the game folder at launch. */
export function ModSyncStatus({ tofuId }: { tofuId: string }) {
  const [progress, setProgress] = useState<Progress | null>(null);
  useEffect(() => {
    const offProgress = subscribeNative<Progress>("mod-sync-progress", (next) => { if (next.tofuId === tofuId) setProgress(next); });
    const offResult = subscribeNative<{ tofuId: string }>("mod-sync-result", (next) => { if (next.tofuId === tofuId) setProgress(null); });
    return () => { offProgress(); offResult(); };
  }, [tofuId]);
  if (!progress || progress.total === 0) return null;
  return <p className="metadata-note" role="status" aria-live="polite"><RefreshCw size={12} className="spin" /> Syncing mods into the game folder: {progress.done} of {progress.total}</p>;
}
