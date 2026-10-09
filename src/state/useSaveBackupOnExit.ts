import { useEffect, useRef } from "react";
import type { Piko } from "../models";
import { autoBackupEnabled, autoBackupSaves, closedGames, describeAuto, hasSaveSources, saveHints } from "../lib/saveBackups";

const SETTLE_MS = 3000;

/**
 * Backs up a game's save folders in the background when it closes (when the game's "Back up saves when the game closes"
 * setting is on). One game at a time, after a short pause so the game has finished writing; skipped when the game is
 * running again (the native side checks too).
 */
export function useSaveBackupOnExit(runningIds: ReadonlySet<string>, library: Piko[], notify: (title: string, message: string) => void) {
  const previous = useRef<ReadonlySet<string>>(runningIds);
  const libraryRef = useRef(library);
  libraryRef.current = library;
  const runningRef = useRef(runningIds);
  runningRef.current = runningIds;
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const queue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    const closed = closedGames(previous.current, runningIds);
    previous.current = runningIds;
    for (const id of closed) {
      queue.current = queue.current.then(async () => {
        const piko = libraryRef.current.find((item) => item.id === id);
        if (!piko || !autoBackupEnabled(piko)) return;
        const hints = saveHints(piko);
        if (!hasSaveSources(hints)) return;
        await new Promise((resolve) => window.setTimeout(resolve, SETTLE_MS));
        if (runningRef.current.has(id)) return;
        try {
          const summary = describeAuto(await autoBackupSaves(id, hints));
          if (summary) notifyRef.current(summary.title, `${piko.name}: ${summary.message}`);
        } catch { /* browser/development mode, or a transient failure: the next exit tries again */ }
      });
    }
  }, [runningIds]);
}
