import { describe, expect, it } from "vitest";
import { navLabel } from "./nav";
import { launcherLanguages } from "./languages";

describe("navigation translations", () => {
  it("keeps stable English ids while translating labels for all supported non-English locales", () => {
    const ids = ["Library", "Installed", "Discover", "Downloads", "Stats", "Deals", "Settings"];
    for (const language of launcherLanguages) {
      if (language.code === "en") continue;
      for (const id of ids) {
        expect(navLabel(id, language.code), `${language.code}:${id}`).not.toBe(id);
      }
    }
  });

  it("preserves the original English labels and safely falls back for unknown labels", () => {
    expect(navLabel("Installed")).toBe("Mods & Content");
    expect(navLabel("Library")).toBe("Library");
    expect(navLabel("Downloads")).toBe("Downloads");
    expect(navLabel("Settings", "unknown")).toBe("Settings");
    expect(navLabel("Custom page", "fr")).toBe("Custom page");
  });
});
