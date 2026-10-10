import { describe, expect, it } from "vitest";
import type { Piko } from "../models";
import type { SessionRecord } from "./stats";
import { buildCardData, buildCardSvg, defaultShareOptions, escapeXml, initialsOf, topGamesOf, type CardPalette } from "./shareCard";

const NOW = new Date(2026, 5, 15, 12).getTime();
const day = (ago: number) => Math.floor((NOW - ago * 86_400_000) / 1000);
const rec = (gameId: string, name: string, ago: number, seconds: number, kind: SessionRecord["kind"] = "session"): SessionRecord => ({ gameId, name, start: day(ago), seconds, kind, count: 1 });
const records = [rec("a", "Alpha", 1, 3600), rec("b", "Beta", 2, 7200), rec("a", "Alpha", 100, 36000), rec("c", "Old", 200, 600, "historic")];
const library = [{ id: "b", name: "Beta Renamed" }] as Piko[];
const palette: CardPalette = { background: "#000", surface: "#111", border: "#222", text: "#fff", muted: "#999", accent: "#0f0", accentText: "#010", fontBody: "Inter, sans-serif", fontDisplay: "Inter, sans-serif" };
const build = (options = {}) => buildCardData({ records, library, unlocked: 4, totalAchievements: 20, username: "Ash", options: { ...defaultShareOptions, ...options }, now: NOW });

describe("share card data", () => {
  it("aggregates all time including pre-history playtime", () => {
    const { games, totalSeconds } = topGamesOf(records, "all", NOW);
    expect(totalSeconds).toBe(3600 + 7200 + 36000 + 600);
    expect(games.map((game) => game.gameId)).toEqual(["a", "b", "c"]);
  });
  it("limits to the last 30 days", () => {
    const { games, totalSeconds } = topGamesOf(records, "30", NOW);
    expect(totalSeconds).toBe(10800);
    expect(games.map((game) => game.gameId)).toEqual(["b", "a"]);
  });
  it("uses library names and labels the period", () => {
    expect(build({ period: "30" }).periodLabel).toBe("Last 30 days");
    expect(build().games?.[1]?.name).toBe("Beta Renamed");
  });
  it("leaves out everything the user switched off", () => {
    const data = build({ games: false, playtime: false, achievements: false, account: false });
    expect(data.games).toBeUndefined(); expect(data.totalSeconds).toBeUndefined(); expect(data.achievements).toBeUndefined(); expect(data.account).toBeUndefined();
  });
  it("only includes the account name when enabled and non-empty", () => {
    expect(build({ account: true }).account).toBe("Ash");
    expect(buildCardData({ records, library, unlocked: 0, totalAchievements: 0, username: "  ", options: { ...defaultShareOptions, account: true }, now: NOW }).account).toBeUndefined();
  });
  it("caps the game list at five", () => {
    const many = Array.from({ length: 9 }, (_, i) => rec(`g${i}`, `G${i}`, 1, 100 + i));
    expect(buildCardData({ records: many, library: [], unlocked: 0, totalAchievements: 0, username: "", options: defaultShareOptions, now: NOW }).games).toHaveLength(5);
  });
});

describe("share card svg", () => {
  it("renders chosen sections and theme colours", () => {
    const svg = buildCardSvg(build({ account: true }), palette);
    expect(svg).toContain("Ash&apos;s stats"); expect(svg).toContain("TIME PLAYED"); expect(svg).toContain("4 / 20"); expect(svg).toContain("TOP GAMES"); expect(svg).toContain('fill="#0f0"');
  });
  it("omits private sections entirely", () => {
    const svg = buildCardSvg(build({ games: false, playtime: false, achievements: false }), palette);
    expect(svg).not.toContain("TOP GAMES"); expect(svg).not.toContain("TIME PLAYED"); expect(svg).not.toContain("Alpha"); expect(svg).not.toContain("Ash");
  });
  it("escapes game names and falls back to initials without a cover", () => {
    const svg = buildCardSvg({ periodLabel: "All time", games: [{ gameId: "x", name: "<b>Tom & Jerry</b>", seconds: 60 }] }, palette);
    expect(svg).not.toContain("<b>"); expect(svg).toContain("&lt;b&gt;Tom &amp; Jerry"); expect(svg).toContain(">&lt;J<");
  });
  it("embeds only inline raster covers", () => {
    const game = [{ gameId: "x", name: "X", seconds: 60 }];
    expect(buildCardSvg({ periodLabel: "p", games: game }, palette, { x: "data:image/png;base64,AAAA" })).toContain('<image href="data:image/png;base64,AAAA"');
    expect(buildCardSvg({ periodLabel: "p", games: game }, palette, { x: "https://example.com/a.png" })).not.toContain("<image");
    expect(buildCardSvg({ periodLabel: "p", games: game }, palette, { x: 'data:image/svg+xml;base64,AA"onload="x' })).not.toContain("<image");
  });
  it("rejects hostile palette values", () => {
    const svg = buildCardSvg({ periodLabel: "p" }, { ...palette, accent: '"/><script>' });
    expect(svg).not.toContain("<script>");
  });
  it("helpers", () => { expect(escapeXml(`a<&>"'`)).toBe("a&lt;&amp;&gt;&quot;&apos;"); expect(initialsOf("The Witcher 3")).toBe("T3"); expect(initialsOf("")).toBe("?"); });
});
