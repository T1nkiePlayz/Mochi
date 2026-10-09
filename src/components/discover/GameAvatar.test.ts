import { describe, expect, it } from "vitest";
import { hueOf, initialsOf } from "./GameAvatar";

describe("game avatar fallbacks", () => {
  it("makes initials from the name", () => {
    expect(initialsOf("Balatro")).toBe("BA");
    expect(initialsOf("RuneScape: Dragonwilds")).toBe("RD");
    expect(initialsOf("  ")).toBe("?");
  });
  it("keeps the colour stable per name and inside the hue range", () => {
    expect(hueOf("Terraria")).toBe(hueOf("Terraria"));
    expect(hueOf("Terraria")).toBeGreaterThanOrEqual(0);
    expect(hueOf("Terraria")).toBeLessThan(360);
  });
});
