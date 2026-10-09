// WCAG contrast validation for built-in themes (used by scripts/check-themes.mjs).
// Resolves --mochi-* tokens (defaults from tokens.css overlaid by the manifest and simple literals in theme.css)
// into colours and checks the pairs the launcher actually paints. See docs/accessibility.md.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const kebab = (name) => name.replace(/([a-z])([A-Z])/g, "$1-$2").replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();

/** [id, foreground token, background token, minimum ratio, note]. A background token's gradient stops are all checked. */
export const CHECKS = [
  ["text", "text", "background", 4.5], ["text", "text", "background-elevated", 4.5], ["text", "text", "surface", 4.5], ["text", "text", "surface-raised", 4.5],
  ["text-strong", "text-strong", "background", 4.5], ["text-strong", "text-strong", "surface", 4.5], ["text-strong", "text-strong", "surface-raised", 4.5], ["text-strong", "text-strong", "surface-hover", 4.5],
  ["text-muted", "text-muted", "background", 4.5], ["text-muted", "text-muted", "surface", 4.5], ["text-muted", "text-muted", "surface-raised", 4.5],
  ["text", "text", "panel-background", 4.5], ["text", "text", "card-background", 4.5],
  ["text-muted", "text-muted", "panel-background", 4.5], ["text-muted", "text-muted", "card-background", 4.5],
  ["text-faint", "text-faint", "background", 3], ["text-faint", "text-faint", "surface", 3], ["text-faint", "text-faint", "panel-background", 3],
  ["accent-text", "accent", "background", 4.5], ["accent-text", "accent", "surface", 4.5],
  ["button", "button-color", "button-background", 4.5], ["button", "button-color", "button-hover-background", 4.5],
  ["primary", "primary-color", "primary-background", 4.5], ["primary", "primary-color", "primary-hover-background", 4.5],
  ["input", "text", "input-background", 4.5],
  // Destructive buttons (Remove, Stop, Delete): themes repaint these freely, so each is probed from theme.css.
  ["danger-button", "danger-color", "danger-background", 4.5], ["danger-button-hover", "danger-color", "danger-background", 4.5],
  ["danger-text", "danger-color", "modal-background", 4.5], ["danger-text", "danger-color", "surface", 4.5],
  ["stop-button", "danger-color", "danger-background", 4.5], ["stop-button-hover", "danger-color", "danger-background", 4.5],
  ["nav-active", "text-strong", "nav-active-background", 4.5],
  ["status", "success", "surface", 3], ["status", "warning", "surface", 3], ["status", "danger", "surface", 3],
  ["focus-ring", "accent-strong", "background", 3], ["focus-ring", "accent-strong", "surface", 3],
  // Boundaries of inputs/buttons should reach 3:1 too (WCAG 1.4.11); reported as warnings because many themes use soft borders.
  ["border", "input-border", "input-background", 3, "warn"],
];

// ---- colour parsing ---------------------------------------------------------
const NAMED = { transparent: [0, 0, 0, 0], white: [255, 255, 255, 1], black: [0, 0, 0, 1] };

function parseColor(raw) {
  const s = raw.trim().toLowerCase();
  if (NAMED[s]) return [...NAMED[s]];
  let m = s.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let h = m[1];
    if (h.length <= 4) h = [...h].map((c) => c + c).join("");
    if (h.length !== 6 && h.length !== 8) return null;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1];
  }
  m = s.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map((v, i) => (v.endsWith("%") ? (parseFloat(v) / 100) * (i === 3 ? 1 : 255) : parseFloat(v)));
    if (p.length < 3 || p.some(Number.isNaN)) return null;
    return [p[0], p[1], p[2], p[3] ?? 1];
  }
  m = s.match(/^hsla?\(([^)]+)\)$/);
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map((v) => parseFloat(v));
    if (p.length < 3 || p.some(Number.isNaN)) return null;
    const [h, sat, l] = [((p[0] % 360) + 360) % 360, p[1] / 100, p[2] / 100];
    const a = sat * Math.min(l, 1 - l);
    const f = (n) => { const k = (n + h / 30) % 12; return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
    return [f(0), f(8), f(4), p[3] ?? 1];
  }
  return null;
}

const toRgbaString = (c) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${+c[3].toFixed(4)})`;

/** Replace every innermost color-mix(in srgb, A p%, B q%) whose operands are plain colours. */
function reduceColorMix(value) {
  const inner = /color-mix\(\s*in\s+(?:srgb|oklab|oklch|lab|hsl)\s*,\s*([^(),]+(?:\([^()]*\))?)\s*(?:(\d+(?:\.\d+)?)%)?\s*,\s*([^(),]+(?:\([^()]*\))?)\s*(?:(\d+(?:\.\d+)?)%)?\s*\)/;
  let prev;
  let out = value;
  do {
    prev = out;
    out = out.replace(inner, (whole, a, pa, b, pb) => {
      const ca = parseColor(a); const cb = parseColor(b);
      if (!ca || !cb) return whole;
      let wa = pa !== undefined ? +pa / 100 : pb !== undefined ? 1 - +pb / 100 : 0.5;
      let wb = pb !== undefined ? +pb / 100 : 1 - wa;
      const total = wa + wb; const alphaScale = Math.min(1, total); wa /= total; wb /= total;
      const alpha = (ca[3] * wa + cb[3] * wb) * alphaScale;
      const premul = (i) => (ca[i] * ca[3] * wa + cb[i] * cb[3] * wb) / ((ca[3] * wa + cb[3] * wb) || 1);
      return toRgbaString([premul(0), premul(1), premul(2), alpha]);
    });
  } while (out !== prev);
  return out;
}

// ---- token resolution -------------------------------------------------------
function declarations(css, selectorFilter) {
  const result = {};
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const [, selector, body] of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectorFilter(selector.trim())) continue;
    for (const [, name, value] of body.matchAll(/--mochi-([a-z0-9-]+)\s*:\s*([^;]+);?/g)) result[name] = value.trim();
  }
  return result;
}

function resolve(tokens, value, depth = 0) {
  if (depth > 12) return value;
  return value.replace(/var\(\s*--mochi-([a-z0-9-]+)\s*(?:,\s*([^)]*))?\)/g, (_, name, fallback) => {
    const next = tokens[name] ?? fallback;
    return next === undefined ? "transparent" : resolve(tokens, next, depth + 1);
  });
}

/** Colours (rgba) a token paints with: one for a flat colour, several for gradient stops; null if not resolvable. */
function colorsOf(tokens, name) {
  return tokens[name] === undefined ? null : colorsOfValue(tokens, tokens[name]);
}

function colorsOfValue(tokens, raw) {
  const value = reduceColorMix(resolve(tokens, raw));
  if (/url\(/.test(value) && !/gradient/.test(value)) return null;
  const flat = parseColor(value);
  if (flat) return [flat];
  if (!/gradient/.test(value)) return null;
  // Gradients: take each colour stop, ignore the trailing page-colour fallback when present.
  const stops = [...value.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)|\btransparent\b/g)].map((m) => parseColor(m[0])).filter(Boolean);
  return stops.length ? stops : null;
}

/** Last literal value a theme.css rule sets for `prop` on exactly `selector` (ignoring :not(:disabled) and pseudo-element rules). */
function ruleValue(themeCss, selector, props) {
  let found = null;
  const stripped = themeCss.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const [, selectors, body] of stripped.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
    if (!selectors.split(",").some((part) => part.trim().replace(/:not\(:disabled\)/g, "") === selector)) continue;
    for (const prop of props) {
      for (const m of body.matchAll(new RegExp("(?:^|;|\\s)" + prop + "\\s*:\\s*([^;]+)", "g"))) found = m[1].trim().replace(/\s*!important$/, "");
    }
  }
  return found;
}

// theme.css rules that repaint a pair the manifest tokens describe: [check id:background token] -> selector to read.
const RULE_PROBES = {
  "nav-active:nav-active-background": ".nav-item.active",
  "button:button-background": ".secondary-button",
  "button:button-hover-background": ".secondary-button:hover",
  "primary:primary-background": ".play-button",
  "primary:primary-hover-background": ".play-button:hover",
  "danger-button:danger-background": ".danger-outline",
  "danger-button-hover:danger-background": [".danger-outline:hover", ".danger-outline"],
  "stop-button:danger-background": ".stop-button",
  "stop-button-hover:danger-background": [".stop-button:hover", ".stop-button"],
};

const composite = (top, base) => {
  const a = top[3] + base[3] * (1 - top[3]);
  if (a === 0) return [0, 0, 0, 0];
  const mix = (i) => (top[i] * top[3] + base[i] * base[3] * (1 - top[3])) / a;
  return [mix(0), mix(1), mix(2), a];
};

const luminance = ([r, g, b]) => {
  const ch = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
};
export const contrastRatio = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const hex = (c) => "#" + [0, 1, 2].map((i) => Math.round(c[i]).toString(16).padStart(2, "0")).join("");

// ---- theme evaluation -------------------------------------------------------
export function buildTokens(defaultsCss, manifest, themeCss) {
  const tokens = declarations(defaultsCss, (selector) => selector === ":root");
  for (const section of ["colors", "ui", "typography", "layout", "effects", "components"]) {
    for (const [key, value] of Object.entries(manifest[section] ?? {})) tokens[kebab(key)] = String(value);
  }
  // Literal overrides declared in theme.css (root-level only; per-selector overrides are out of scope).
  Object.assign(tokens, declarations(themeCss, (selector) => /^(:root|html|html\[data-mochi-theme[^\]]*\])$/.test(selector)));
  return tokens;
}

export function checkContrast(manifest, defaultsCss, themeCss) {
  const tokens = buildTokens(defaultsCss, manifest, themeCss);
  const exempt = new Set(manifest.a11y?.exempt ?? []);
  const rows = []; const errors = []; const warnings = [];
  if (exempt.size && !manifest.a11y?.reason?.trim()) errors.push(`a11y.exempt requires an a11y.reason explaining why`);
  const pageBase = (colorsOf(tokens, "background") ?? [[11, 15, 14, 1]])[0];
  const baseOf = (bgName) => {
    // Panels sit on the page; only the page colour itself is the opaque base.
    if (bgName === "background") return [pageBase[0], pageBase[1], pageBase[2], 1];
    const surface = colorsOf(tokens, "surface")?.[0];
    return [pageBase[0], pageBase[1], pageBase[2], 1];
  };
  for (const [id, fgName, bgName, min, level = "error"] of CHECKS) {
    let fgs = colorsOf(tokens, fgName); let bgs = colorsOf(tokens, bgName);
    const probes = [RULE_PROBES[`${id}:${bgName}`]].flat().filter(Boolean);
    if (probes.length) {
      const first = (props) => probes.map((probe) => ruleValue(themeCss, probe, props)).find(Boolean) ?? null;
      const color = first(["color"]);
      const background = first(["background", "background-color"]);
      if (color) fgs = colorsOfValue(tokens, color) ?? fgs;
      if (background) bgs = colorsOfValue(tokens, background) ?? bgs;
    }
    if (!fgs || !bgs) continue;
    let worst = Infinity; let worstBg = null; let worstFg = null;
    // Translucent backgrounds are painted over the page colour (and nav/transparent ones over the sidebar).
    const underlay = bgName === "nav-active-background" || bgName.startsWith("button") || bgName.startsWith("primary") || bgName === "danger-background" || bgName === "input-background"
      ? composite(colorsOf(tokens, "surface")[0], [pageBase[0], pageBase[1], pageBase[2], 1]) : baseOf(bgName);
    for (const bg of bgs) {
      const solid = composite(bg, underlay);
      for (const fg of fgs) {
        const ratio = contrastRatio(composite(fg, solid), solid);
        if (ratio < worst) { worst = ratio; worstBg = solid; worstFg = composite(fg, solid); }
      }
    }
    const pass = worst >= min;
    const exempted = !pass && (exempt.has(id) || exempt.has(`${fgName}:${bgName}`) || exempt.has(`*:${bgName}`));
    const row = { id, fg: fgName, bg: bgName, fgHex: hex(worstFg), bgHex: hex(worstBg), ratio: worst, min, status: pass ? "pass" : exempted ? "exempt" : level === "warn" ? "warn" : "FAIL" };
    rows.push(row);
    if (row.status === "FAIL") errors.push(`${id}: ${fgName} ${row.fgHex} on ${bgName} ${row.bgHex} is ${worst.toFixed(2)}:1 (needs ${min}:1)`);
    if (row.status === "warn") warnings.push(`${id}: ${fgName} ${row.fgHex} on ${bgName} ${row.bgHex} is ${worst.toFixed(2)}:1 (recommended ${min}:1)`);
  }
  return { rows, errors, warnings };
}

/** Flags theme.css rules that remove the focus outline without drawing another indicator. */
export function checkFocusOutlines(manifest, themeCss) {
  if ((manifest.a11y?.exempt ?? []).includes("focus-outline")) return [];
  const problems = [];
  const stripped = themeCss.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const [, selector, body] of stripped.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
    if (!/outline\s*:\s*(none|0)\b/.test(body) && !/outline-style\s*:\s*none/.test(body)) continue;
    if (!/:focus/.test(selector)) continue; // only rules that target the focused state
    if (/box-shadow\s*:\s*(?!none)/.test(body) || /border(-color)?\s*:\s*(?!none)/.test(body) || /background/.test(body)) continue;
    problems.push(`removes the focus outline without a replacement: ${selector.trim().replace(/\s+/g, " ").slice(0, 80)}`);
  }
  return problems;
}

export function a11yThemeReport(dir, manifest, defaultsCss) {
  const themeCss = existsSync(join(dir, "theme.css")) ? readFileSync(join(dir, "theme.css"), "utf8") : "";
  const result = checkContrast(manifest, defaultsCss, themeCss);
  for (const problem of checkFocusOutlines(manifest, themeCss)) result.errors.push(`focus-outline: ${problem}`);
  return result;
}

export function printContrastReport(reports, verbose) {
  const pad = (v, n) => String(v).padEnd(n);
  console.log("\nContrast (WCAG 2.2) per built-in theme");
  console.log(pad("theme", 18) + pad("checks", 8) + pad("worst", 9) + pad("failed", 8) + "notes");
  for (const { id, rows, errors, warnings } of reports) {
    const worst = rows.length ? Math.min(...rows.map((r) => r.ratio)) : 0;
    const exempt = rows.filter((r) => r.status === "exempt").length;
    console.log(pad(id, 18) + pad(rows.length, 8) + pad(worst.toFixed(2) + ":1", 9) + pad(errors.length, 8) + [warnings.length ? `${warnings.length} warning(s)` : "", exempt ? `${exempt} exempt` : ""].filter(Boolean).join(", "));
  }
  for (const { id, rows } of reports) {
    const shown = rows.filter((r) => verbose || r.status !== "pass");
    if (!shown.length) continue;
    console.log(`\n  ${id}`);
    for (const r of shown) console.log(`    ${pad(r.status, 7)} ${pad(r.id, 12)} ${pad(r.fg + " on " + r.bg, 46)} ${pad(r.fgHex + "/" + r.bgHex, 17)} ${r.ratio.toFixed(2)}:1 (min ${r.min})`);
  }
}
