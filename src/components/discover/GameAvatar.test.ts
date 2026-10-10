// @vitest-environment jsdom
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { GameAvatar, hueOf, initialsOf } from "./GameAvatar";

afterEach(cleanup);

describe("game avatar fallbacks", () => {
  it("makes initials from the name", () => {
    expect(initialsOf("Balatro")).toBe("BA");
    expect(initialsOf("RuneScape: Dragonwilds")).toBe("RD");
    expect(initialsOf("  ")).toBe("?");
  });

  it("keeps the colour stable per name and inside the hue range", () => {
    expect(hueOf("Terraria")).toBe(hueOf("Terraria"));
    expect(hueOf("Terraria")).toBeGreaterThanOrEqual(0);
    expect(hueOf("Terraria")).toBeLessThan(360);
  });

  it("tries each fallback image in order after a load error", () => {
    const { container } = render(createElement(GameAvatar, {
      src: "https://example.invalid/primary.png",
      fallbackSrcs: ["https://example.invalid/secondary.png", "https://example.invalid/tertiary.png"],
      name: "Example Game",
    }));
    const image = () => container.querySelector("img");
    expect(image()?.getAttribute("src")).toBe("https://example.invalid/primary.png");

    fireEvent.error(image()!);
    expect(image()?.getAttribute("src")).toBe("https://example.invalid/secondary.png");

    fireEvent.error(image()!);
    expect(image()?.getAttribute("src")).toBe("https://example.invalid/tertiary.png");

    fireEvent.error(image()!);
    expect(image()).toBeNull();
    expect(container.querySelector(".game-avatar-initials")?.textContent).toBe("EG");
  });

  it("uses a fallback when the primary URL is missing", () => {
    const { container } = render(createElement(GameAvatar, {
      fallbackSrcs: ["https://example.invalid/secondary.png"],
      name: "Example Game",
    }));
    expect(container.querySelector("img")?.getAttribute("src")).toBe("https://example.invalid/secondary.png");
  });

  it("deduplicates fallback URLs so a failed primary is not retried", () => {
    const { container } = render(createElement(GameAvatar, {
      src: "https://example.invalid/primary.png",
      fallbackSrcs: ["https://example.invalid/primary.png", "https://example.invalid/secondary.png"],
      name: "Example Game",
    }));
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("https://example.invalid/secondary.png");
  });
});
