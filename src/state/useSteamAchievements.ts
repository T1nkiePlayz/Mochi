import { useCallback, useEffect, useRef, useState } from "react";
import { getSteamAchievements, STEAM_ACHIEVEMENTS_CHANGED, type SteamAchievementsResult } from "../lib/steamAchievements";

export type SteamAchievementsState = { loading: boolean; result: SteamAchievementsResult | null };

/** Session cache so reopening a game does not repeat a request the backend already rate-limits by its own cache. */
const session = new Map<number, SteamAchievementsResult>();

/** Loads the achievements of one Steam game; `appid` null skips (not a Steam game). */
export function useSteamAchievements(appid: number | null) {
  const [state, setState] = useState<SteamAchievementsState>({ loading: appid !== null && !session.has(appid), result: appid !== null ? session.get(appid) ?? null : null });
  const request = useRef(0);

  const load = useCallback(async (refresh: boolean) => {
    if (appid === null) return;
    const id = ++request.current;
    setState((current) => ({ ...current, loading: true }));
    const result = await getSteamAchievements(appid, refresh);
    if (id !== request.current) return;
    if (result.status === "ok" || result.status === "no-achievements") session.set(appid, result);
    if (result.status === "ok") window.dispatchEvent(new Event(STEAM_ACHIEVEMENTS_CHANGED));
    setState({ loading: false, result });
  }, [appid]);

  useEffect(() => {
    if (appid === null) { setState({ loading: false, result: null }); return; }
    const cached = session.get(appid);
    if (cached) { setState({ loading: false, result: cached }); return; }
    void load(false);
    return () => { request.current += 1; };
  }, [appid, load]);

  const refresh = useCallback(() => { if (appid !== null) session.delete(appid); return load(true); }, [appid, load]);
  return { ...state, refresh };
}
