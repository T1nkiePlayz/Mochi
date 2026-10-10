// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { focusElement, moveFocus } from "./spatial";

afterEach(() => {
  document.body.replaceChildren();
  document.documentElement.removeAttribute("data-reduce-motion");
  vi.restoreAllMocks();
});

describe("focusElement scrolling", () => {
  it("uses instant scrolling for Big Picture targets even when CSS could request smooth scrolling", () => {
    const root = document.createElement("div");
    root.setAttribute("data-bp-root", "");
    const button = document.createElement("button");
    root.append(button);
    document.body.append(root);
    const scrollIntoView = vi.fn();
    button.scrollIntoView = scrollIntoView;

    focusElement(button);

    expect(document.activeElement).toBe(button);
    expect(scrollIntoView).toHaveBeenCalledWith({
      block: "nearest",
      inline: "nearest",
      behavior: "instant",
    });
  });

  it("preserves smooth scrolling in the regular launcher UI", () => {
    const button = document.createElement("button");
    document.body.append(button);
    const scrollIntoView = vi.fn();
    button.scrollIntoView = scrollIntoView;

    focusElement(button);

    expect(scrollIntoView).toHaveBeenCalledWith({
      block: "nearest",
      inline: "nearest",
      behavior: "smooth",
    });
  });

  it("uses instant scrolling when controller navigation reaches the end of a Big Picture column", () => {
    const root = document.createElement("div");
    root.setAttribute("data-bp-root", "");
    root.style.overflowY = "auto";
    Object.defineProperty(root, "scrollHeight", { configurable: true, value: 500 });
    Object.defineProperty(root, "clientHeight", { configurable: true, value: 100 });
    const scrollBy = vi.fn();
    Object.defineProperty(root, "scrollBy", { configurable: true, value: scrollBy });
    const button = document.createElement("button");
    button.getClientRects = () => [{ } as DOMRect] as unknown as DOMRectList;
    button.checkVisibility = () => true;
    root.append(button);
    document.body.append(root);
    button.focus();

    expect(moveFocus("down")).toBe(true);
    expect(scrollBy).toHaveBeenCalledWith({ top: 160, behavior: "instant" });
  });

  it("keeps smooth fallback scrolling in the regular launcher", () => {
    const root = document.createElement("div");
    root.style.overflowY = "auto";
    Object.defineProperty(root, "scrollHeight", { configurable: true, value: 500 });
    Object.defineProperty(root, "clientHeight", { configurable: true, value: 100 });
    const scrollBy = vi.fn();
    Object.defineProperty(root, "scrollBy", { configurable: true, value: scrollBy });
    const button = document.createElement("button");
    button.getClientRects = () => [{ } as DOMRect];
    root.append(button);
    document.body.append(root);
    button.focus();

    expect(moveFocus("down")).toBe(true);
    expect(scrollBy).toHaveBeenCalledWith({ top: 160, behavior: "smooth" });
  });

  it("honours reduced-motion settings outside Big Picture", () => {
    document.documentElement.setAttribute("data-reduce-motion", "true");
    const button = document.createElement("button");
    document.body.append(button);
    const scrollIntoView = vi.fn();
    button.scrollIntoView = scrollIntoView;

    focusElement(button);

    expect(scrollIntoView).toHaveBeenCalledWith({
      block: "nearest",
      inline: "nearest",
      behavior: "instant",
    });
  });
});
