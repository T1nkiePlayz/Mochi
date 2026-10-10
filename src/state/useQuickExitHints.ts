import { useEffect, useRef } from "react";
import type { Piko } from "../models";
import type { ActiveSession } from "../lib/platform";
import { getPlatformCapabilities } from "../lib/platform";
import { listGameLogs, readGameLog } from "../lib/gameLogs";
import { launchHints, modUpdateHint, quickExits } from "../lib/launchHints";
import { listTofuSnapshots } from "../lib/mods/snapshots";
import { findCrashSuspects } from "../lib/mods/conflictService";

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
          const piko = libraryRef.current.find((item) => item.id === id);
          const name = piko?.name ?? "The game";
          let text: string | null = null;
          const list = await listGameLogs(id).catch(() => null);
          const newest = list?.sessions[0];
          if (newest?.direct) text = (await readGameLog(id, newest.id, undefined, LOG_TAIL_BYTES).catch(() => null))?.text ?? null;
          const platform = await getPlatformCapabilities().then((caps) => caps.platform).catch(() => "linux");
          const hints = launchHints(text, platform);
          const snapshots = (await Promise.all((piko?.tofus ?? []).filter((tofu) => tofu.path).map((tofu) => listTofuSnapshots(tofu.id).catch(() => [])))).flat();
          const rollback = modUpdateHint(snapshots, Date.now());
          if (rollback) hints.unshift(rollback);
          const tofu = piko?.tofus.find((item) => item.path);
          const suspects = piko && tofu && text ? await findCrashSuspects(piko, tofu, text) : [];
          if (suspects.length) hints.unshift(`The log names ${suspects.slice(0, 3).map((issue) => issue.title.replace(/ is named in the log$/, "")).join(", ")}. Open the game's Logs and use "Find suspect mods" to switch it off.`);
          notifyRef.current(`${name} closed right after starting`, hints.join(" "));
        } catch { /* browser/development mode */ }
      })();
    }
  }, [sessions]);
}
