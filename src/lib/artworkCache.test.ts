import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args), convertFileSrc: (path: string) => `asset://localhost${path}` }));

import { invalidateArtwork, loadArtwork, peekArtwork } from "./artworkCache";

beforeEach(() => { invoke.mockReset(); invalidateArtwork("a"); invalidateArtwork("b"); });

describe("artwork cache", () => {
  it("shares one native call between concurrent loads and remembers the result", async () => {
    invoke.mockResolvedValue({ path: "/c/a.png", version: 7 });
    const [first, second] = await Promise.all([loadArtwork("a"), loadArtwork("a")]);
    expect(first).toBe(second);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(peekArtwork("a")).toBe("asset://localhost/c/a.png?v=7");
    await loadArtwork("a");
    expect(invoke).toHaveBeenCalledTimes(1);
  });
  it("does not remember misses or failures", async () => {
    invoke.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("x")).mockResolvedValueOnce({ path: "data:image/png;base64,AA", version: 0 });
    expect(await loadArtwork("b")).toBeNull();
    expect(await loadArtwork("b")).toBeNull();
    expect(await loadArtwork("b")).toBe("data:image/png;base64,AA");
  });
  it("loads again after invalidation", async () => {
    invoke.mockResolvedValueOnce({ path: "/one.png", version: 1 }).mockResolvedValueOnce({ path: "/two.png", version: 2 });
    await loadArtwork("a");
    invalidateArtwork("a");
    expect(await loadArtwork("a")).toBe("asset://localhost/two.png?v=2");
  });
});
