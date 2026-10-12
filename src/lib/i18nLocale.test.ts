import { describe, expect, it } from "vitest";
import { launcherLanguages } from "./languages";
import { foldLocale } from "./i18nLocalePlugin";
import { getTranslationMessages, referenceTranslate } from "./i18nCatalogues";
import { LOCALE_LOADERS, translate } from "./i18n";
import { navLabel } from "./nav";

/**
 * Safety net for the lazy per-locale fold served as `virtual:mochi-i18n/<locale>`:
 * the flat map + English-source fallback must equal the old synchronous `??` chain
 * (referenceTranslate) for every supported locale and every catalogued message.
 */
describe("per-locale translation folds", () => {
  it("matches referenceTranslate for every locale and every catalogued message", () => {
    const messages = getTranslationMessages();
    const mismatches: string[] = [];
    for (const { code } of launcherLanguages) {
      const folded = foldLocale(code);
      for (const message of messages) {
        // Same English-source fallback translate() applies when the map has no entry.
        const foldedValue = folded[message] ?? message;
        const expected = referenceTranslate(message, code);
        if (foldedValue !== expected) {
          mismatches.push(`${code} — ${JSON.stringify(message)}: fold ${JSON.stringify(foldedValue)} vs reference ${JSON.stringify(expected)}`);
        }
      }
    }
    expect(mismatches.slice(0, 50), `${mismatches.length} fold mismatches`).toEqual([]);
  });

  it("keeps English map-free: the en fold only holds nav labels", () => {
    // translate("…", "en") returns the source text (navLabel handled separately) and never loads
    // an en map, so any catalogue that starts carrying "en" entries would silently drift from the
    // runtime — fail here instead. The en fold may therefore only contain nav labels.
    const folded = foldLocale("en");
    for (const [message, value] of Object.entries(folded)) {
      expect(value, `en fold entry ${JSON.stringify(message)} must be a nav label`).toBe(navLabel(message, "en"));
      expect(navLabel(message, "en"), `en fold entry ${JSON.stringify(message)} must differ from the source text`).not.toBe(message);
    }
  });

  it("has an explicit loader for every non-English launcher language", () => {
    const expected = launcherLanguages.filter((item) => item.code !== "en").map((item) => item.code).sort();
    expect(Object.keys(LOCALE_LOADERS).sort()).toEqual(expected);
  });

  it("keeps runtime translate synchronous: en and unloaded locales fall back to source text", () => {
    // Exercises the real runtime export without loading any virtual module — the exact state
    // bootstrap guarantees for "en", and the documented fallback before ensureLocale resolves.
    expect(translate("Installed", "en")).toBe("Mods & Content"); // navLabel still wins for English
    expect(translate("Loading…", "fr")).toBe("Loading…"); // fr map not loaded here → source text
    expect(translate("A new string")).toBe("A new string");
    expect(translate("Loading…", "not-a-language")).toBe("Loading…");
  });
});
