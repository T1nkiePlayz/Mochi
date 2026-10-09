// Fails when launcher styles paint with hard-coded colours or fonts instead of --mochi-* tokens, so every theme
// (built-in or user-installed) can restyle every element. Themes themselves (src/themes), the token definitions
// (src/styles/tokens.css) and generated files are exempt.
//
// Existing offenders are recorded in scripts/token-usage-baseline.json (file -> allowed count) and may only shrink:
// fix a literal, then run `node scripts/check-token-usage.mjs --update` to lower the baseline.
// A single line can opt out with a trailing `/* token-ok: reason */` (CSS) or `// token-ok: reason` (TSX).
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = "src";
const BASELINE = "scripts/token-usage-baseline.json";
const EXEMPT = [/^src\/themes\//, /^src\/styles\/tokens\.css$/, /^src\/styles\/fonts\.generated\.css$/, /\.test\.tsx?$/];
const COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(|(?<![\w-])(?:white|black|red|green|blue|yellow|orange|purple|pink|gray|grey|cyan|magenta)(?![\w-])(?=\s*[;,)}!]|\s*$)/g;
const FONT = /font-family\s*:\s*(?!var\(|inherit|initial|unset)[^;}]*(?:"[^"]+"|'[^']+')/g;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out); else out.push(path);
  }
  return out;
}

/** Counts offending literals in CSS text; comments and lines marked token-ok are skipped. */
export function cssViolations(css) {
  const found = [];
  const text = css.replace(/\/\*(?!\s*token-ok)[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  text.split("\n").forEach((line, index) => {
    if (/token-ok/.test(line)) return;
    for (const match of line.matchAll(COLOR)) found.push({ line: index + 1, text: match[0] });
    for (const match of line.matchAll(FONT)) found.push({ line: index + 1, text: match[0].slice(0, 40) });
  });
  return found;
}

/** Inline style={{ ... }} blocks in components may not carry colour literals either. */
export function inlineStyleViolations(source) {
  const found = [];
  source.split("\n").forEach((line, index) => {
    if (!/style=\{\{|style=\{[a-zA-Z]/.test(line) || /token-ok/.test(line)) return;
    for (const match of line.matchAll(/#[0-9a-fA-F]{3,8}\b|\brgba?\(/g)) found.push({ line: index + 1, text: match[0] });
  });
  return found;
}

if (process.argv[1]?.endsWith("check-token-usage.mjs")) {
  const counts = {};
  const detail = {};
  for (const file of walk(ROOT)) {
    const rel = relative(".", file).replace(/\\/g, "/");
    if (EXEMPT.some((pattern) => pattern.test(rel))) continue;
    let hits = [];
    if (rel.endsWith(".css")) hits = cssViolations(readFileSync(file, "utf8"));
    else if (/\.tsx$/.test(rel)) hits = inlineStyleViolations(readFileSync(file, "utf8"));
    if (hits.length) { counts[rel] = hits.length; detail[rel] = hits; }
  }
  if (process.argv.includes("--update")) {
    writeFileSync(BASELINE, JSON.stringify(counts, null, 2) + "\n");
    console.log(`baseline updated: ${Object.values(counts).reduce((a, b) => a + b, 0)} literals in ${Object.keys(counts).length} files`);
    process.exit(0);
  }
  const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : {};
  const errors = [];
  for (const [file, count] of Object.entries(counts)) {
    const allowed = baseline[file] ?? 0;
    if (count > allowed) errors.push(`${file}: ${count} hard-coded colour/font literal(s), ${allowed} allowed. Use var(--mochi-*) tokens:\n` + detail[file].slice(0, 8).map((h) => `    line ${h.line}: ${h.text}`).join("\n"));
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (process.argv.includes("--verbose")) for (const [file, hits] of Object.entries(detail)) console.log(file, hits.length);
  if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
  console.log(`✓ token usage: ${total} legacy literal(s) in ${Object.keys(counts).length} file(s), none new`);
}
