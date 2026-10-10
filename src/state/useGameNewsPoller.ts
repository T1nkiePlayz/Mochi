import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Piko } from "../models";
import { canPoll, dueApps, markChecked, mergeNews, modUpdateNews, resetNewsLanguage, steamNewsLanguage, takeUnseen, type ModUpdateNews, type NewsItem } from "../lib/gameNews";
import { isOnline, markNetworkFailure, markNetworkOk } from "../lib/offline";
import { steamAppIdOf } from "../lib/metadata/merge";
import { getNewsSnapshot, setModNews, setNews } from "./gameNewsStore";
import { getUpdateState, useUpdateVersion } from "./modUpdates";

type Notify = (title: string, message: string, opts?: { group?: string; item?: string }) => void;
type RawItem = { gid: string; title: string; url: string; feedLabel: string; date: number; summary: string };
type RawResult = { status: "ok" | "offline" | "error"; items: RawItem[] };

const TICK_MS = 10 * 60 * 1000;

const FIRST_DELAY_MS = 20_000;
const STAGGER_MS = 1500;

/**
 * Background Steam news for the games in the library, only while the experimental "game-news" flag is on.
 * Runs when the window is visible and online, fetches each game at most every 6 hours (50 per cycle, one at a
 * time with a pause between), and reuses the mod update checks that already run elsewhere.
 */
export function useGameNewsPoller(enabled: boolean, library: readonly Piko[], notify: Notify, locale?: string) {
  const libraryRef = useRef(library);
  libraryRef.current = library;
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const updateVersion = useUpdateVersion();

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let running = false;
    // Until Mochi has a language selector, follow the OS/webview locale.
    const language = steamNewsLanguage(locale ?? (typeof navigator === "undefined" ? "en" : navigator.language));
    const currentNews = getNewsSnapshot().news;
    if (currentNews.language !== language) setNews(resetNewsLanguage(currentNews, language));
    const timers = new Set<number>();
    const sleep = (ms: number) => new Promise<void>((resolve) => { const id = window.setTimeout(() => { timers.delete(id); resolve(); }, ms); timers.add(id); });
    const ok = () => canPoll({ enabled: !cancelled, online: isOnline(), visible: document.visibilityState !== "hidden" });

    const cycle = async () => {
      if (running || !ok()) return;
      running = true;
      try {
        const names = new Map<number, string>();
        for (const piko of libraryRef.current) { const id = steamAppIdOf(piko); if (id !== null && piko.kind !== "launcher" && !names.has(id)) names.set(id, piko.name); }
        const due = dueApps([...names.keys()], getNewsSnapshot().news.checked, Date.now());
        for (const [index, appid] of due.entries()) {
          if (!ok()) break;
          if (index > 0) await sleep(STAGGER_MS);
          if (!ok()) break;
          const game = names.get(appid) ?? `Steam app ${appid}`;
          let result: RawResult;
          try { result = await invoke<RawResult>("get_steam_news", { appid, language }); } catch {
            // Invocation errors count as a visit too, otherwise a broken command is retried every poll cycle.
            if (!cancelled) setNews(markChecked(getNewsSnapshot().news, appid, Date.now()));
            continue;
          }
          if (cancelled) break;
          if (result.status === "offline") { markNetworkFailure(); break; }
          markNetworkOk();
          // Errors still count as a visit so a failing app is not retried every cycle.
          if (result.status !== "ok") { setNews(markChecked(getNewsSnapshot().news, appid, Date.now())); continue; }
          const items: NewsItem[] = result.items.map((item) => ({ ...item, appid, game }));
          const merged = mergeNews(getNewsSnapshot().news, appid, items, Date.now());
          setNews(merged.state);
          for (const item of merged.fresh) notifyRef.current(`${game}: ${item.title}`, item.summary || item.feedLabel, { group: "news", item: game });
        }
      } finally { running = false; }
    };

    const onVisible = () => { if (document.visibilityState === "visible") void cycle(); };
    const first = window.setTimeout(() => void cycle(), FIRST_DELAY_MS);
    const tick = window.setInterval(() => void cycle(), TICK_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => { cancelled = true; clearTimeout(first); clearInterval(tick); timers.forEach((id) => clearTimeout(id)); document.removeEventListener("visibilitychange", onVisible); };
  }, [enabled, locale]);

  // Mod updates: read the results of the existing update checks (no extra requests) and announce each new version once.
  useEffect(() => {
    if (!enabled) { setModNews([]); return; }
    const entries: ModUpdateNews[] = [];
    for (const piko of library) for (const tofu of piko.tofus ?? []) {
      const check = getUpdateState(tofu.id).check;
      if (check) entries.push(...modUpdateNews(`${piko.name} / ${tofu.name}`, check.items));
    }
    setModNews(entries);
    const news = getNewsSnapshot().news;
    const { fresh, seen } = takeUnseen(news.seen, entries);
    if (!fresh.length) return;
    setNews({ ...news, seen });
    // The first sight of a library's updates (nothing checked yet) still announces: these are actionable, unlike old news.
    for (const entry of fresh) notifyRef.current(`Mod update: ${entry.title}`, `${entry.tofu} ${entry.version}`, { group: "news", item: entry.tofu });
  }, [enabled, library, updateVersion]);
}
