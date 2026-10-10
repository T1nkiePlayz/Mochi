import { useEffect, useRef } from "react";
import type { Piko } from "../models";
import type { ActiveSession } from "../lib/platform";
import { getPlatformCapabilities } from "../lib/platform";
import { listGameLogs, readGameLog } from "../lib/gameLogs";
import { launchHints, quickExits } from "../lib/launchHints";

const LOG_TAIL_BYTES = 64 * 1024;

/** When a game closes within a few seconds of starting, tells the user the likely causes (from the game's captured output when there is any). */
export function useQuickExitHints(sessions: ActiveSession[], library: Piko[], notify: (title: string, message: string) => void) {
  const previous = useRef<Map<string, number>>(new Map());
  const libraryRef = useRef(library);
  libraryRef.current = library;
  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  useEffect(() => {
    const current = new Set(sessions.map((session) => session.gameId));
    const ended = quickExits(previous.current, current, Math.floor(Date.now() / 1000));
    previous.current = new Map(sessions.map((session) => [session.gameId, session.startedAt]));
    for (const id of ended) {
      void (async () => {
        try {
          const name = libraryRef.current.find((item) => item.id === id)?.name ?? "The game";
          let text: string | null = null;
          const list = await listGameLogs(id).catch(() => null);
          const newest = list?.sessions[0];
          if (newest?.direct) text = (await readGameLog(id, newest.id, undefined, LOG_TAIL_BYTES).catch(() => null))?.text ?? null;
          const platform = await getPlatformCapabilities().then((caps) => caps.platform).catch(() => "linux");
          const hints = launchHints(text, platform);
          notifyRef.current(`${name} closed right after starting`, hints.join(" "));
        } catch { /* browser/development mode */ }
      })();
    }
  }, [sessions]);
}
