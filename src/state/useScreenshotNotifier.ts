import { useEffect, useRef } from "react";
import type { Piko } from "../models";
import { closedGames } from "../lib/saveBackups";
import { lastSeen, markSeen, newSince, scanRequestFor, scanScreenshots } from "../lib/screenshots";

const SETTLE_MS = 4000;

/** When a game closes, tells the user if it left new screenshots behind (the game page shows them). */
export function useScreenshotNotifier(enabled: boolean, runningIds: ReadonlySet<string>, library: Piko[], sharedFolders: string[], notify: (title: string, message: string) => void) {
  const previous = useRef<ReadonlySet<string>>(runningIds);
  const latest = useRef({ library, sharedFolders, notify, enabled });
  latest.current = { library, sharedFolders, notify, enabled };

  useEffect(() => {
    const closed = closedGames(previous.current, runningIds);
    previous.current = runningIds;
    for (const id of closed) {
      window.setTimeout(() => {
        const { library: current, sharedFolders: shared, notify: tell, enabled: on } = latest.current;
        const piko = current.find((item) => item.id === id);
        if (!on || !piko) return;
        void scanScreenshots(scanRequestFor(piko, shared)).then((files) => {
          const fresh = newSince(files, lastSeen(id));
          if (fresh.length) tell("New screenshots", `${piko.name}: ${fresh.length} new screenshot${fresh.length === 1 ? "" : "s"}. Open the game page to see them.`);
          // Without a first look there is nothing "new" yet: start counting from now.
          if (lastSeen(id) === null) markSeen(id, files);
        }).catch(() => { /* browser/development mode */ });
      }, SETTLE_MS);
    }
  }, [runningIds]);
}
