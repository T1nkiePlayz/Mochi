import { describe, expect, it } from "vitest";
import { canPoll, dueApps, emptyNewsState, mergeNews, modUpdateNews, NEWS_CYCLE_CAP, NEWS_INTERVAL_MS, NEWS_MAX_ITEMS, parseNewsState, resetNewsLanguage, takeUnseen, steamNewsLanguage, unreadCount, type NewsItem } from "./gameNews";
import { listItems, summarise } from "./notifyBatch";

const item = (gid: string, appid = 1, date = 100): NewsItem => ({ gid, appid, game: "G", title: `T${gid}`, url: "https://x/", feedLabel: "", date, summary: "" });
const H = 60 * 60 * 1000;

describe("steamNewsLanguage", () => {
  it("maps supported locales to Steam language names and defaults unknown locales to English", () => {
    expect(steamNewsLanguage("fr-FR")).toBe("french");
    expect(steamNewsLanguage("en-AU")).toBe("english");
    expect(steamNewsLanguage("zh-TW")).toBe("tchinese");
    expect(steamNewsLanguage("zh-Hant")).toBe("tchinese");
    expect(steamNewsLanguage("zh-Hans")).toBe("schinese");
    expect(steamNewsLanguage("zh-CN")).toBe("schinese");
    expect(steamNewsLanguage("pt-BR")).toBe("brazilian");
    expect(steamNewsLanguage("xx-YY")).toBe("english");
  });
});

describe("resetNewsLanguage", () => {
  it("drops posts from the old locale but preserves mod update dedupe keys", () => {
    const state = { ...emptyNewsState("english"), checked: { 440: 123 }, seen: ["old-news-id", "mod:/mod.jar:2"], items: [item("old-news-id")], readAt: 456 };
    expect(resetNewsLanguage(state, "french")).toEqual({ ...emptyNewsState("french"), seen: ["mod:/mod.jar:2"] });
    expect(resetNewsLanguage(state, "english")).toBe(state);
  });
});

describe("dueApps", () => {
  it("returns never-checked and stale apps, oldest first, deduped", () => {
    const now = 100 * H;
    const checked = { 1: now - 7 * H, 2: now - 1 * H, 3: now - 20 * H };
    expect(dueApps([1, 2, 3, 4, 1], checked, now)).toEqual([4, 3, 1]);
  });
  it("caps the cycle and treats a clock moved back as due", () => {
    const ids = Array.from({ length: 80 }, (_, i) => i + 1);
    expect(dueApps(ids, {}, 1000)).toHaveLength(NEWS_CYCLE_CAP);
    expect(dueApps([1], { 1: 5000 }, 1000)).toEqual([1]);
    expect(dueApps([1], { 1: 1000 - NEWS_INTERVAL_MS + 1 }, 1000)).toEqual([]);
  });
});

describe("canPoll", () => {
  it("needs enabled, online and visible", () => {
    expect(canPoll({ enabled: true, online: true, visible: true })).toBe(true);
    expect(canPoll({ enabled: false, online: true, visible: true })).toBe(false);
    expect(canPoll({ enabled: true, online: false, visible: true })).toBe(false);
    expect(canPoll({ enabled: true, online: true, visible: false })).toBe(false);
  });
});

describe("mergeNews", () => {
  it("does not report the first fetch of a game as fresh", () => {
    const { state, fresh } = mergeNews(emptyNewsState(), 1, [item("a"), item("b")], 10);
    expect(fresh).toEqual([]);
    expect(state.items).toHaveLength(2);
    expect(state.checked[1]).toBe(10);
  });
  it("dedupes by gid and reports only new items", () => {
    let { state } = mergeNews(emptyNewsState(), 1, [item("a")], 10);
    const second = mergeNews(state, 1, [item("a"), item("b", 1, 200)], 20);
    expect(second.fresh.map((i) => i.gid)).toEqual(["b"]);
    state = second.state;
    const third = mergeNews(state, 1, [item("a"), item("b", 1, 200)], 30);
    expect(third.fresh).toEqual([]);
    expect(third.state.items.map((i) => i.gid)).toEqual(["b", "a"]);
  });
  it("bounds the stored items", () => {
    let state = mergeNews(emptyNewsState(), 1, [], 1).state;
    state = mergeNews(state, 1, Array.from({ length: NEWS_MAX_ITEMS + 20 }, (_, i) => item(`g${i}`, 1, i)), 2).state;
    expect(state.items).toHaveLength(NEWS_MAX_ITEMS);
  });
  it("counts unread by date after readAt", () => {
    const { state } = mergeNews(emptyNewsState(), 1, [item("a", 1, 100), item("b", 1, 300)], 1);
    expect(unreadCount({ ...state, readAt: 200_000 })).toBe(1);
    expect(unreadCount({ ...state, readAt: 0 }, 2)).toBe(4);
  });
});

describe("mod updates", () => {
  it("notifies each file/version once", () => {
    const entries = modUpdateNews("Tofu", [{ path: "/a.jar", title: "A", newVersion: "2" }]);
    const first = takeUnseen([], entries);
    expect(first.fresh).toHaveLength(1);
    expect(takeUnseen(first.seen, entries).fresh).toEqual([]);
    expect(takeUnseen(first.seen, modUpdateNews("Tofu", [{ path: "/a.jar", title: "A", newVersion: "3" }])).fresh).toHaveLength(1);
  });
});

describe("news grouping", () => {
  it("leaves one notice alone and groups a burst by game", () => {
    expect(summarise("news", [{ title: "Game: Patch", message: "m", item: "Game" }])).toEqual({ title: "Game: Patch", message: "m" });
    const burst = summarise("news", ["A", "B", "C", "D", "E"].map((game) => ({ title: `${game}: x`, message: "m", item: game })));
    expect(burst.title).toBe("5 news updates");
    expect(burst.message).toBe(listItems(["A", "B", "C", "D", "E"]));
  });
});

describe("parseNewsState", () => {
  it("survives garbage", () => {
    expect(parseNewsState(null)).toEqual(emptyNewsState());
    expect(parseNewsState({ checked: { 1: "x", 2: 5 }, seen: [1, "a"], items: [{ gid: 1 }, item("z")], readAt: "no" })).toEqual({ language: "english", checked: { 2: 5 }, seen: ["a"], items: [item("z")], readAt: 0 });
  });
});
