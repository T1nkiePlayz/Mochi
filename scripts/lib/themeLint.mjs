// Layout lint for theme packages. Shared by scripts/check-themes.mjs (built-in themes) and the app (user themes).
// The launcher's protected layout layer (src/styles/layout.css) already neutralises most of these, so findings are
// warnings that explain what will be ignored, not errors.

/** Classes that make up the window shell and dialogs; sizing/positioning them from a theme is ignored or harmful. */
const SHELL = /(^|[\s>+~,(])(\.(sidebar|primary-nav|sidebar-bottom|sidebar-account-wrap|sidebar-account|main-content|app-shell|topbar|topbar-actions|content|modal-backdrop|modal|breadcrumb|search-box|brand)\b|html\b|body\b|#root\b|main\b|aside\b)/;
const SIZE_PROPS = new Set(["width", "min-width", "max-width", "height", "min-height", "max-height", "flex", "flex-basis", "flex-shrink"]);
const FIXED_PX = /^-?\d+(\.\d+)?px$/;

/** Required palette; a user theme that omits one falls back to Mochi's default for it. */
export const REQUIRED_COLORS = ["background", "backgroundElevated", "surface", "surfaceRaised", "surfaceHover", "border", "borderStrong", "text", "textStrong", "textMuted", "textFaint", "accent", "accentStrong", "accentText", "accentSoft", "success", "warning", "danger", "shadow"];

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** @returns {Array<{ selector: string, property: string, message: string }>} */
export function lintThemeCss(css) {
  const out = [];
  const source = stripComments(String(css ?? ""));
  if (/@import\b/i.test(source)) out.push({ selector: "@import", property: "", message: "@import is ignored (themes cannot load remote or other stylesheets); inline the CSS or use theme.json \"fonts\"." });
  // Flat scan of `selector { declarations }`; at-rule wrappers (@media, @layer) are looked through by the regex.
  for (const match of source.matchAll(/([^{}@;]+)\{([^{}]*)\}/g)) {
    const selector = match[1].trim().replace(/\s+/g, " ");
    if (!SHELL.test(" " + selector) || /::?(before|after)\b/.test(selector)) continue;
    for (const declaration of match[2].split(";")) {
      const colon = declaration.indexOf(":");
      if (colon < 0) continue;
      const property = declaration.slice(0, colon).trim().toLowerCase();
      const value = declaration.slice(colon + 1).trim();
      const important = /!important/i.test(value);
      const bare = value.replace(/!important/i, "").trim();
      const add = (message) => out.push({ selector, property, message });
      const last = selector.split(",").map((part) => part.trim().split(/[\s>+~]+/).pop() ?? "");
      const onShell = last.some((part) => /^(\.(sidebar|primary-nav|main-content|app-shell|topbar|content|modal|modal-backdrop|sidebar-account-wrap)|html|body|main|aside|#root)(?![\w-])/.test(part));
      const px = FIXED_PX.test(bare) ? parseFloat(bare) : 0;
      const wide = /^(min-)?width$|^flex-basis$/.test(property) && px >= 340;
      const tall = /^(min-)?height$/.test(property) && px >= 200;
      if (onShell && SIZE_PROPS.has(property) && (wide || tall)) {
        add(`fixed ${property}: ${bare} on a shell element is clamped by the layout layer on small windows; prefer the layout tokens (sidebarWidth, topbarHeight, contentMaxWidth).`);
      }
      if (/(^|[^-])\b(100vw)\b/.test(bare) && SIZE_PROPS.has(property)) add(`${property}: ${bare} includes the scrollbar and can cause sideways scrolling; use 100%.`);
      if (property === "position" && /^(fixed|absolute)$/.test(bare) && onShell && /\.(sidebar|primary-nav|main-content|topbar|content|app-shell)\b/.test(selector)) add(`position: ${bare} on a shell element is overridden where it would take the element out of the layout flow.`);
      if (property === "display" && bare === "none" && onShell && /^\.(sidebar|primary-nav|main-content|topbar|content)\b/.test(selector)) add(`display: none on ${selector.split(/[\s,]/)[0]} would hide the app's navigation or content; use the shell preset in theme.json instead.`);
      if (important && onShell && (SIZE_PROPS.has(property) || property === "overflow" || property === "overflow-x" || property === "position" || property === "display")) add(`!important on layout property ${property} loses to the protected layout layer.`);
      if ((property === "overflow" || property === "overflow-x") && bare === "hidden" && /^\.(content|main-content)\b/.test(selector)) add(`${property}: hidden on ${selector.split(/[\s,]/)[0]} can clip content that should scroll.`);
    }
  }
  return out;
}

/** Manifest-level findings: missing palette entries and layout tokens that are unusable. */
export function lintManifest(manifest) {
  const out = [];
  const colors = manifest?.colors ?? {};
  for (const key of REQUIRED_COLORS) if (!colors[key]) out.push({ selector: "theme.json", property: `colors.${key}`, message: `missing; falls back to Mochi's default (a mixed palette can look inconsistent).` });
  if (!manifest?.scheme) out.push({ selector: "theme.json", property: "scheme", message: "missing; native controls such as scrollbars default to dark." });
  const ui = { ...(manifest?.ui ?? {}), ...(manifest?.layout ?? {}) };
  for (const key of ["sidebarWidth", "topbarHeight", "contentMaxWidth", "contentPadding"]) {
    const value = ui[key];
    if (value !== undefined && /(^|\s)(\d+(\.\d+)?)(vw|vh)\b/.test(String(value)) && key === "sidebarWidth") out.push({ selector: "theme.json", property: `ui.${key}`, message: "viewport units for the sidebar width are clamped to 176-340px." });
  }
  return out;
}
