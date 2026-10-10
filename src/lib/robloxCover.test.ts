import { describe, expect, it } from "vitest";
import type { Piko } from "../models";
import { withRobloxCover } from "./robloxCover";

const piko = (extra: Partial<Piko>): Piko => ({ id: "x", name: "X", description: "", accent: "#000", artwork: "", tofus: [], ...extra });
const roblox = piko({ id: "r", name: "Roblox", artworkSource: "igdb", artworkCacheKey: "rk", artworkUrl: "https://images.igdb.com/r.jpg" });
const sober = piko({ id: "s", name: "Sober (Roblox)", kind: "launcher", launcherId: "sober", artwork: "/launcher.png" });

describe("withRobloxCover", () => {
  it("gives Sober and Mocktail the Roblox IGDB cover but leaves Vinegar artwork alone", () => {
    const mocktail = piko({ id: "m", name: "Mocktail", kind: "launcher", launcherId: "mocktail", artwork: "/mocktail.png" });
    const vinegar = piko({ id: "v", name: "Vinegar", kind: "launcher", launcherId: "vinegar" });
    const [, s, m, v] = withRobloxCover([roblox, sober, mocktail, vinegar]);
    expect([s.artworkCacheKey, s.artworkSource, m.artworkCacheKey, m.artworkSource, v.artworkCacheKey]).toEqual(["rk", "igdb", "rk", "igdb", undefined]);
  });
  it("changes nothing without an IGDB Roblox cover, with custom art, or for other launchers", () => {
    const library = [piko({ ...roblox, artworkSource: "steam" }), sober];
    expect(withRobloxCover(library)).toBe(library);
    const own = piko({ ...sober, artworkSource: "custom" });
    expect(withRobloxCover([roblox, own])[1]).toBe(own);
    const steam = piko({ id: "st", kind: "launcher", launcherId: "steam" });
    expect(withRobloxCover([roblox, steam])[1]).toBe(steam);
  });
  it("is stable once applied", () => {
    const once = withRobloxCover([roblox, sober]);
    expect(withRobloxCover(once)).toBe(once);
  });
});
