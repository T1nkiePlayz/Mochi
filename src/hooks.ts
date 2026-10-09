import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { keepIfEqual } from "./lib/equal";
import { getActiveSessions, type ActiveSession } from "./lib/platform";

/** Resolves true once the element is (nearly) on screen, so off-screen covers in a long library are not loaded. Stays true once reached. */
export function useNearViewport(ref: React.RefObject<HTMLElement>, skip: boolean, rootMargin = "400px") {
  const [near, setNear] = useState(() => skip || typeof IntersectionObserver === "undefined");
  useEffect(() => {
    if (near || !ref.current) return;
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) setNear(true); }, { rootMargin });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [near, ref, rootMargin]);
  return near;
}

/** Tracks which games are currently running, updating as the native side reports changes. */
export function useGameSessions() {
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const seq = useRef(0);
  const refresh = useCallback(async () => {
    const mine = ++seq.current;
    try { const next = await getActiveSessions(); if (mine === seq.current) setSessions(keepIfEqual(next)); } catch { /* browser/development mode */ }
  }, []);
  const isRunning = useCallback((gameId: string) => sessions.some((session) => session.gameId === gameId), [sessions]);

  useEffect(() => {
    void refresh();
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void listen("game-sessions-changed", () => void refresh()).then((off) => { if (disposed) off(); else unlisten = off; }).catch(() => {});
    return () => { disposed = true; unlisten?.(); };
  }, [refresh]);

  return { sessions, refresh, isRunning };
}
