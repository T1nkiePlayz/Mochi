import { useCallback, useEffect, useRef, useState } from "react";
import { RA_CHANGED, getRaProgress, readRaMatch, type RaMatch, type RaProgressResult } from "../lib/retroAchievements";

/** The saved RetroAchievements match of a game, kept in step with the editor. */
export function useRaMatch(gameId: string): RaMatch | null {
  const [match, setMatch] = useState<RaMatch | null>(() => readRaMatch(gameId));
  useEffect(() => {
    const sync = () => setMatch(readRaMatch(gameId));
    sync();
    window.addEventListener(RA_CHANGED, sync);
    return () => window.removeEventListener(RA_CHANGED, sync);
  }, [gameId]);
  return match;
}

/** Loads one game's progress. The backend caches it (10 minutes) and serves the saved copy offline. */
export function useRetroAchievements(raGameId: number) {
  const [state, setState] = useState<{ loading: boolean; result: RaProgressResult | null }>({ loading: true, result: null });
  const request = useRef(0);
  const load = useCallback(async (refresh: boolean) => {
    const id = ++request.current;
    setState((current) => ({ ...current, loading: true }));
    const result = await getRaProgress(raGameId, refresh);
    if (id === request.current) setState({ loading: false, result });
  }, [raGameId]);
  useEffect(() => {
    void load(false);
    window.addEventListener(RA_CHANGED, onChange);
    function onChange() { void load(false); }
    return () => { request.current += 1; window.removeEventListener(RA_CHANGED, onChange); };
  }, [load]);
  const refresh = useCallback(() => load(true), [load]);
  return { ...state, refresh };
}
