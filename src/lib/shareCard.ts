import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import type { Piko } from "../models";
import { analyse, formatDuration, type SessionRecord } from "./stats";

export type SharePeriod = "all" | "30";
export type ShareOptions = { games: boolean; playtime: boolean; achievements: boolean; account: boolean; period: SharePeriod };
export const defaultShareOptions: ShareOptions = { games: true, playtime: true, achievements: true, account: false, period: "all" };

export type CardGame = { gameId: string; name: string; seconds: number };
/** Only what the user chose to share is present; anything switched off is absent, never merely hidden. */
export type CardData = {
  periodLabel: string;
  account?: string;
  totalSeconds?: number;
  achievements?: { unlocked: number; total: number };
  games?: CardGame[];
};
export type CardPalette = { background: string; surface: string; border: string; text: string; muted: string; accent: string; accentText: string; fontBody: string; fontDisplay: string };
/** Cover images as data URLs, keyed by game id. A game without one is drawn with its initials. */
export type CardCovers = Record<string, string | undefined>;

export const CARD_WIDTH = 1080;
export const CARD_HEIGHT = 1080;
export const MAX_CARD_GAMES = 5;
const MAX_COVER_BYTES = 2_000_000;

export function topGamesOf(records: SessionRecord[], period: SharePeriod, now = Date.now()): { games: CardGame[]; totalSeconds: number } {
  if (period === "30") {
    const analysis = analyse(records, 30, now);
    return { games: analysis.games.map(({ gameId, name, seconds }) => ({ gameId, name, seconds })), totalSeconds: analysis.totalSeconds };
  }
  const byGame = new Map<string, CardGame>();
  let totalSeconds = 0;
  for (const record of records) {
    if (record.seconds <= 0) continue;
    totalSeconds += record.seconds;
    const entry = byGame.get(record.gameId);
    if (entry) entry.seconds += record.seconds; else byGame.set(record.gameId, { gameId: record.gameId, name: record.name, seconds: record.seconds });
  }
  return { games: [...byGame.values()].sort((a, b) => b.seconds - a.seconds), totalSeconds };
}

export function buildCardData(input: { records: SessionRecord[]; library: Piko[]; unlocked: number; totalAchievements: number; username: string; options: ShareOptions; now?: number }): CardData {
  const { records, library, options } = input;
  const { games, totalSeconds } = topGamesOf(records, options.period, input.now);
  const data: CardData = { periodLabel: options.period === "30" ? "Last 30 days" : "All time" };
  if (options.account && input.username.trim()) data.account = input.username.trim();
  if (options.playtime) data.totalSeconds = totalSeconds;
  if (options.achievements) data.achievements = { unlocked: input.unlocked, total: input.totalAchievements };
  if (options.games) data.games = games.slice(0, MAX_CARD_GAMES).map((game) => ({ ...game, name: library.find((piko) => piko.id === game.gameId)?.name ?? game.name }));
  return data;
}

export const escapeXml = (value: string) => value.replace(/[<>&"']/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[ch] ?? ch);
export const initialsOf = (name: string) => { const words = name.trim().split(/\s+/).filter(Boolean); return ((words[0]?.[0] ?? "?") + (words.length > 1 ? words[words.length - 1]?.[0] ?? "" : "")).toUpperCase(); };
const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);
/** Only inline raster data URLs are embedded: nothing the SVG renderer could fetch from the network. */
const safeCover = (value: string | undefined) => (value && /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(value) ? value : undefined);
const safeColor = (value: string, fallback: string) => (/^[#a-z0-9(),.%\s-]+$/i.test(value) && value.trim() ? value.trim() : fallback);
const safeFont = (value: string, fallback: string) => (value.trim() ? value.replace(/["<>&]/g, "").trim() : fallback);

export function buildCardSvg(data: CardData, palette: CardPalette, covers: CardCovers = {}): string {
  const color = { bg: safeColor(palette.background, "#0b0f0e"), surface: safeColor(palette.surface, "#141d19"), border: safeColor(palette.border, "#2a3a32"), text: safeColor(palette.text, "#e4eee8"), muted: safeColor(palette.muted, "#91a69a"), accent: safeColor(palette.accent, "#b9dbc8"), accentText: safeColor(palette.accentText, "#102019") };
  const body = safeFont(palette.fontBody, "system-ui, sans-serif");
  const display = safeFont(palette.fontDisplay, body);
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}" role="img" aria-label="Mochi stats card">`);
  parts.push(`<rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="${color.bg}"/>`);
  parts.push(`<rect x="24" y="24" width="${CARD_WIDTH - 48}" height="${CARD_HEIGHT - 48}" rx="28" fill="${color.surface}" stroke="${color.border}" stroke-width="2"/>`);
  parts.push(`<text x="72" y="116" font-family="${body}" font-size="26" letter-spacing="4" fill="${color.accent}">MOCHI</text>`);
  parts.push(`<text x="72" y="184" font-family="${display}" font-size="62" font-weight="800" fill="${color.text}">${data.account ? escapeXml(clip(`${data.account}'s stats`, 26)) : "Play stats"}</text>`);
  parts.push(`<text x="72" y="228" font-family="${body}" font-size="28" fill="${color.muted}">${escapeXml(data.periodLabel)}</text>`);
  let y = 290;
  const tiles: Array<[string, string]> = [];
  if (data.totalSeconds !== undefined) tiles.push(["TIME PLAYED", formatDuration(data.totalSeconds)]);
  if (data.achievements) tiles.push(["ACHIEVEMENTS", `${data.achievements.unlocked} / ${data.achievements.total}`]);
  if (tiles.length) {
    const width = (CARD_WIDTH - 144 - (tiles.length - 1) * 24) / tiles.length;
    tiles.forEach(([label, value], i) => {
      const x = 72 + i * (width + 24);
      parts.push(`<rect x="${x}" y="${y}" width="${width}" height="150" rx="20" fill="${color.bg}" stroke="${color.border}" stroke-width="2"/>`);
      parts.push(`<text x="${x + 28}" y="${y + 50}" font-family="${body}" font-size="22" letter-spacing="3" fill="${color.muted}">${label}</text>`);
      parts.push(`<text x="${x + 28}" y="${y + 114}" font-family="${display}" font-size="56" font-weight="800" fill="${color.text}">${escapeXml(value)}</text>`);
    });
    y += 190;
  }
  if (data.games) {
    parts.push(`<text x="72" y="${y + 20}" font-family="${body}" font-size="22" letter-spacing="3" fill="${color.muted}">TOP GAMES</text>`);
    y += 48;
    if (!data.games.length) parts.push(`<text x="72" y="${y + 50}" font-family="${body}" font-size="28" fill="${color.muted}">No games played in this period.</text>`);
    const max = data.games[0]?.seconds || 1;
    data.games.forEach((game, i) => {
      const top = y + i * 96;
      const cover = safeCover(covers[game.gameId]);
      if (cover) {
        parts.push(`<clipPath id="c${i}"><rect x="72" y="${top}" width="80" height="80" rx="14"/></clipPath><image href="${cover}" x="72" y="${top}" width="80" height="80" preserveAspectRatio="xMidYMid slice" clip-path="url(#c${i})"/>`);
      } else {
        parts.push(`<rect x="72" y="${top}" width="80" height="80" rx="14" fill="${color.accent}"/><text x="112" y="${top + 52}" text-anchor="middle" font-family="${display}" font-size="34" font-weight="800" fill="${color.accentText}">${escapeXml(initialsOf(game.name))}</text>`);
      }
      parts.push(`<text x="176" y="${top + 32}" font-family="${body}" font-size="30" font-weight="700" fill="${color.text}">${escapeXml(clip(game.name, 30))}</text>`);
      parts.push(`<text x="${CARD_WIDTH - 72}" y="${top + 32}" text-anchor="end" font-family="${body}" font-size="28" fill="${color.muted}">${escapeXml(formatDuration(game.seconds))}</text>`);
      parts.push(`<rect x="176" y="${top + 52}" width="${CARD_WIDTH - 248}" height="12" rx="6" fill="${color.bg}"/><rect x="176" y="${top + 52}" width="${Math.max(10, Math.round(((CARD_WIDTH - 248) * game.seconds) / max))}" height="12" rx="6" fill="${color.accent}"/>`);
    });
  }
  parts.push(`<text x="${CARD_WIDTH - 72}" y="${CARD_HEIGHT - 56}" text-anchor="end" font-family="${body}" font-size="20" fill="${color.muted}">Generated locally by Mochi</text>`);
  parts.push("</svg>");
  return parts.join("");
}

const cssVar = (style: CSSStyleDeclaration, name: string) => style.getPropertyValue(name).trim();
/** Reads the current theme's colours and fonts from the computed `--mochi-*` custom properties. */
export function readPalette(element: Element = document.documentElement): CardPalette {
  const style = getComputedStyle(element);
  return {
    background: cssVar(style, "--mochi-background"), surface: cssVar(style, "--mochi-surface"), border: cssVar(style, "--mochi-border"), text: cssVar(style, "--mochi-text"),
    muted: cssVar(style, "--mochi-text-muted"), accent: cssVar(style, "--mochi-accent"), accentText: cssVar(style, "--mochi-accent-text"),
    fontBody: cssVar(style, "--mochi-font-body"), fontDisplay: cssVar(style, "--mochi-font-display"),
  };
}

/** Fetches a locally cached cover (asset protocol or data URL) and inlines it. Anything else, or any failure, yields undefined so the card falls back to initials. */
export async function coverToDataUrl(url: string | null | undefined): Promise<string | undefined> {
  if (!url) return undefined;
  if (!url.startsWith("data:") && !/^(asset|http:\/\/asset\.localhost|https:\/\/asset\.localhost)/.test(url)) return undefined; // never the network
  try {
    const blob = await (await fetch(url)).blob();
    if (!/^image\/(png|jpeg|webp|gif)$/.test(blob.type) || blob.size > MAX_COVER_BYTES) return undefined;
    return await new Promise<string | undefined>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : undefined); reader.onerror = () => resolve(undefined); reader.readAsDataURL(blob); });
  } catch { return undefined; }
}

export const svgDataUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/** SVG -> canvas -> PNG. The SVG only references inline data, so the canvas is never tainted. */
export function svgToPng(svg: string, scale = 1): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = CARD_WIDTH * scale; canvas.height = CARD_HEIGHT * scale;
      const context = canvas.getContext("2d");
      if (!context) { reject(new Error("Canvas is not available.")); return; }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not encode the image."))), "image/png");
    };
    image.onerror = () => reject(new Error("Could not render the card."));
    image.src = svgDataUrl(svg);
  });
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Opens a save dialog and writes the PNG. Resolves to false when cancelled. */
export async function savePng(blob: Blob): Promise<boolean> {
  const destination = await save({ title: "Save share card", defaultPath: "mochi-stats.png", filters: [{ name: "PNG image", extensions: ["png"] }] });
  if (!destination) return false;
  await invoke<void>("write_share_card", { destination, dataBase64: await blobToBase64(blob) });
  return true;
}

export const canCopyImage = () => typeof ClipboardItem !== "undefined" && Boolean(navigator.clipboard?.write);

/** "copied", or "unsupported" where the webview has no image clipboard (some WebKitGTK builds). */
export async function copyPng(blob: Blob): Promise<"copied" | "unsupported"> {
  if (!canCopyImage()) return "unsupported";
  try { await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]); return "copied"; } catch { return "unsupported"; }
}
