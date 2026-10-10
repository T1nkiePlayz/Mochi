import { useSyncExternalStore } from "react";
import { emptyNewsState, parseNewsState, type ModUpdateNews, type NewsState } from "../lib/gameNews";

// Steam news is public data, so the last items and the seen ids are kept in localStorage. Mod update entries
// come from the in-memory update checks and are never written to disk.
const KEY = "mochi:game-news";
type Snapshot = { news: NewsState; mods: readonly ModUpdateNews[] };

function load(): NewsState {
  try { return parseNewsState(JSON.parse(localStorage.getItem(KEY) ?? "null")); } catch { return emptyNewsState(); }
}

let snapshot: Snapshot = { news: load(), mods: [] };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

export const getNewsSnapshot = () => snapshot;

export function setNews(news: NewsState) {
  snapshot = { ...snapshot, news };
  try { localStorage.setItem(KEY, JSON.stringify(news)); } catch { /* storage unavailable: news still works for this session */ }
  emit();
}

export function setModNews(mods: readonly ModUpdateNews[]) {
  snapshot = { ...snapshot, mods };
  emit();
}

export const markNewsRead = () => { if (snapshot.news.readAt < Date.now()) setNews({ ...snapshot.news, readAt: Date.now() }); };

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function useGameNews(): Snapshot {
  return useSyncExternalStore(subscribe, getNewsSnapshot, getNewsSnapshot);
}
