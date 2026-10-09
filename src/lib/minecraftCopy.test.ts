import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

import { copiedGame, copyInstances } from "./minecraftCopy";
import type { ImportedGame } from "./sources";

const game = (folder: string): ImportedGame => ({ id: `prism:${folder}`, name: folder, source: "prism", launchTarget: `mc-instance://prism/${encodeURIComponent(folder)}`, installPath: `/p/${folder}`, minecraft: { version: "1.21", loader: "fabric", gameDir: `/p/${folder}/minecraft` } });
const copyOf = (folder: string) => ({ launchTarget: `mc-instance://prism/${encodeURIComponent(`${folder} (Mochi)`)}`, gameDir: `/p/${folder} (Mochi)/minecraft`, installPath: `/p/${folder} (Mochi)`, name: `${folder} (Mochi)` });

beforeEach(() => { invoke.mockReset(); });

describe("copiedGame", () => {
  it("points the game at the copy and keeps the original's version and loader", () => {
    const copy = copiedGame(game("A"), copyOf("A"));
    expect(copy).toMatchObject({ id: "prism:A (Mochi)", name: "A (Mochi)", launchTarget: "mc-instance://prism/A%20(Mochi)", installPath: "/p/A (Mochi)", minecraft: { version: "1.21", loader: "fabric", gameDir: "/p/A (Mochi)/minecraft" } });
  });
});

describe("copyInstances", () => {
  it("copies one at a time and keeps going after a failure", async () => {
    const order: string[] = [];
    invoke.mockImplementation(async (_cmd: string, args: { launchTarget: string }) => {
      order.push(args.launchTarget);
      if (args.launchTarget.endsWith("/B")) throw "disk full";
      return copyOf(decodeURIComponent(args.launchTarget.split("/").pop()!));
    });
    const result = await copyInstances([game("A"), game("B"), game("C")]);
    expect(invoke.mock.calls[0]).toEqual(["copy_minecraft_instance", { launchTarget: "mc-instance://prism/A" }]);
    expect(order).toHaveLength(3);
    expect(result.copied.map((item) => item.name)).toEqual(["A (Mochi)", "C (Mochi)"]);
    expect(result.failed.map((item) => [item.game.name, item.error])).toEqual([["B", "disk full"]]);
  });
});
