import { describe, expect, it } from "vitest";
import { safeHttpUrl, sanitizeHtml, textOf, type SafeNode } from "./sanitizeHtml";

const flat = (nodes: SafeNode[]): Array<{ tag: string; attrs: Record<string, string> }> =>
  nodes.flatMap((n) => (typeof n === "string" ? [] : [{ tag: n.tag, attrs: n.attrs }, ...flat(n.children)]));

describe("sanitizeHtml XSS payloads", () => {
  const payloads = [
    `<script>alert(1)</script>`, `<img src=x onerror=alert(1)>`, `<a href="javascript:alert(1)">x</a>`, `<a href="  jav&#x09;ascript:alert(1)">x</a>`,
    `<svg onload=alert(1)><circle/></svg>`, `<iframe src="https://evil"></iframe>`, `<a href="data:text/html,<script>1</script>">x</a>`,
    `<style>body{display:none}</style>`, `<math><mi xlink:href="javascript:1">`, `<img src="https://evil.example/pixel.gif">`,
    `<div style="background:url(javascript:1)" onclick="1">t</div>`, `<a href="vbscript:1">x</a>`, `<object data="x"></object>`,
  ];
  for (const payload of payloads) {
    it(`neutralises ${payload.slice(0, 40)}`, () => {
      const items = flat(sanitizeHtml(payload));
      for (const item of items) {
        expect(["script", "svg", "iframe", "style", "object", "math"]).not.toContain(item.tag);
        for (const [name, value] of Object.entries(item.attrs)) {
          expect(name.startsWith("on")).toBe(false);
          expect(name).not.toBe("style");
          if (name === "href" || name === "src") expect(value).toMatch(/^https?:\/\//);
        }
        if (item.tag === "img") expect(item.attrs.src).toBeUndefined();
      }
    });
  }
  it("keeps allowed images only from allow-listed https hosts", () => {
    const [ok] = flat(sanitizeHtml(`<img src="https://media.forgecdn.net/a.png" alt="a">`));
    expect(ok?.attrs.src).toBe("https://media.forgecdn.net/a.png");
    expect(flat(sanitizeHtml(`<img src="http://media.forgecdn.net/a.png">`))).toHaveLength(0);
  });
  it("safeHttpUrl rejects obfuscated schemes", () => {
    expect(safeHttpUrl("java\nscript:alert(1)")).toBeNull();
    expect(safeHttpUrl("//example.com/x")).toBe("https://example.com/x");
  });
  it("does not hang on pathological input", () => {
    const start = performance.now();
    sanitizeHtml(`<a "`.repeat(60_000));
    sanitizeHtml("<".repeat(250_000));
    sanitizeHtml(`<div>`.repeat(50_000));
    expect(performance.now() - start).toBeLessThan(5000);
  });
  it("text content is decoded but never becomes markup", () => {
    expect(textOf(sanitizeHtml("a &lt;script&gt; b"))).toBe("a <script> b");
  });
});
