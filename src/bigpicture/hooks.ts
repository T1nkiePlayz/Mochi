import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Piko } from "../models";
import { getSystemStatus, type SystemStatus } from "./native";

export function useClock(): string {
  const read = () => new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const [time, setTime] = useState(read);
  useEffect(() => {
    const timer = window.setInterval(() => setTime(read()), 10_000);
    return () => window.clearInterval(timer);
  }, []);
  return time;
}

/** Battery and power state; polled gently, and absent on machines without a battery. */
export function useSystemStatus(): SystemStatus | null {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  useEffect(() => {
    let cancelled = false;
    const poll = () => { void getSystemStatus().then((value) => { if (!cancelled) setStatus(value); }).catch(() => {}); };
    poll();
    const timer = window.setInterval(poll, 30_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);
  return status;
}

/** The best image URL for a game: the offline cache first, then the remote URL. */
export function useArtworkUrl(piko: Piko | undefined): string {
  const [cached, setCached] = useState("");
  const key = piko?.artworkCacheKey;
  useEffect(() => {
    setCached("");
    if (!key) return;
    let cancelled = false;
    void invoke<string | null>("get_cached_game_artwork", { cacheKey: key }).then((value) => { if (!cancelled && value) setCached(value); }).catch(() => {});
    return () => { cancelled = true; };
  }, [key]);
  return cached || piko?.artworkUrl || "";
}

export const isLauncher = (piko: Piko) => (piko as Piko & { kind?: string }).kind === "launcher";
