import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

import { invalidateArtwork, loadArtwork, peekArtwork } from "./artworkCache";

beforeEach(() => { invoke.mockReset(); invalidateArtwork("a"); invalidateArtwork("b"); });

describe("artwork cache", () => {
  it("shares one native call between concurrent loads and remembers the result", async () => {
    invoke.mockResolvedValue("data:image/png;base64,AA");
    const [first, second] = await Promise.all([loadArtwork("a"), loadArtwork("a")]);
    expect(first).toBe(second);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(peekArtwork("a")).toBe("data:image/png;base64,AA");
    await loadArtwork("a");
    expect(invoke).toHaveBeenCalledTimes(1);
  });
  it("does not remember misses or failures", async () => {
    invoke.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("x")).mockResolvedValueOnce("later");
    expect(await loadArtwork("b")).toBeNull();
    expect(await loadArtwork("b")).toBeNull();
    expect(await loadArtwork("b")).toBe("later");
  });
  it("loads again after invalidation", async () => {
    invoke.mockResolvedValueOnce("one").mockResolvedValueOnce("two");
    await loadArtwork("a");
    invalidateArtwork("a");
    expect(await loadArtwork("a")).toBe("two");
  });
});
