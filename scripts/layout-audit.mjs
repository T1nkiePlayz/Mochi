#!/usr/bin/env node
// Responsive layout audit. Drives the dev mock (src/devMock.ts) in a private headless Chromium,
// for every theme x window size x screen, and reports layout problems: horizontal page scroll,
// elements outside the viewport, content clipped by overflow:hidden, truncated text without a title,
// dialogs taller than the viewport and overlapping navigation. Not part of CI (needs a browser).
//
//   npm run dev                                   # in one terminal (default http://localhost:5173)
//   node scripts/layout-audit.mjs                 # full matrix (slow); see --help
//   node scripts/layout-audit.mjs --themes minecraft-ore,mochi --sizes 480x800,1024x768 --screens library,settings --shots
//
// Needs `playwright` (or playwright-core) and a Chromium: install with `npm i -D playwright --no-save`
// or point PLAYWRIGHT_MODULE at an existing install (path to the playwright-core package directory).
import { createRequire } from "node:module";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const args = Object.fromEntries(process.argv.slice(2).map((arg, index, all) => {
  if (!arg.startsWith("--")) return [];
  const [key, inline] = arg.slice(2).split("=");
  return [key, inline ?? (all[index + 1] && !all[index + 1].startsWith("--") ? all[index + 1] : true)];
}).filter((pair) => pair.length));
if (args.help) {
  console.log("Options: --base URL --themes a,b|all --sizes WxH,... --screens a,b|all --zoom 1,1.5 --out DIR --shots --coverage --max N --json");
  process.exit(0);
}

const base = String(args.base ?? "http://localhost:5173");
const outDir = resolve(String(args.out ?? "audit-out"));
const THEMES = readdirSync("src/themes", { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
const DEFAULT_SIZES = "320x640,480x800,640x800,800x600,1024x768,1280x800,1600x900,2560x1440,3840x2160,1000x1040,1280x400,1024x2160";
const SCREENS = ["setup", "library", "details", "settings", "stats", "downloads", "installed", "discover", "bigpicture", "modal-add", "modal-edit", "account-menu"];
const themes = !args.themes || args.themes === "all" ? THEMES : String(args.themes).split(",");
const sizes = String(args.sizes ?? DEFAULT_SIZES).split(",").map((size) => size.split("x").map(Number));
const screens = !args.screens || args.screens === "all" ? SCREENS : String(args.screens).split(",");
const zooms = String(args.zoom ?? "1").split(",").map(Number);

function loadPlaywright() {
  const candidates = [process.env.PLAYWRIGHT_MODULE, "playwright", "playwright-core"].filter(Boolean);
  const require = createRequire(import.meta.url);
  for (const candidate of candidates) {
    try { return require(candidate); } catch { /* try the next one */ }
  }
  console.error("Playwright not found. Install it (npm i --no-save playwright) or set PLAYWRIGHT_MODULE=/path/to/playwright-core.");
  process.exit(2);
}
const { chromium } = loadPlaywright();

// A library with awkward data: long names, unbroken words, many tags, several Tofu instances.
const SEED_NAMES = ["Minecraft", "Stardew Valley", "Subnautica: Below Zero Deluxe Collector's Edition", "Terraria", "Hades", "Celeste",
  "SupercalifragilisticexpialidociousEditionOfTheGameWithNoSpacesAtAll", "A", "The Legend of Some Extremely Long Named Adventure Game: Part II - The Return of the Long Title",
  "Balatro", "RuneScape: Dragonwilds", "Minecraft Dungeons", "Fallout 4", "Cyberpunk 2077"];
const seedLibrary = () => SEED_NAMES.map((name, index) => ({
  id: `seed-${index}`, name, description: "Seeded by the layout audit. ".repeat(index % 3 === 0 ? 12 : 2), accent: "#7aa2f7", artwork: "",
  kind: "game", source: "custom", categories: ["Action", "Adventure", "A very long category name that keeps going"].slice(0, 1 + (index % 3)),
  tags: index % 2 ? ["cozy", "co-op", "a-tag-with-a-really-long-name-that-should-wrap"] : [], favorite: index % 4 === 0,
  tofus: [{ id: `t-${index}`, name: index % 2 ? "Default instance with a long name" : "Default", mods: index }, { id: `u-${index}`, name: "Second", mods: 0 }],
}));

// Runs inside the page: returns a list of problems for the current screen.
function measure() {
  const issues = [];
  // The app fills in titles for truncated text on hover/focus; do the same so "no title" only reports real gaps.
  for (const el of document.body.querySelectorAll("*")) if (getComputedStyle(el).textOverflow === "ellipsis") el.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const describe = (el) => {
    const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/).slice(0, 3).join(".") : "";
    const text = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 24);
    return `${el.tagName.toLowerCase()}${cls ? "." + cls : ""}${text ? ` "${text}"` : ""}`;
  };
  const visible = (el) => {
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const add = (type, el, detail) => issues.push({ type, selector: describe(el), detail });

  const root = document.documentElement;
  if (root.scrollWidth > vw + 1) add("page-hscroll", root, `scrollWidth ${root.scrollWidth} > ${vw}`);
  if (document.body.scrollWidth > vw + 1) add("page-hscroll", document.body, `body scrollWidth ${document.body.scrollWidth} > ${vw}`);

  // Clip rectangle of an element = intersection of ancestors that hide overflow.
  const clippers = (el) => {
    const list = [];
    for (let parent = el.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (style.position === "fixed") break;
      const x = style.overflowX, y = style.overflowY;
      if (x !== "visible" || y !== "visible") list.push({ parent, x, y });
    }
    return list;
  };

  const all = [...document.body.querySelectorAll("*")].filter((el) => !el.closest("svg") || el.tagName === "svg");
  for (const el of all) {
    if (!visible(el)) continue;
    if (el.closest("[data-audit-ignore], [aria-live], .stats-sr, .skip-link, .sr-only, [class*='sr-only'], .visually-hidden")) continue;
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();

    // 1. Text clipped or truncated.
    const ownText = [...el.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim());
    if (ownText && style.display !== "inline" && ["hidden", "clip"].includes(style.overflowX) && el.scrollWidth > el.clientWidth + 1) {
      if (style.textOverflow === "ellipsis") {
        if (!el.title && !el.closest("[title]") && !el.getAttribute("aria-label")) add("truncated-no-title", el, `${el.scrollWidth}>${el.clientWidth}`);
      } else add("text-clipped-x", el, `${el.scrollWidth}>${el.clientWidth}`);
    }
    if (ownText && ["hidden", "clip"].includes(style.overflowY) && el.scrollHeight > el.clientHeight + 2 && style.webkitLineClamp === "none" && style.display !== "inline") {
      add("text-clipped-y", el, `${el.scrollHeight}>${el.clientHeight}`);
    }

    // 2. Outside the viewport / cut by a hiding ancestor. Scrollable ancestors are fine.
    const chain = clippers(el);
    const scrollable = chain.some(({ x }) => x === "auto" || x === "scroll") || chain.some(({ parent }) => getComputedStyle(parent).textOverflow === "ellipsis");
    if (!scrollable) {
      let limitRight = vw, limitLeft = 0, by = "viewport";
      for (const { parent, x } of chain) {
        if (x === "hidden" || x === "clip") {
          const box = parent.getBoundingClientRect();
          if (box.right < limitRight) { limitRight = box.right; by = describe(parent); }
          if (box.left > limitLeft) { limitLeft = box.left; by = describe(parent); }
        }
      }
      const fixedOrAbs = ["fixed", "absolute"].includes(style.position);
      if ((rect.right > limitRight + 1 || rect.left < limitLeft - 1) && !(fixedOrAbs && chain.length === 0 && style.position === "absolute" && rect.left >= 0 && rect.right <= vw + 1)) {
        const interactive = el.matches("button, a, input, select, textarea, [role='button'], [role='tab']");
        const textual = ownText || el.matches("h1,h2,h3,h4,h5,h6,p,label,strong,span,li,td,th,img");
        if (interactive || textual) add("outside-clip", el, `x ${Math.round(rect.left)}..${Math.round(rect.right)} vs ${Math.round(limitLeft)}..${Math.round(limitRight)} by ${by}`);
      }
    }
    if (rect.right < 0 || rect.left > vw) { /* parked off-screen on purpose (drawer etc.), ignore */ }

    // 3. Controls too small to be reached.
    if (el.matches("button, [role='button'], input:not([type='hidden']), select") && (rect.width < 24 || rect.height < 24) && !el.closest("[data-audit-ignore]") && vw < 900) {
      if (!(el.matches("input[type='checkbox'], input[type='radio']"))) add("small-target", el, `${Math.round(rect.width)}x${Math.round(rect.height)}`);
    }
  }

  // 4. Dialogs must fit the viewport (internally scrollable).
  for (const modal of document.querySelectorAll(".modal, [role='dialog']")) {
    if (!visible(modal)) continue;
    const rect = modal.getBoundingClientRect();
    if (rect.height > vh + 1 || rect.top < -1 || rect.bottom > vh + 1) add("dialog-height", modal, `top ${Math.round(rect.top)} bottom ${Math.round(rect.bottom)} vh ${vh}`);
    if (rect.width > vw + 1 || rect.left < -1 || rect.right > vw + 1) add("dialog-width", modal, `left ${Math.round(rect.left)} right ${Math.round(rect.right)} vw ${vw}`);
  }

  // 5. Navigation buttons must not overlap each other or leave the viewport.
  const navs = [...document.querySelectorAll(".primary-nav .nav-item, .sidebar-bottom .nav-item, .topbar-actions > *, .sidebar-account")].filter(visible);
  for (let i = 0; i < navs.length; i++) {
    for (let j = i + 1; j < navs.length; j++) {
      const a = navs[i].getBoundingClientRect(), b = navs[j].getBoundingClientRect();
      const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (overlapX > 2 && overlapY > 2 && !navs[i].contains(navs[j]) && !navs[j].contains(navs[i])) add("nav-overlap", navs[i], `with ${describe(navs[j])}`);
    }
  }
  return issues;
}

// Theme coverage (--coverage): controls that still look like browser defaults, and text with too little contrast.
function coverage() {
  const issues = [];
  const describe = (el) => `${el.tagName.toLowerCase()}${typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : ""} "${(el.textContent || el.value || "").trim().replace(/\s+/g, " ").slice(0, 20)}"`;
  const parse = (value) => { const m = value.match(/rgba?\(([^)]+)\)/); if (!m) return null; const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r, g, b, a }; };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const background = (el) => {
    let layers = [];
    for (let node = el; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.backgroundImage !== "none") return null; // gradients and artwork: not measurable here
      const c = parse(style.backgroundColor);
      if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
    }
    let base = { r: 0, g: 0, b: 0 }; const root = parse(getComputedStyle(document.documentElement).backgroundColor); if (root && root.a > 0) base = root;
    for (const c of layers.reverse()) base = { r: base.r * (1 - c.a) + c.r * c.a, g: base.g * (1 - c.a) + c.g * c.a, b: base.b * (1 - c.a) + c.b * c.a };
    return base;
  };
  const shown = (el) => { const st = getComputedStyle(el); const r = el.getBoundingClientRect(); return st.display !== "none" && st.visibility !== "hidden" && r.width > 0 && r.height > 0; };
  for (const el of document.body.querySelectorAll("button, input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=hidden]), select, textarea")) {
    if (!shown(el)) continue;
    const st = getComputedStyle(el);
    const bg = parse(st.backgroundColor);
    const defaultButton = el.tagName === "BUTTON" && bg && [239, 240, 233, 227].includes(bg.r) && bg.a === 1 && st.borderTopWidth !== "0px" && st.borderTopStyle === "outset";
    const defaultField = el.tagName !== "BUTTON" && st.borderTopStyle === "inset";
    if (defaultButton || defaultField) issues.push({ type: "unthemed-control", selector: describe(el), detail: `bg ${st.backgroundColor} border ${st.borderTopStyle}` });
  }
  for (const el of document.body.querySelectorAll("*")) {
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) || !shown(el) || el.closest("[aria-hidden='true'], .stats-sr, .visually-hidden")) continue;
    const st = getComputedStyle(el);
    const fg = parse(st.color); const bg = background(el);
    if (!fg || !bg || st.opacity === "0") continue;
    const a = lum({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a) }); const b = lum(bg);
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    const op = Number(st.opacity);
    if (ratio < 3 && op > 0.5 && !el.disabled && !el.closest("[disabled], [aria-disabled='true']")) issues.push({ type: "low-contrast", selector: describe(el), detail: `${ratio.toFixed(2)}:1 ${st.color} on rgb(${bg.r | 0},${bg.g | 0},${bg.b | 0})` });
  }
  return issues;
}

async function openNav(page, index) {
  // Narrow windows hide the sidebar behind the menu button.
  const menu = page.locator(".mobile-menu").first();
  if (await menu.isVisible().catch(() => false)) await menu.click();
  await page.evaluate((i) => {
    const items = [...document.querySelectorAll(".primary-nav .nav-item, .sidebar-bottom .nav-item")];
    items[i]?.click();
  }, index);
  await page.waitForTimeout(250);
}

const NAV_INDEX = { stats: 4, downloads: 3, installed: 1, discover: 2, settings: 5, library: 0 };

async function prepare(page, screen) {
  if (screen === "setup" || screen === "library") return;
  if (screen in NAV_INDEX) return openNav(page, NAV_INDEX[screen]);
  if (screen === "details") {
    await page.evaluate(() => document.querySelector(".game-card, .library-row, [class*='game-card']")?.click());
    await page.waitForTimeout(300);
  } else if (screen === "bigpicture") {
    await page.evaluate(() => document.querySelector("[aria-label='Open Big Picture mode']")?.click());
    await page.waitForTimeout(700);
  } else if (screen === "modal-add") {
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => /add game|add a game|add piko/i.test(b.textContent + (b.getAttribute("aria-label") || "")))?.click());
    await page.waitForTimeout(300);
  } else if (screen === "modal-edit") {
    await page.evaluate(() => document.querySelector("[aria-label*='Edit' i], [title*='Edit' i]")?.click());
    await page.waitForTimeout(300);
  } else if (screen === "account-menu") {
    await page.evaluate(() => document.querySelector(".sidebar-account")?.click());
    await page.waitForTimeout(200);
  }
}

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined });
const results = [];
let total = 0;
for (const theme of themes) {
  for (const [width, height] of sizes) {
    for (const zoom of zooms) {
      // Text size (150%) is emulated with the root font size; OS zoom with deviceScaleFactor-independent CSS pixels.
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
      await context.addInitScript(({ theme, withSetup, seed }) => {
        try {
          if (!localStorage.getItem("mochi:pikos")) localStorage.setItem("mochi:pikos", JSON.stringify(seed));
          localStorage.setItem("mochi:theme", theme);
          if (withSetup) localStorage.setItem("mochi:setup-complete", "true"); else localStorage.removeItem("mochi:setup-complete");
        } catch { /* storage blocked */ }
      }, { theme, withSetup: true, seed: seedLibrary() });
      for (const screen of screens) {
        const page = await context.newPage();
        try {
          if (screen === "setup") await page.addInitScript(() => { try { localStorage.removeItem("mochi:setup-complete"); } catch { /* */ } });
          await page.goto(base, { waitUntil: "load" });
          await page.waitForSelector(screen === "setup" ? ".setup-shell, .setup, main, #root > *" : ".app-shell, .bp-root, [class*='bigpicture']", { timeout: 8000 }).catch(() => {});
          await page.waitForFunction((id) => document.documentElement.dataset.mochiTheme === id, theme, { timeout: 8000 }).catch(() => {});
          if (zoom !== 1) await page.evaluate((value) => { document.documentElement.style.fontSize = `${value * 100}%`; }, zoom);
          await page.waitForTimeout(350);
          await prepare(page, screen);
          const issues = await page.evaluate(measure);
          if (args.coverage) issues.push(...(await page.evaluate(coverage)));
          total += issues.length;
          results.push({ theme, width, height, zoom, screen, issues });
          if (args.shots) {
            const dir = join(outDir, "shots", theme);
            mkdirSync(dir, { recursive: true });
            await page.screenshot({ path: join(dir, `${screen}-${width}x${height}${zoom === 1 ? "" : `-z${zoom}`}.png`) });
          }
        } catch (error) {
          results.push({ theme, width, height, zoom, screen, issues: [{ type: "audit-error", selector: screen, detail: String(error).slice(0, 160) }] });
        }
        await page.close();
      }
      await context.close();
      process.stderr.write(`${theme} ${width}x${height}${zoom === 1 ? "" : ` z${zoom}`}: ${results.filter((r) => r.theme === theme && r.width === width && r.height === height && r.zoom === zoom).reduce((n, r) => n + r.issues.length, 0)} issues\n`);
    }
  }
}
await browser.close();

// Summaries: by type, then the unique (type, screen, selector) offenders with the smallest window that shows them.
const byType = {};
const unique = new Map();
for (const result of results) {
  for (const issue of result.issues) {
    byType[issue.type] = (byType[issue.type] ?? 0) + 1;
    const key = `${issue.type}|${result.screen}|${issue.selector}`;
    const entry = unique.get(key) ?? { ...issue, screen: result.screen, count: 0, themes: new Set(), minWidth: Infinity, example: "" };
    entry.count++;
    entry.themes.add(result.theme);
    if (result.width < entry.minWidth) { entry.minWidth = result.width; entry.example = `${result.theme} ${result.width}x${result.height}: ${issue.detail}`; }
    unique.set(key, entry);
  }
}
const rows = [...unique.values()].sort((a, b) => b.count - a.count);
const limit = Number(args.max ?? 60);
const lines = [
  `# Layout audit`,
  ``,
  `${results.length} page checks (${themes.length} themes x ${sizes.length} sizes x ${zooms.length} zoom x ${screens.length} screens), **${total} issues**, ${rows.length} unique.`,
  ``,
  `| Type | Count |`, `| --- | ---: |`,
  ...Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([type, count]) => `| ${type} | ${count} |`),
  ``,
  `## Worst offenders`,
  ``,
  `| Type | Screen | Element | Hits | Themes | Example |`, `| --- | --- | --- | ---: | ---: | --- |`,
  ...rows.slice(0, limit).map((row) => `| ${row.type} | ${row.screen} | \`${row.selector.replace(/\|/g, "/")}\` | ${row.count} | ${row.themes.size} | ${row.example.replace(/\|/g, "/")} |`),
];
writeFileSync(join(outDir, "report.md"), lines.join("\n") + "\n");
if (args.json) writeFileSync(join(outDir, "report.json"), JSON.stringify(results, null, 1));
console.log(lines.join("\n"));
