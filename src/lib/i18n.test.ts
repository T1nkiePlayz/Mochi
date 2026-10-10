import { describe, expect, it } from "vitest";
import { launcherLanguages } from "./languages";
import { translate } from "./i18n";

describe("shared UI translations", () => {
  it("translates core setup and shell messages for every supported non-English language", () => {
    for (const language of launcherLanguages) {
      if (language.code === "en") continue;
      for (const message of ["Loading…", "Not found.", "Get started", "Back", "Skip", "Next", "Finish", "Language", "Theme", "Accessibility", "Account", "Sign in", "Sign out", "Settings", "General", "Activity", "No active downloads", "Nothing is downloading right now.", "Your games, your way.", "Choose your language.", "Choose your theme.", "Make Mochi comfortable.", "Find your games.", "Connected", "Main navigation", "Search languages…", "Light", "Dark", "Preferences", "Make Mochi yours.", "Display language", "Launcher-wide language preference", "Appearance", "Personalize the launcher", "Open menu", "Search your library", "Clear search", "Notifications", "You’re all caught up.", "Game news", "Launcher behavior", "Launch Mochi on startup", "In-app notifications", "System notifications", "Separate account profiles", "System tray service", "Always active", "Download controls", "Bandwidth limit", "Download schedule", "Start time", "End time", "Clear finished", "Pause all", "Resume all", "Refresh", "Your stores", "On sale", "Free on Epic", "Price watches", "Announcements", "Mod updates", "Free games & deals", "Checking…", "Free now", "Coming soon", "Your collection", "Continue playing", "Add Piko", "What should I play?", "Done selecting", "Select", "Sort by", "No games match.", "Good evening", "Good morning", "Good afternoon", "You're offline. Your library, saves and cached artwork still work.", "Your Mochi library is empty.", "Mochi starts clean. Add a game when you are ready.", "Jump back in", "Show everything", "Category", "Soundtracks & extras", "New Tofu", "Manage", "Your Tofus", "Choose the language Mochi should use wherever a translation is available. Game news will automatically follow this choice. You can change it any time in Settings.", "Themes restyle the whole launcher and apply as soon as you pick one. Change it any time in Settings, where you can also install your own.", "Pick text size, motion and contrast now. These are saved on this device and you can change them any time in Settings.", "Pick what to bring in. Nothing is moved or changed; Mochi just remembers how to start each game or launcher.", "Bring your cloud library with you.", "If you have used Mochi on another device, import the games saved to your account. Mochi merges cloud games into this device and keeps games that exist only here.", "Check and import cloud data", "Your account is ready.", "Connect your Mochi account.", "Your account is connected. Provider keys can be saved securely, and cloud features are ready when you need them.", "Signing in lets you store provider keys securely and sync your library. Your installed games and files stay on this device."]) {
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
