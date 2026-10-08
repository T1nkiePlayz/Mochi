import { describe, expect, it } from "vitest";
import { buildTokenSheet, getBuiltinThemes, isGoogleFontsUrl, isSafeCssValue, loadTheme, type LoadedTheme } from "./theme";

const base: LoadedTheme = { schemaVersion: 1, id: "t", name: "T", version: "1", source: "user", css: "", assetUrls: {} };

describe("theme token sheet", () => {
  it("drops values that could break out of the declaration", () => {
    const sheet = buildTokenSheet({ ...base, colors: { good: "#fff", evil: "red; } body { display:none", c: "a /* x */", n: 5 as never } });
    expect(sheet).toContain("--mochi-good: #fff;");
    expect(sheet).not.toContain("evil");
    expect(sheet).not.toContain("display:none");
    expect(sheet).not.toContain("--mochi-c");
    expect(sheet).not.toContain("--mochi-n");
  });
  it("escapes asset urls", () => {
    const sheet = buildTokenSheet({ ...base, assetUrls: { logo: 'x"); } body{x:y', "icon:play": "asset://a b.svg" } });
    expect(sheet).not.toMatch(/url\("[^"]*"\);\s*}\s*body/);
    expect(sheet).toContain('--mochi-asset-logo: url("x%22); } body{x:y");');
  });
  it("accepts every built-in theme token", async () => {
    for (const descriptor of getBuiltinThemes()) {
      const theme = await loadTheme(descriptor);
      const sections = [theme.colors, theme.ui, theme.typography, theme.layout, theme.effects, theme.components];
      for (const section of sections) for (const value of Object.values(section ?? {})) expect(isSafeCssValue(value), `${theme.id}: ${value}`).toBe(true);
    }
  });
  it("only allows https google fonts css", () => {
    expect(isGoogleFontsUrl("https://fonts.googleapis.com/css2?family=A")).toBe(true);
    expect(isGoogleFontsUrl("http://fonts.googleapis.com/css2")).toBe(false);
    expect(isGoogleFontsUrl("https://fonts.googleapis.com.evil.com/css")).toBe(false);
    expect(isGoogleFontsUrl("https://u@fonts.googleapis.com/css")).toBe(false);
  });
});
