import { describe, expect, it } from "vitest";
import { translateCommandGroup, translatePaletteSubtitle } from "./paletteTranslations";

describe("command palette group localization", () => {
  const french = (message: string) => message === "Settings" ? "Paramètres" : message;

  it("keeps the Recent prefix stable while translating the generated group", () => {
    expect(translateCommandGroup("Recent · Settings", french)).toBe("Recent · Paramètres");
  });

  it("applies the same group localization to subtitles", () => {
    expect(translatePaletteSubtitle("Recent · Settings", french)).toBe("Recent · Paramètres");
  });
});
