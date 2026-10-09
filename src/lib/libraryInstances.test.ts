import { describe, expect, it } from "vitest";
import type { Piko, Tofu } from "../models";
import { instanceLabel, instanceTofus, visibleInstances } from "./libraryInstances";

const tofu = (id: string, name: string, version: string, loader?: Tofu["loader"], launchTarget?: string): Tofu => ({ id, name, version, runtime: "prism", mods: 0, status: "Ready", loader, launchTarget });
const minecraft: Piko = { id: "minecraft", name: "Minecraft", description: "", accent: "#fff", artwork: "", tofus: [
  tofu("a", "Fabric Fun", "1.21.1", "fabric", "mc-instance://prism/a"), tofu("b", "Vanilla 1.20", "1.20.4", "vanilla", "mc-instance://prism/b"), tofu("c", "Plain tofu", "Local") ] };

describe("library instances", () => {
  it("lists only Minecraft Tofus that have a launch target", () => {
    expect(instanceTofus(minecraft).map((item) => item.id)).toEqual(["a", "b"]);
    expect(instanceTofus({ ...minecraft, id: "other" })).toEqual([]);
  });
  it("labels version and loader", () => {
    expect(instanceLabel({ version: "1.20.1", loader: "fabric" })).toBe("1.20.1 · Fabric");
    expect(instanceLabel({ version: "1.20.1", loader: "neoforge" })).toBe("1.20.1 · NeoForge");
    expect(instanceLabel({ version: "1.20.1" })).toBe("1.20.1");
  });
  it("shows every instance without a search or when the Piko itself matches", () => {
    expect(visibleInstances(minecraft, "", false)).toHaveLength(2);
    expect(visibleInstances(minecraft, "mine", true)).toHaveLength(2);
  });
  it("shows only the matching instances for an instance-name search", () => {
    expect(visibleInstances(minecraft, "fabric fun", false).map((item) => item.id)).toEqual(["a"]);
    expect(visibleInstances(minecraft, "1.20", false).map((item) => item.id)).toEqual(["b"]);
    expect(visibleInstances(minecraft, "zzz", false)).toEqual([]);
  });
});
