// Validates every built-in theme: manifest shape, unique ids, asset files, fonts, and token names.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { lintThemeCss } from "./lib/themeLint.mjs";
import { a11yThemeReport, printContrastReport } from "./lib/contrast.mjs";

const root = "src/themes";
const SHELLS = ["left", "right", "top", "bottom", "rail"];
const SECTIONS = ["colors", "ui", "typography", "layout", "effects", "components"];
const REQUIRED_COLORS = ["background", "backgroundElevated", "surface", "surfaceRaised", "surfaceHover", "border", "borderStrong", "text", "textStrong", "textMuted", "textFaint", "accent", "accentStrong", "accentText", "accentSoft", "success", "warning", "danger", "shadow"];

// Token names the launcher actually reads (src/styles/*.css and src/index.css).
const css = ["src/styles/tokens.css", "src/styles/components.css", "src/styles/bridge.css", "src/index.css"].map((file) => readFileSync(file, "utf8")).join("\n");
const defined = new Set([...readFileSync("src/styles/tokens.css", "utf8").matchAll(/--mochi-([a-z0-9-]+)\s*:/g)].map((match) => match[1]));
const kebab = (name) => name.replace(/([a-z])([A-Z])/g, "$1-$2").replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();

const errors = [];
const a11yReports = [];
const defaultsCss = readFileSync("src/styles/tokens.css", "utf8");
const ids = new Set();
for (const folder of readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
  const dir = join(root, folder.name);
  const manifestPath = join(dir, "theme.json");
  if (!existsSync(manifestPath)) { errors.push(`${folder.name}: missing theme.json`); continue; }
  const fail = (message) => errors.push(`${folder.name}: ${message}`);
  let manifest;
  try { manifest = JSON.parse(readFileSync(manifestPath, "utf8")); } catch (error) { fail(`theme.json is not valid JSON (${error.message})`); continue; }

  if (manifest.schemaVersion !== 1) fail("schemaVersion must be 1");
  if (manifest.id !== folder.name) fail(`id "${manifest.id}" must match the folder name`);
  if (ids.has(manifest.id)) fail("duplicate id"); ids.add(manifest.id);
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(manifest.id ?? "")) fail("id may only contain letters, numbers, - and _");
  if (!manifest.name?.trim()) fail("missing name");
  if (manifest.shell && !SHELLS.includes(manifest.shell)) fail(`shell must be one of ${SHELLS.join(", ")}`);
  if (manifest.scheme && !["light", "dark"].includes(manifest.scheme)) fail("scheme must be light or dark");
  if (manifest.soundPack && !["mochi", "chiptune", "glass"].includes(manifest.soundPack)) fail("soundPack must be a built-in sound pack (mochi, chiptune or glass)");
  for (const font of manifest.fonts ?? []) if (!font.startsWith("https://fonts.googleapis.com/css")) fail(`font "${font}" must be a Google Fonts stylesheet`);
  for (const color of REQUIRED_COLORS) if (!manifest.colors?.[color]) fail(`colors.${color} is required`);
  if (!existsSync(join(dir, "theme.css"))) fail("missing theme.css");

  for (const [name, path] of [...Object.entries(manifest.assets ?? {}), ...Object.entries(manifest.icons ?? {})]) {
    if (path.includes("..") || path.startsWith("/")) fail(`asset "${name}" must be a relative path inside the theme`);
    else if (!existsSync(join(dir, path))) fail(`asset "${name}" points at missing file ${path}`);
  }
  if (manifest.colors && manifest.id === folder.name) {
    const report = a11yThemeReport(dir, manifest, defaultsCss);
    a11yReports.push({ id: manifest.id, ...report });
    for (const message of report.errors) fail(`a11y ${message}`);
  }
  for (const section of SECTIONS) {
    for (const key of Object.keys(manifest[section] ?? {})) {
      if (!defined.has(kebab(key)) && !css.includes(`--mochi-${kebab(key)}`)) fail(`${section}.${key} (--mochi-${kebab(key)}) is not a token the launcher reads`);
    }
  }
}

// Fonts: every family a built-in theme references must be bundled (fonts.generated.css) or a system/generic family.
{
  const GENERIC = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-monospace", "ui-sans-serif", "ui-serif", "ui-rounded", "inherit", "initial", "unset"]);
  const bundled = new Set([...(existsSync("src/styles/fonts.generated.css") ? readFileSync("src/styles/fonts.generated.css", "utf8") : "").matchAll(/font-family:\s*"([^"]+)"/g)].map((match) => match[1]));
  const families = (value) => [...String(value).matchAll(/"([^"]+)"|'([^']+)'|([A-Za-z][\w -]*)(?=,|$)/g)].map((match) => (match[1] ?? match[2] ?? match[3]).trim()).filter(Boolean);
  const gaps = new Set();
  for (const folder of readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
    const dir = join(root, folder.name);
    if (!existsSync(join(dir, "theme.json"))) continue;
    let manifest;
    try { manifest = JSON.parse(readFileSync(join(dir, "theme.json"), "utf8")); } catch { continue; }
    const used = [];
    for (const [key, value] of Object.entries(manifest.typography ?? {})) if (/^font|mono/i.test(key)) used.push(...families(value));
    const themeCss = existsSync(join(dir, "theme.css")) ? readFileSync(join(dir, "theme.css"), "utf8") : "";
    for (const match of themeCss.matchAll(/font-family:\s*([^;}]+)/g)) used.push(...families(match[1].replace(/var\([^)]*\)/g, "")));
    for (const family of new Set(used)) {
      if (!GENERIC.has(family.toLowerCase()) && !bundled.has(family)) gaps.add(`${folder.name}: font "${family}" is not bundled; it falls back to the next family (run node scripts/fetch-fonts.mjs after adding it to the theme's fonts list)`);
    }
  }
  for (const gap of gaps) console.warn(`! ${gap}`);
}
// Layout lint: built-in themes must not fight the protected layout layer (src/styles/layout.css).
for (const folder of readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
  const file = join(root, folder.name, "theme.css");
  if (!existsSync(file)) continue;
  for (const finding of lintThemeCss(readFileSync(file, "utf8"))) errors.push(`${folder.name}: layout ${finding.selector} ${finding.message}`);
}
printContrastReport(a11yReports, process.argv.includes("--verbose"));

if (errors.length) {
  console.error(errors.map((error) => `✗ ${error}`).join("\n"));
  process.exit(1);
}
console.log(`✓ ${ids.size} themes valid: ${[...ids].join(", ")}`);
