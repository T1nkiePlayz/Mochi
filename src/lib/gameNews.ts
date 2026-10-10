// Pure logic for the experimental game news feed: scheduling, dedupe and grouping. No network or Tauri imports.
import type { ModUpdateItem } from "./mods/updates";

export const NEWS_FEATURE_ID = "game-news";
export const NEWS_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const NEWS_CYCLE_CAP = 50;
export const NEWS_MAX_ITEMS = 100;
export const NEWS_MAX_SEEN = 1500;

export type NewsItem = { gid: string; appid: number; game: string; title: string; url: string; feedLabel: string; date: number; summary: string };
export type NewsState = {
  /** Steam news language used for this cache; a language change invalidates the old feed. */
  language: string;
  /** Last time each appid was fetched (ms). */
  checked: Record<string, number>;
  /** Ids already shown or notified (news gids and `mod:` keys), oldest first. */
  seen: string[];
  items: NewsItem[];
  /** Items fetched after this (ms) are unread. */
  readAt: number;
};

export const emptyNewsState = (language = "english"): NewsState => ({ language, checked: {}, seen: [], items: [], readAt: 0 });

/** Appids due for a fetch: never or >= interval ago (or clock moved back), oldest first, at most `cap`. */
export function dueApps(appids: readonly number[], checked: Readonly<Record<string, number>>, now: number, interval = NEWS_INTERVAL_MS, cap = NEWS_CYCLE_CAP): number[] {
  return [...new Set(appids)]
    .filter((id) => { const at = checked[id]; return !at || now - at >= interval || at > now; })
    .sort((a, b) => (checked[a] ?? 0) - (checked[b] ?? 0) || a - b)
    .slice(0, cap);
}

/** Whether a poll cycle may run right now. */
export const canPoll = (c: { enabled: boolean; online: boolean; visible: boolean }) => c.enabled && c.online && c.visible;

export type MergeResult = { state: NewsState; fresh: NewsItem[] };

/**
 * Folds fetched items for one game into the state. `fresh` are items never seen before; a game's very first fetch
 * (`firstFetch`) records its items without calling them fresh so a new library does not flood the notifications.
 */
export function mergeNews(state: NewsState, appid: number, fetched: readonly NewsItem[], now: number): MergeResult {
  const seen = new Set(state.seen);
  const firstFetch = state.checked[appid] === undefined;
  const fresh: NewsItem[] = [];
  const added: NewsItem[] = [];
  for (const item of fetched) {
    if (seen.has(item.gid)) continue;
    seen.add(item.gid);
    added.push(item);
    if (!firstFetch) fresh.push(item);
  }
  const known = new Set(state.items.map((item) => item.gid));
  const items = [...state.items, ...added.filter((item) => !known.has(item.gid))].sort((a, b) => b.date - a.date).slice(0, NEWS_MAX_ITEMS);
  return { fresh, state: { ...state, checked: { ...state.checked, [appid]: now }, seen: [...seen].slice(-NEWS_MAX_SEEN), items } };
}

/** Marks a game as checked without items (failed or empty fetch counts as a visit so it is not retried every cycle). */
export const markChecked = (state: NewsState, appid: number, now: number): NewsState => ({ ...state, checked: { ...state.checked, [appid]: now } });

export const unreadCount = (state: NewsState, extra = 0) => state.items.filter((item) => item.date * 1000 > state.readAt).length + extra;

export type ModUpdateNews = { key: string; tofu: string; title: string; version: string };

/** Mod updates from existing check results, one entry per file/new version. */
export function modUpdateNews(tofuName: string, items: readonly Pick<ModUpdateItem, "path" | "title" | "newVersion">[]): ModUpdateNews[] {
  return items.map((item) => ({ key: `mod:${item.path}:${item.newVersion}`, tofu: tofuName, title: item.title, version: item.newVersion }));
}

/** Entries not yet in `seen`; returns them and the updated seen list. */
export function takeUnseen(seen: readonly string[], entries: readonly ModUpdateNews[]): { fresh: ModUpdateNews[]; seen: string[] } {
  const known = new Set(seen);
  const fresh = entries.filter((entry) => !known.has(entry.key));
  return { fresh, seen: fresh.length ? [...seen, ...fresh.map((entry) => entry.key)].slice(-NEWS_MAX_SEEN) : [...seen] };
}

/** Parses persisted state defensively; anything malformed is dropped. */
export function parseNewsState(raw: unknown): NewsState {
  const base = emptyNewsState();
  if (!raw || typeof raw !== "object") return base;
  const value = raw as Partial<NewsState>;
  const checked: Record<string, number> = {};
  if (value.checked && typeof value.checked === "object") for (const [key, at] of Object.entries(value.checked)) if (typeof at === "number" && Number.isFinite(at)) checked[key] = at;
  const items = Array.isArray(value.items) ? value.items.filter((item): item is NewsItem => !!item && typeof item.gid === "string" && typeof item.title === "string" && typeof item.url === "string" && typeof item.appid === "number" && typeof item.date === "number").slice(0, NEWS_MAX_ITEMS) : [];
  return { language: typeof value.language === "string" && /^[a-z-]{2,24}$/.test(value.language) ? value.language : "english", checked, seen: Array.isArray(value.seen) ? value.seen.filter((id): id is string => typeof id === "string").slice(-NEWS_MAX_SEEN) : [], items, readAt: typeof value.readAt === "number" ? value.readAt : 0 };
}
