// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { GameAvatar } from "./GameAvatar";

afterEach(cleanup);

describe("GameAvatar image fallback", () => {
  it("tries each fallback image in order after a load error", () => {
    const { container } = render(<GameAvatar src="https://example.invalid/primary.png" fallbackSrcs={["https://example.invalid/secondary.png", "https://example.invalid/tertiary.png"]} name="Example Game" />);
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
    const { container } = render(<GameAvatar fallbackSrcs={["https://example.invalid/secondary.png"]} name="Example Game" />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("https://example.invalid/secondary.png");
  });

  it("deduplicates fallback URLs so a failed primary is not retried", () => {
    const { container } = render(<GameAvatar src="https://example.invalid/primary.png" fallbackSrcs={["https://example.invalid/primary.png", "https://example.invalid/secondary.png"]} name="Example Game" />);
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("https://example.invalid/secondary.png");
  });
});
