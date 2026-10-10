// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { focusElement } from "./spatial";

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
