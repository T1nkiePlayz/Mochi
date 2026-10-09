import { describe, expect, it } from "vitest";
import { SOUND_EVENTS } from "./events";
import { resolveSoundPack } from "./resolve";
import { normalizeSoundSettings, defaultSoundSettings } from "./settings";
import { BUILTIN_PACKS, renderBuiltin } from "./synth";
import { soundAllowed } from "./engine";
import type { SoundPackInfo } from "./packs";

const pack: SoundPackInfo = { id: "clicks", name: "Clicks", version: "1", author: "", description: "", events: ["select"], volume: 1, sizeBytes: 10 };

describe("sound packs", () => {
  it("resolves the user's choice, the theme's pack and falls back to mochi", () => {
    expect(resolveSoundPack("theme", undefined, [])).toEqual({ id: "mochi" });
    expect(resolveSoundPack("theme", "chiptune", [])).toEqual({ id: "chiptune" });
    expect(resolveSoundPack("theme", "clicks", [pack])).toEqual({ id: "clicks", installed: pack });
    expect(resolveSoundPack("glass", "chiptune", [])).toEqual({ id: "glass" });
    expect(resolveSoundPack("removed", undefined, [pack])).toEqual({ id: "mochi" });
  });

  it("synthesises every event for every built-in pack, within its level", () => {
    for (const builtin of BUILTIN_PACKS) for (const event of SOUND_EVENTS) {
      const samples = renderBuiltin(builtin.id, event, 22050);
      expect(samples.length).toBeGreaterThan(100);
      expect(samples.length).toBeLessThan(22050 * 2);
      const peak = samples.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
      expect(peak).toBeGreaterThan(0.05);
      expect(peak).toBeLessThanOrEqual(0.7);
      expect(Number.isFinite(samples[samples.length >> 1])).toBe(true);
    }
  });

  it("normalises stored settings", () => {
    expect(normalizeSoundSettings(null)).toEqual(defaultSoundSettings);
    expect(normalizeSoundSettings({ volume: 4, pack: "../x", movement: "loud" })).toMatchObject({ volume: 1, pack: "theme", movement: "auto" });
  });

  it("respects mute, scope and movement preferences", () => {
    const base = { ...defaultSoundSettings };
    expect(soundAllowed("select", "bigpicture", base, false)).toBe(true);
    expect(soundAllowed("select", "launcher", base, false)).toBe(false);
    expect(soundAllowed("select", "bigpicture", { ...base, muted: true }, false)).toBe(false);
    expect(soundAllowed("navigate", "bigpicture", base, true)).toBe(false);
    expect(soundAllowed("navigate", "bigpicture", { ...base, movement: "always" }, true)).toBe(true);
    expect(soundAllowed("select", "bigpicture", base, true)).toBe(true);
  });
});
