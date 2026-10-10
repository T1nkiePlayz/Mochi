import { describe, expect, it } from "vitest";
import { DEFAULT_LANGUAGE, launcherLanguages, normalizeLanguage, steamLanguageForLauncher } from "./languages";

describe("launcher languages", () => {
  it("offers distinct language codes and readable native labels", () => {
    expect(new Set(launcherLanguages.map((language) => language.code)).size).toBe(launcherLanguages.length);
    expect(launcherLanguages.every((language) => language.name.trim() && language.englishName.trim())).toBe(true);
  });

  it("normalizes locale casing and underscore separators", () => {
    expect(normalizeLanguage("pt_br")).toBe("pt-BR");
    expect(normalizeLanguage("ZH-hant")).toBe("zh-Hant");
    expect(normalizeLanguage("fr-FR")).toBe("fr");
    expect(normalizeLanguage("xx-YY")).toBe(DEFAULT_LANGUAGE);
    expect(normalizeLanguage(null)).toBe(DEFAULT_LANGUAGE);
  });

  it("maps launcher preferences to Steam's language identifiers", () => {
    expect(steamLanguageForLauncher("pt-BR")).toBe("brazilian");
    expect(steamLanguageForLauncher("zh-Hans")).toBe("schinese");
    expect(steamLanguageForLauncher("zh-Hant")).toBe("tchinese");
    expect(steamLanguageForLauncher("fr")).toBe("french");
    expect(steamLanguageForLauncher("unknown")).toBe("english");
  });
});
