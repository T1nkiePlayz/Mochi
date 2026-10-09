import { describe, expect, it } from "vitest";
import type { Tofu } from "../../models";
import { planRestore } from "./manifest";
import type { TofuManifest } from "./instances";

const tofu = (over: Partial<Tofu>): Tofu => ({ id: "default", name: "Default", version: "Local", runtime: "Native", mods: 0, status: "Ready", ...over });
const mod = (file: string) => ({ file, subdir: "", enabled: true, source: "manual", projectId: "", fileId: "", version: "", title: file });

describe("restoring Tofus from .mochi/tofus.json", () => {
  const manifest: TofuManifest = { schema: 1, generator: "Mochi", updatedAt: 1, activeTofuId: "ui", tofus: [
    { id: "vanilla-plus", name: "Vanilla+", version: "0.217", separate: false, mods: [mod("a.dll"), mod("b.dll")] },
    { id: "ui", name: "UI pack", loader: "weird", separate: true, mods: [mod("c.dll")] },
  ] };
  const base = tofu({ path: "/g/BepInEx/plugins", gameDir: "/g/BepInEx/plugins", launch: { wrappers: ["gamemode"], args: "", env: "" } });

  it("reuses the default Tofu for the first saved one and adds the rest on the same folder", () => {
    let n = 0;
    const plan = planRestore([base], base, manifest, new Set(["default"]), () => `new-${++n}`);
    expect(plan.tofus.map((t) => [t.id, t.name, t.mods])).toEqual([["default", "Vanilla+", 2], ["ui", "UI pack", 1]]);
    expect(plan.tofus[0].launch?.wrappers).toEqual(["gamemode"]);
    expect(plan.tofus[1]).toMatchObject({ path: "/g/BepInEx/plugins", gameDir: "/g/BepInEx/plugins" });
    expect(plan.tofus[1]).not.toHaveProperty("loader");
    expect(plan.records.map((r) => r.tofuId)).toEqual(["default", "ui"]);
    expect(plan.activeTofuId).toBe("ui");
  });

  it("matches existing ids and never reuses an id taken elsewhere", () => {
    const existing = [base, tofu({ id: "ui", name: "Old name" })];
    const plan = planRestore(existing, base, manifest, new Set(["default", "ui", "vanilla-plus"]), () => "fresh");
    expect(plan.tofus.map((t) => [t.id, t.name])).toEqual([["default", "Vanilla+"], ["ui", "UI pack"]]);
    const elsewhere = planRestore([base], base, { ...manifest, tofus: [manifest.tofus[0], { ...manifest.tofus[1], id: "taken" }] }, new Set(["default", "taken"]), () => "fresh");
    expect(elsewhere.tofus.map((t) => t.id)).toEqual(["default", "fresh"]);
  });
});
