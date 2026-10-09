#!/usr/bin/env node
// Generates the bundled launcher artwork in src/assets/launchers/.
//   <id>.svg        portrait 3:4 cover used as a launcher's game art
//   icons/<id>.svg  square brand tile used in the import and setup screens
// Brand glyphs come from the CC0 `simple-icons` package; brands it lacks use a
// small hand-drawn glyph. Run `npm run build:launcher-art` after changing the table
// and commit the generated files, so the app never needs the package or a network.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as simple from "simple-icons";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "assets", "launchers");

// Hand-drawn 24x24 glyphs for brands simple-icons does not carry.
const glyphs = {
  cube: `<path d="M12 2 3 7l9 5 9-5-9-5z"/><path opacity=".72" d="M3 7v10l9 5V12L3 7z"/><path opacity=".46" d="M21 7v10l-9 5V12l9-5z"/>`,
  bottle: `<path d="M9 2h6v3l-1 1.5V8c2 1 3.5 3 3.5 5.5V20a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-6.5C6.5 11 8 9 10 8V6.5L9 5V2z"/>`,
  shield: `<path fill-rule="evenodd" d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3zm0 4-4 1.5V11c0 2.8 1.7 5.3 4 6.3 2.3-1 4-3.5 4-6.3V7.5L12 6z"/>`,
  prism: `<path fill-rule="evenodd" d="M12 3 3 20h18L12 3zm0 6 4.2 8H7.8L12 9z"/>`,
  grid: `<path d="M3 3h8v8H3zM13 3h8v8h-8zM3 13h8v8H3zM13 13h8v8h-8z"/>`,
  cross: `<path d="M4 4h4l4 5 4-5h4l-6 8 6 8h-4l-4-5-4 5H4l6-8-6-8z"/>`,
  glass: `<path d="M5 3h14l-1.4 8.4A5.6 5.6 0 0 1 13 16v4h3v2H8v-2h3v-4a5.6 5.6 0 0 1-4.6-4.6L5 3z"/>`,
  play: `<path fill-rule="evenodd" d="M4 3h16a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm5.5 4.5v9l7-4.5-7-4.5z"/>`,
  desktop: `<path fill-rule="evenodd" d="M3 4h18a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-7v2h3v2H7v-2h3v-2H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm1 2v9h16V6H4z"/>`,
};

// id -> brand colour, plus a simple-icons export name or a hand-drawn glyph.
const brands = {
  steam: { color: "#1b2838", icon: "siSteam" },
  lutris: { color: "#ff9900", icon: "siLutris" },
  heroic: { color: "#2b6cb0", icon: "siHeroicgameslauncher" },
  bottles: { color: "#c0473d", glyph: "bottle" },
  itch: { color: "#fa5c5c", icon: "siItchdotio" },
  flatpak: { color: "#4a90d9", icon: "siFlatpak" },
  apps: { color: "#5b6477", glyph: "desktop" },
  epic: { color: "#313131", icon: "siEpicgames" },
  gog: { color: "#86328a", icon: "siGogdotcom" },
  battlenet: { color: "#148eff", icon: "siBattledotnet" },
  ea: { color: "#f0453a", icon: "siEa" },
  ubisoft: { color: "#0070ff", icon: "siUbisoft" },
  rockstar: { color: "#fcaf17", icon: "siRockstargames" },
  amazon: { color: "#e68a00", glyph: "play" },
  jagex: { color: "#b8860b", glyph: "shield" },
  "minecraft-bedrock": { color: "#4a8a2e", glyph: "cube" },
  minecraft: { color: "#6b8e23", glyph: "cube" },
  prism: { color: "#b03060", glyph: "prism" },
  multimc: { color: "#3b6ea5", glyph: "grid" },
  polymc: { color: "#7b4fb0", glyph: "grid" },
  atlauncher: { color: "#2e8b57", glyph: "grid" },
  fjord: { color: "#3c7d8c", glyph: "prism" },
  "modrinth-app": { color: "#1bd96a", icon: "siModrinth" },
  curseforge: { color: "#f16436", icon: "siCurseforge" },
  gdlauncher: { color: "#2c5b8a", glyph: "grid" },
  hmcl: { color: "#5c7cfa", glyph: "cube" },
  xmcl: { color: "#4f6d7a", glyph: "cube" },
  lunar: { color: "#3b4b8c", glyph: "play" },
  hytale: { color: "#c98b2b", glyph: "shield" },
  gamejolt: { color: "#2f7f6f", icon: "siGamejolt" },
  emudeck: { color: "#7a3ea8", glyph: "play" },
  crossover: { color: "#d9582b", glyph: "cross" },
  whisky: { color: "#8a5a34", glyph: "glass" },
  retroarch: { color: "#4b4f58", icon: "siRetroarch" },
  esde: { color: "#2f6f8f", glyph: "play" },
  pegasus: { color: "#5a7bd8", glyph: "play" },
  minigalaxy: { color: "#a64d79", glyph: "play" },
  rare: { color: "#3a7ca5", glyph: "play" },
  faugus: { color: "#3f8f6a", glyph: "play" },
  cartridges: { color: "#7a5195", glyph: "play" },
  playonlinux: { color: "#c0392b", glyph: "play" },
  gamehub: { color: "#3d6a8c", glyph: "play" },
  sober: { color: "#e2231a", icon: "siRoblox" },
  vinegar: { color: "#00a2ff", icon: "siRobloxstudio" },
  launcher: { color: "#6a5acd", glyph: "play" },
};

const hex = (value) => [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16));
const toHex = (rgb) => "#" + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
const mix = (a, b, t) => toHex(hex(a).map((v, i) => v + (hex(b)[i] - v) * t));
const luminance = (value) => { const [r, g, b] = hex(value); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };

function glyphMarkup(brand, size, x, y, fill) {
  const scale = size / 24;
  const inner = brand.icon ? `<path d="${simple[brand.icon].path}"/>` : glyphs[brand.glyph];
  return `<g transform="translate(${x} ${y}) scale(${scale})" fill="${fill}">${inner}</g>`;
}

function art(id, brand) {
  const light = mix(brand.color, "#ffffff", 0.22);
  const dark = mix(brand.color, "#000000", 0.5);
  const fill = luminance(brand.color) > 0.62 ? "#1c1c1c" : "#ffffff";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400" role="img" aria-label="${id}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${light}"/><stop offset="1" stop-color="${dark}"/></linearGradient><radialGradient id="h" cx=".3" cy=".18" r=".8"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs><rect width="300" height="400" fill="url(#g)"/><rect width="300" height="400" fill="url(#h)"/><circle cx="150" cy="190" r="96" fill="#000" fill-opacity=".14"/>${glyphMarkup(brand, 128, 86, 126, fill)}</svg>\n`;
}

function icon(id, brand) {
  const light = mix(brand.color, "#ffffff", 0.18);
  const dark = mix(brand.color, "#000000", 0.38);
  const fill = luminance(brand.color) > 0.62 ? "#1c1c1c" : "#ffffff";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" role="img" aria-label="${id}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${light}"/><stop offset="1" stop-color="${dark}"/></linearGradient></defs><rect width="48" height="48" rx="11" fill="url(#g)"/>${glyphMarkup(brand, 26, 11, 11, fill)}</svg>\n`;
}

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "icons"), { recursive: true });
for (const [id, brand] of Object.entries(brands)) {
  if (brand.icon && !simple[brand.icon]) throw new Error(`simple-icons has no ${brand.icon}`);
  if (id !== "flatpak" && id !== "apps") writeFileSync(join(out, `${id}.svg`), art(id, brand));
  writeFileSync(join(out, "icons", `${id}.svg`), icon(id, brand));
}
console.log(`Wrote artwork for ${Object.keys(brands).length} launchers to ${out}`);
