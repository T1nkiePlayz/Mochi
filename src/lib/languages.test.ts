import { afterEach, describe, expect, it, vi } from "vitest";
import { applyLauncherLanguage, DEFAULT_LANGUAGE, launcherLanguages, normalizeLanguage, steamLanguageForLauncher } from "./languages";
import { getTranslationLocale } from "./translationLocale";

afterEach(() => {
  if (typeof document !== "undefined") applyLauncherLanguage("en");
  vi.unstubAllGlobals();
});

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

  it("applies selected languages to the document locale and text direction", () => {
    const documentStub = { documentElement: { lang: "", dir: "" } };
    vi.stubGlobal("document", documentStub);

    applyLauncherLanguage("fr");
    expect(documentStub.documentElement.lang).toBe("fr");
    expect(documentStub.documentElement.dir).toBe("ltr");
    expect(getTranslationLocale()).toBe("fr");

    applyLauncherLanguage("ar");
    expect(documentStub.documentElement.lang).toBe("ar");
    expect(documentStub.documentElement.dir).toBe("rtl");
    expect(getTranslationLocale()).toBe("ar");
  });

  it("maps launcher preferences to Steam's language identifiers", () => {
    expect(steamLanguageForLauncher("pt-BR")).toBe("brazilian");
    expect(steamLanguageForLauncher("zh-Hans")).toBe("schinese");
    expect(steamLanguageForLauncher("zh-Hant")).toBe("tchinese");
    expect(steamLanguageForLauncher("fr")).toBe("french");
    expect(steamLanguageForLauncher("unknown")).toBe("english");
  });
});
