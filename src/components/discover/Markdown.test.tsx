// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const invoke = vi.fn(async () => undefined);
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => (invoke as (...x: unknown[]) => unknown)(...a) }));

import { Markdown } from "./Markdown";

describe("Markdown from remote descriptions", () => {
  it("renders only http(s) links and images", () => {
    const { container } = render(<Markdown source={"[ok](https://example.com/a) [bad](javascript:alert(1)) [file](file:///etc/passwd) ![x](data:image/svg+xml,<svg onload=1>) ![y](https://example.com/i.png)"} />);
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["https://example.com/a"]);
    expect([...container.querySelectorAll("img")].map((i) => i.getAttribute("src"))).toEqual(["https://example.com/i.png"]);
    expect(container.innerHTML).not.toContain("javascript:");
  });
  it("survives hostile nesting and size", () => {
    expect(() => render(<Markdown source={"*".repeat(30_000) + "[".repeat(20_000)} />)).not.toThrow();
    expect(() => render(<Markdown source={"**a ".repeat(5_000)} />)).not.toThrow();
  });
  it("opens links through the native opener without navigating", () => {
    const { container } = render(<Markdown source="[ok](https://example.com)" />);
    const a = container.querySelector("a")!;
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    a.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(invoke).toHaveBeenCalledWith("open_external_url", { url: "https://example.com/" });
  });
});
