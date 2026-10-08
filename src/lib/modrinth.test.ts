import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

import { getModrinthVersions, searchModrinth, updateModFile } from "./modrinth";

beforeEach(() => invoke.mockReset());

describe("modrinth client", () => {
  it("stops paging when the server ignores offset", async () => {
    invoke.mockResolvedValue({ data: Array.from({ length: 100 }, (_, i) => ({ id: String(i) })), cached: false, stale: false, fetchedAt: 0 });
    const all = await getModrinthVersions("p");
    expect(invoke.mock.calls.length).toBeLessThanOrEqual(50);
    expect(all.length).toBeLessThanOrEqual(5000);
  });
  it("tolerates a search reply without hits", async () => {
    invoke.mockResolvedValue({ data: {}, cached: false, stale: false, fetchedAt: 0 });
    expect(await searchModrinth("x")).toEqual([]);
  });
  it("passes the expected sha1 to the update command", async () => {
    invoke.mockResolvedValue(undefined);
    await updateModFile("/m", { versionId: "v", versionNumber: "1", filename: "a.jar", url: "https://cdn.modrinth.com/a.jar", size: 1, sha1: "abc" });
    expect(invoke).toHaveBeenCalledWith("update_mod_file", { path: "/m", url: "https://cdn.modrinth.com/a.jar", filename: "a.jar", sha1: "abc" });
  });
});
