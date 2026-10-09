// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { Star } from "lucide-react";
import { MochiIcon } from "./MochiIcon";

afterEach(() => { cleanup(); document.documentElement.style.removeProperty("--mochi-icon-star"); });

describe("MochiIcon", () => {
  it("shares one theme listener across every icon", () => {
    const add = vi.spyOn(window, "addEventListener");
    render(<>{Array.from({ length: 25 }, (_, index) => <MochiIcon key={index} name="star" fallback={Star} />)}</>);
    expect(add.mock.calls.filter(([type]) => type === "mochi-theme-changed")).toHaveLength(1);
    add.mockRestore();
  });
  it("picks up a theme icon after the theme-changed event", () => {
    const { container } = render(<MochiIcon name="star" fallback={Star} />);
    expect(container.querySelector(".mochi-icon-custom")).toBeNull();
    document.documentElement.style.setProperty("--mochi-icon-star", 'url("/star.png")');
    act(() => { window.dispatchEvent(new Event("mochi-theme-changed")); });
    expect(container.querySelector(".mochi-icon-custom")).not.toBeNull();
  });
});
