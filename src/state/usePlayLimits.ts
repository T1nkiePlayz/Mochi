import { useEffect, useRef } from "react";
import type { Piko } from "../models";
import type { ActiveSession } from "../lib/platform";
import { getPlaytimeHistory } from "../lib/stats";
import { breaksDue, describeLimit, limitStatus, localMidnight, minutesToday, type PlayLimits } from "../lib/playLimits";

const EVERY_MS = 60 * 1000;

/** Today's play time, as the limits see it. Resolves to zeros when history is unavailable. */
export async function playedToday(active: ActiveSession[], now = new Date()) {
  const midnight = localMidnight(now);
  const records = await getPlaytimeHistory(midnight).catch(() => []);
  return minutesToday(records, active, Math.floor(now.getTime() / 1000), midnight);
}

/** While a game runs and limits are on: warns near and at limits, at bedtime and every break interval, once each per day. */
export function usePlayLimits(limits: PlayLimits, sessions: ActiveSession[], library: Piko[], notify: (title: string, message: string) => void) {
  const latest = useRef({ limits, sessions, library, notify });
  latest.current = { limits, sessions, library, notify };
  const told = useRef(new Set<string>());
  const active = limits.enabled && sessions.length > 0;

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const check = async () => {
      const { limits: current, sessions: running, library: games, notify: tell } = latest.current;
      const now = new Date();
      const day = localMidnight(now);
      const today = await playedToday(running, now);
      if (cancelled) return;
      const once = (key: string) => { const full = `${day}|${key}`; if (told.current.has(full)) return false; told.current.add(full); return true; };
      for (const session of running) {
        const name = games.find((piko) => piko.id === session.gameId)?.name ?? "This game";
        const status = limitStatus(current, session.gameId, today.total, today.byGame.get(session.gameId) ?? 0, now.getHours() * 60 + now.getMinutes());
        const summary = describeLimit(status, name);
        if (summary && status.kind !== "ok" && once(`${session.gameId}|${status.kind}|${status.scope}`)) tell(summary.title, summary.message);
        const due = breaksDue(current, (Date.now() / 1000 - session.startedAt) / 60);
        if (due > 0 && once(`${session.gameId}|break|${session.startedAt}|${due}`)) tell("Time for a break", `You have been playing ${name} for ${Math.round((Date.now() / 1000 - session.startedAt) / 60)} minutes. Stretch, drink some water.`);
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), EVERY_MS);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [active]);
}
