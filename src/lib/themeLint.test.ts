import { describe, expect, it } from "vitest";
import { lintManifest, lintThemeCss } from "../../scripts/lib/themeLint.mjs";
import { layerThemeCss } from "./themeLayers";
import { pickNavMode } from "./useShellFit";

describe("theme layout lint", () => {
  it("flags fixed shell widths, 100vw and hidden navigation", () => {
    const messages = lintThemeCss(".sidebar{width:600px} body{width:100vw} .topbar{display:none} @import url(x.css);").map((finding) => finding.message).join("\n");
    expect(messages).toMatch(/fixed width: 600px/);
    expect(messages).toMatch(/100vw/);
    expect(messages).toMatch(/display: none/);
    expect(messages).toMatch(/@import/);
  });
  it("leaves cosmetic rules alone", () => {
    expect(lintThemeCss(".sidebar{background:red;border-radius:0;padding:8px} .nav-item{width:82px}")).toEqual([]);
  });
  it("reports a missing palette", () => {
    expect(lintManifest({ colors: { background: "#000" } }).some((finding) => finding.property === "colors.text")).toBe(true);
  });
});

describe("theme layers", () => {
  it("wraps theme css in its layer", () => {
    expect(layerThemeCss(".a{color:red}", "theme")).toBe("@layer theme {\n.a{color:red}\n}");
  });
});

describe("pickNavMode", () => {
  it("takes the widest step that fits and falls back to the drawer", () => {
    expect(pickNavMode((mode) => mode === "tight")).toBe("tight");
    expect(pickNavMode(() => false)).toBe("drawer");
    expect(pickNavMode(() => true)).toBe("full");
  });
});
