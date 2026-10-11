import { setTranslationLocale } from "./translationLocale";

/** Supported launcher language preferences. Labels are written in each language's own name. */
export const launcherLanguages = [
  { code: "ar", name: "العربية", englishName: "Arabic", locale: "ar", steam: "arabic" },
  { code: "bg", name: "Български", englishName: "Bulgarian", locale: "bg", steam: "bulgarian" },
  { code: "zh-Hans", name: "简体中文", englishName: "Chinese (Simplified)", locale: "zh-Hans", steam: "schinese" },
  { code: "zh-Hant", name: "繁體中文", englishName: "Chinese (Traditional)", locale: "zh-Hant", steam: "tchinese" },
  { code: "cs", name: "Čeština", englishName: "Czech", locale: "cs", steam: "czech" },
  { code: "da", name: "Dansk", englishName: "Danish", locale: "da", steam: "danish" },
  { code: "nl", name: "Nederlands", englishName: "Dutch", locale: "nl", steam: "dutch" },
  { code: "en", name: "English", englishName: "English", locale: "en", steam: "english" },
  { code: "fi", name: "Suomi", englishName: "Finnish", locale: "fi", steam: "finnish" },
  { code: "fr", name: "Français", englishName: "French", locale: "fr", steam: "french" },
  { code: "de", name: "Deutsch", englishName: "German", locale: "de", steam: "german" },
  { code: "el", name: "Ελληνικά", englishName: "Greek", locale: "el", steam: "greek" },
  { code: "hu", name: "Magyar", englishName: "Hungarian", locale: "hu", steam: "hungarian" },
  { code: "id", name: "Bahasa Indonesia", englishName: "Indonesian", locale: "id", steam: "indonesian" },
  { code: "it", name: "Italiano", englishName: "Italian", locale: "it", steam: "italian" },
  { code: "ja", name: "日本語", englishName: "Japanese", locale: "ja", steam: "japanese" },
  { code: "ko", name: "한국어", englishName: "Korean", locale: "ko", steam: "koreana" },
  { code: "no", name: "Norsk", englishName: "Norwegian", locale: "no", steam: "norwegian" },
  { code: "pl", name: "Polski", englishName: "Polish", locale: "pl", steam: "polish" },
  { code: "pt", name: "Português", englishName: "Portuguese", locale: "pt", steam: "portuguese" },
  { code: "pt-BR", name: "Português (Brasil)", englishName: "Portuguese (Brazil)", locale: "pt-BR", steam: "brazilian" },
  { code: "ro", name: "Română", englishName: "Romanian", locale: "ro", steam: "romanian" },
  { code: "ru", name: "Русский", englishName: "Russian", locale: "ru", steam: "russian" },
  { code: "es", name: "Español", englishName: "Spanish", locale: "es", steam: "spanish" },
  { code: "sv", name: "Svenska", englishName: "Swedish", locale: "sv", steam: "swedish" },
  { code: "th", name: "ไทย", englishName: "Thai", locale: "th", steam: "thai" },
  { code: "tr", name: "Türkçe", englishName: "Turkish", locale: "tr", steam: "turkish" },
  { code: "uk", name: "Українська", englishName: "Ukrainian", locale: "uk", steam: "ukrainian" },
  { code: "vi", name: "Tiếng Việt", englishName: "Vietnamese", locale: "vi", steam: "vietnamese" },
] as const;

export type LauncherLanguage = typeof launcherLanguages[number]["code"];
export const DEFAULT_LANGUAGE: LauncherLanguage = "en";

export function normalizeLanguage(value: unknown): LauncherLanguage {
  if (typeof value !== "string") return DEFAULT_LANGUAGE;
  const exact = launcherLanguages.find((language) => language.code.toLowerCase() === value.toLowerCase().replace(/_/g, "-"));
  if (exact) return exact.code;
  const base = value.toLowerCase().split(/[-_]/, 1)[0];
  return launcherLanguages.find((language) => language.code.toLowerCase() === base)?.code ?? DEFAULT_LANGUAGE;
}

export function steamLanguageForLauncher(value: unknown): string {
  const language = launcherLanguages.find((item) => item.code === normalizeLanguage(value));
  return language?.steam ?? "english";
}

export function applyLauncherLanguage(value: unknown): void {
  if (typeof document === "undefined") return;
  const language = launcherLanguages.find((item) => item.code === normalizeLanguage(value));
  document.documentElement.lang = language?.locale ?? "en";
  setTranslationLocale(language?.code ?? "en");
  document.documentElement.dir = language?.code === "ar" ? "rtl" : "ltr";
}
