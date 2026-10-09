/**
 * Theme CSS is loaded into a cascade layer (`theme` for built-in themes, `user` for installed ones) that sits above
 * the launcher's `base` and below its protected `layout` layer (src/styles/layout.css), so no theme can break the shell.
 */
export type ThemeLayer = "theme" | "user";

/** Re-serialises untrusted CSS through the browser's parser so a stray `}` cannot close the layer early; drops `@import`. */
export function normaliseCss(css: string): string {
  try {
    if (typeof CSSStyleSheet === "undefined") return css;
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    return [...sheet.cssRules].filter((rule) => rule.constructor.name !== "CSSImportRule").map((rule) => rule.cssText).join("\n");
  } catch {
    return css;
  }
}

export function layerThemeCss(css: string, layer: ThemeLayer): string {
  const body = layer === "user" ? normaliseCss(css) : css;
  return `@layer ${layer} {\n${body}\n}`;
}
