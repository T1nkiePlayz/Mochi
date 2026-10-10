import { describe, expect, it } from "vitest";
import { launcherLanguages } from "./languages";
import { translate } from "./i18n";

describe("shared UI translations", () => {
  it("translates core setup and shell messages for every supported non-English language", () => {
    for (const language of launcherLanguages) {
      if (language.code === "en") continue;
      for (const message of ["Loading…", "Not found.", "Get started", "Back", "Skip", "Next", "Finish", "Language", "Theme", "Accessibility", "Account", "Sign in", "Sign out", "Settings", "General", "Activity", "No active downloads", "Nothing is downloading right now.", "Your games, your way.", "Choose your language.", "Choose your theme.", "Make Mochi comfortable.", "Find your games.", "Connected", "Main navigation", "Search languages…", "Light", "Dark"]) {
        expect(translate(message, language.code), `${language.code}: ${message}`).not.toBe(message);
      }
    }
  });

  it("falls back to the original text for unknown messages and unsupported locales", () => {
    expect(translate("A new string")).toBe("A new string");
    expect(translate("Loading…", "not-a-language")).toBe("Loading…");
  });

  it("uses navigation translations from the existing catalogue", () => {
    expect(translate("Library", "fr")).toBe("Bibliothèque");
    expect(translate("Downloads", "ja")).toBe("ダウンロード");
  });
});
