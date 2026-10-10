import { readJson, writeJson } from "./storage";

/** Colours for the one automatic per-game theme: a game's own accent is laid over the current theme while its page is open. */
export type GameAccent = { accent: string; accentStrong: string; accentText: string; accentSoft: string };

const HEX = /^#([0-9a-f]{6})$/i;
export const isHexColor = (value: unknown): value is string => typeof value === "string" && HEX.test(value);

type Hsl = [number, number, number];

function toHsl(hex: string): Hsl {
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

function fromHsl([h, s, l]: Hsl): string {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return "#" + [r, g, b].map((value) => Math.round((value + m) * 255).toString(16).padStart(2, "0")).join("");
}

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((at) => { const v = parseInt(hex.slice(at, at + 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contrast = (a: string, b: string) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]; return (hi + 0.05) / (lo + 0.05); };

/**
 * The most characteristic colour of an image: pixels are grouped by hue, weighted by how vivid and bright they are,
 * and the heaviest group wins. Greys, near-black and near-white are ignored. `null` for a colourless image.
 */
export function dominantColor(data: ArrayLike<number>): string | null {
  const bins = Array.from({ length: 12 }, () => ({ weight: 0, r: 0, g: 0, b: 0 }));
  for (let at = 0; at + 3 < data.length; at += 4) {
    if ((data[at + 3] ?? 0) < 200) continue;
    const r = data[at] ?? 0, g = data[at + 1] ?? 0, b = data[at + 2] ?? 0;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (max < 40 || min > 225 || max - min < 28) continue;
    const saturation = (max - min) / max;
    const weight = saturation * saturation * (max / 255);
    const [hue] = toHsl("#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join(""));
    const bin = bins[Math.floor(hue / 30) % 12]!;
    bin.weight += weight; bin.r += r * weight; bin.g += g * weight; bin.b += b * weight;
  }
  const best = bins.reduce((top, bin) => (bin.weight > top.weight ? bin : top));
  if (best.weight <= 0) return null;
  return "#" + [best.r, best.g, best.b].map((value) => Math.round(value / best.weight).toString(16).padStart(2, "0")).join("");
}

/** Makes `hex` readable as an accent on the theme's background: lightness is moved until the contrast is enough. */
export function accentFor(hex: string, scheme: "light" | "dark", background: string): GameAccent {
  let [h, s, l] = toHsl(hex);
  s = Math.min(1, Math.max(s, 0.35));
  l = scheme === "dark" ? Math.max(l, 0.55) : Math.min(l, 0.42);
  let accent = fromHsl([h, s, l]);
  for (let step = 0; step < 12 && contrast(accent, background) < 3; step++) {
    l = scheme === "dark" ? Math.min(0.92, l + 0.04) : Math.max(0.12, l - 0.04);
    accent = fromHsl([h, s, l]);
  }
  const strong = fromHsl([h, s, scheme === "dark" ? Math.max(0.2, l - 0.14) : Math.min(0.8, l + 0.14)]);
  const text = contrast(accent, "#101010") >= contrast(accent, "#ffffff") ? "#101010" : "#ffffff";
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(accent.slice(at, at + 2), 16));
  return { accent, accentStrong: strong, accentText: text, accentSoft: `rgba(${r},${g},${b},.14)` };
}

export const GAME_THEME_STYLE_ID = "mochi-game-theme";

/** The style rule that lays a game's accent over the theme. Values are generated colours, never user text. */
export function gameThemeCss(accent: GameAccent): string {
  return `@layer reset, tokens, base, layout, theme, user;\n@layer user {\n:root {\n  --mochi-accent: ${accent.accent};\n  --mochi-accent-strong: ${accent.accentStrong};\n  --mochi-accent-text: ${accent.accentText};\n  --mochi-accent-soft: ${accent.accentSoft};\n}\n}`;
}

export const gameAccentsKey = "mochi:game-accents";
const MAX_REMEMBERED = 300;

export function readGameAccents(): Record<string, string> {
  const raw = readJson<unknown>(gameAccentsKey, {});
  if (!raw || typeof raw !== "object") return {};
  return Object.fromEntries(Object.entries(raw).filter(([, value]) => isHexColor(value)));
}
export function rememberGameAccent(key: string, hex: string) {
  const all = readGameAccents();
  delete all[key];
  all[key] = hex;
  const entries = Object.entries(all);
  writeJson(gameAccentsKey, Object.fromEntries(entries.slice(Math.max(0, entries.length - MAX_REMEMBERED))));
}
