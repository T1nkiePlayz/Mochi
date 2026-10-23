import { useEffect, useMemo, useRef } from "react";
import type { Piko } from "../models";
import { collectPaths, findMissing } from "../lib/pathRemap";
import { setMissing } from "../lib/pathRemapStore";

const DEBOUNCE_MS = 2500;

/**
 * Keeps the set of games with missing local paths current: after startup, after a cloud sync or any edit changes a path
 * (the check re-runs only when the collected paths change), debounced and off the critical path. Tells the user once per game.
 */
export function usePathRemapCheck(ready: boolean, library: Piko[], notify: (title: string, message: string) => void) {
  const signature = useMemo(() => collectPaths(library).map((slot) => `${slot.gameId}\u0001${slot.tofuId ?? ""}\u0001${slot.launchSourceId ?? ""}\u0001${slot.field}\u0001${slot.path}`).join("\u0002"), [library]);
  const latest = useRef({ library, notify });
  latest.current = { library, notify };
  const announced = useRef(new Set<string>());

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void findMissing(latest.current.library).then((missing) => {
        if (cancelled) return;
        setMissing(missing);
        const fresh = [...missing.keys()].filter((id) => !announced.current.has(id));
        fresh.forEach((id) => announced.current.add(id));
        if (fresh.length) latest.current.notify("Missing game paths", "Some games point at files that do not exist on this device. Open Settings > Data > Fix missing paths.");
      }).catch(() => { /* browser/development mode: nothing to check */ });
    }, DEBOUNCE_MS);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [ready, signature]);
}
