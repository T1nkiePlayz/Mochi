import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Piko } from "../models";
import { steamAppIdOf } from "../lib/metadata/merge";
import { getSteamAchievements, STEAM_ACHIEVEMENTS_CHANGED } from "../lib/steamAchievements";

export type SteamSyncState = { running: boolean; done: number; total: number; message: string };
const GAP_MS = 250;

/** Loads achievements for every Steam game in the library, one at a time and politely, so Steam-based achievements have data. */
export function useSteamSync(library: Piko[]) {
  const [state, setState] = useState<SteamSyncState>({ running: false, done: 0, total: 0, message: "" });
  const alive = useRef(true);
  const running = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const appIds = useMemo(() => [...new Set(library.map(steamAppIdOf).filter((id): id is number => id !== null))], [library]);
  const count = appIds.length;

  const start = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    const ids = appIds;
    let withData = 0;
    let message = "";
    setState({ running: true, done: 0, total: ids.length, message: "" });
    for (let index = 0; index < ids.length && alive.current; index += 1) {
      const result = await getSteamAchievements(ids[index]);
      if (result.status === "ok") withData += 1;
      else if (result.status === "private" || result.status === "no-steam-user" || result.status === "offline" || result.status === "rate-limited") { message = result.status === "rate-limited" ? "Steam is busy. Showing saved data; Mochi will try the rest later." : result.message || "Steam is unavailable."; break; }
      if (alive.current) setState({ running: true, done: index + 1, total: ids.length, message: "" });
      await new Promise((resolve) => window.setTimeout(resolve, GAP_MS));
    }
    running.current = false;
    window.dispatchEvent(new Event(STEAM_ACHIEVEMENTS_CHANGED));
    if (alive.current) setState((current) => ({ ...current, running: false, message: message || `Loaded achievements for ${withData} of ${ids.length} Steam games.` }));
  }, [appIds]);

  return { ...state, count, start };
}
