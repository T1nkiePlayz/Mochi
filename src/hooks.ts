import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getActiveSessions, type ActiveSession } from "./lib/platform";

/** Tracks which games are currently running, updating as the native side reports changes. */
export function useGameSessions() {
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const refresh = useCallback(async () => {
    try { setSessions(await getActiveSessions()); } catch { /* browser/development mode */ }
  }, []);

  useEffect(() => {
    void refresh();
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void listen("game-sessions-changed", () => void refresh()).then((off) => { if (disposed) off(); else unlisten = off; }).catch(() => {});
    return () => { disposed = true; unlisten?.(); };
  }, [refresh]);

  return { sessions, refresh, isRunning: (gameId: string) => sessions.some((session) => session.gameId === gameId) };
}
