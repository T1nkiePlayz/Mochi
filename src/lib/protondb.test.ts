import { describe, expect, it } from "vitest";
import { protonAdvice, protonDbUrl, protonTierLabel, type ProtonTier } from "./protondb";

describe("protondb helpers", () => {
  it("has a label and advice for every tier", () => {
    for (const tier of ["native", "platinum", "gold", "silver", "bronze", "borked"] as ProtonTier[]) {
      expect(protonTierLabel(tier)).toMatch(/^[A-Z]/);
      expect(protonAdvice(tier).length).toBeGreaterThan(10);
    }
  });
  it("links to the game's ProtonDB page", () => expect(protonDbUrl(220)).toBe("https://www.protondb.com/app/220"));
});
