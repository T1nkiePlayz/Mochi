// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args), convertFileSrc: (path: string) => path }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("../lib/supabase", () => ({ supabase: null }));
vi.mock("../lib/iconCover", () => ({ applyIconCovers: async () => new Set(), applyLauncherLogos: async () => new Set() }));
vi.mock("./useMetadata", () => ({ cacheArtwork: vi.fn() }));

import { useAddGame } from "./useAddGame";
import type { Piko } from "../models";
import type { ImportedGame } from "../lib/sources";

const instance = (folder: string): ImportedGame => ({ id: `prism:${folder}`, name: folder, source: "prism", launchTarget: `mc-instance://prism/${folder}`, installPath: `/p/${folder}`, minecraft: { version: "1.21", loader: "fabric", gameDir: `/p/${folder}/minecraft` } });

function setup() {
  let library: Piko[] = [];
  const lib = { get library() { return library; }, setLibrary: (next: Piko[] | ((current: Piko[]) => Piko[])) => { library = typeof next === "function" ? next(library) : next; }, setSelectedPikoId: vi.fn(), setSelectedTofuId: vi.fn(), setGameDetailsId: vi.fn() };
  const metadata = { enrichImported: vi.fn(async () => {}), ready: { igdb: false } };
  const jobs = { notify: vi.fn(), startProgress: vi.fn(() => "job"), updateProgress: vi.fn() };
  const hook = renderHook(() => useAddGame(lib as never, metadata as never, false, false, vi.fn(), () => {}, jobs));
  return { hook, jobs, tofus: () => library.find((piko) => piko.id === "minecraft")?.tofus ?? [] };
}

beforeEach(() => { invoke.mockReset(); });

describe("importGames Minecraft mode", () => {
  it("in-place imports the scanned instances without copying", async () => {
    const { hook, tofus } = setup();
    await act(async () => { hook.result.current.importGames([instance("A")], { minecraftMode: "in-place" }); });
    expect(invoke.mock.calls.filter(([cmd]) => cmd === "copy_minecraft_instance")).toEqual([]);
    expect(tofus().map((tofu) => tofu.launchTarget)).toEqual(["mc-instance://prism/A"]);
  });

  it("copy imports only the copies, and not the ones that failed", async () => {
    invoke.mockImplementation(async (cmd: string, args: { launchTarget: string }) => {
      if (cmd !== "copy_minecraft_instance") return undefined;
      if (args.launchTarget.endsWith("/B")) throw "no space left";
      const folder = args.launchTarget.split("/").pop()!;
      return { launchTarget: `mc-instance://prism/${folder}%20(Mochi)`, gameDir: `/p/${folder} (Mochi)/minecraft`, installPath: `/p/${folder} (Mochi)`, name: `${folder} (Mochi)` };
    });
    const { hook, jobs, tofus } = setup();
    await act(async () => { hook.result.current.importGames([instance("A"), instance("B")], { minecraftMode: "copy" }); });
    expect(tofus().map((tofu) => [tofu.name, tofu.launchTarget])).toEqual([["A (Mochi)", "mc-instance://prism/A%20(Mochi)"]]);
    expect(jobs.notify).toHaveBeenCalledWith(expect.stringContaining("not copied"), expect.stringContaining("B: no space left"));
  });

  it("defaults to copying", async () => {
    invoke.mockImplementation(async () => { throw new Error("nope"); });
    const { hook, tofus } = setup();
    await act(async () => { hook.result.current.importGames([instance("A")]); });
    expect(invoke.mock.calls[0]).toEqual(["copy_minecraft_instance", { launchTarget: "mc-instance://prism/A" }]);
    expect(tofus()).toEqual([]);
  });
});
