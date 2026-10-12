import { navLabel } from "./nav";
import { getTranslationLocale } from "./translationLocale";
import { normalizeLanguage } from "./languages";

/**
 * Shared UI message catalogue, loaded lazily one locale at a time.
 *
 * Keys are stable English source strings so missing translations safely fall back to English
 * instead of displaying a blank label. Each non-English locale is a build-time-generated flat
 * `Record<english, translation>` served through the `virtual:mochi-i18n/<locale>` virtual module
 * (see i18nLocalePlugin.ts), which folds the ~60 catalogue files in the same precedence order the
 * old synchronous `??` chain used. The browser therefore ships only the active locale instead of
 * all 18 `translations-*` chunks; the full catalogues live in src/lib/i18nCatalogues.ts, which is
 * tooling-only (Vite config, tests) and never part of the app graph.
 */
type FlatMessages = Record<string, string>;

/** Flat maps fetched this session — normally just the active locale, plus one mid-switch. */
const loadedLocales = new Map<string, FlatMessages>();
const pendingLoads = new Map<string, Promise<void>>();

type LocaleLoader = () => Promise<{ default: FlatMessages }>;

/**
 * Explicit loader table with one literal `import("virtual:mochi-i18n/<locale>")` clause per
 * locale. A literal (not template-literal) import is required so Rollup code-splits a separate
 * chunk per locale. "en" has no entry on purpose: normalizeLanguage("en") short-circuits in
 * ensureLocale() and translate() returns the source text, matching the pre-lazy-loading fallback.
 */
export const LOCALE_LOADERS: Record<string, LocaleLoader> = {
  ar: () => import("virtual:mochi-i18n/ar"),
  bg: () => import("virtual:mochi-i18n/bg"),
  "zh-Hans": () => import("virtual:mochi-i18n/zh-Hans"),
  "zh-Hant": () => import("virtual:mochi-i18n/zh-Hant"),
  cs: () => import("virtual:mochi-i18n/cs"),
  da: () => import("virtual:mochi-i18n/da"),
  nl: () => import("virtual:mochi-i18n/nl"),
  fi: () => import("virtual:mochi-i18n/fi"),
  fr: () => import("virtual:mochi-i18n/fr"),
  de: () => import("virtual:mochi-i18n/de"),
  el: () => import("virtual:mochi-i18n/el"),
  hu: () => import("virtual:mochi-i18n/hu"),
  id: () => import("virtual:mochi-i18n/id"),
  it: () => import("virtual:mochi-i18n/it"),
  ja: () => import("virtual:mochi-i18n/ja"),
  ko: () => import("virtual:mochi-i18n/ko"),
  no: () => import("virtual:mochi-i18n/no"),
  pl: () => import("virtual:mochi-i18n/pl"),
  pt: () => import("virtual:mochi-i18n/pt"),
  "pt-BR": () => import("virtual:mochi-i18n/pt-BR"),
  ro: () => import("virtual:mochi-i18n/ro"),
  ru: () => import("virtual:mochi-i18n/ru"),
  es: () => import("virtual:mochi-i18n/es"),
  sv: () => import("virtual:mochi-i18n/sv"),
  th: () => import("virtual:mochi-i18n/th"),
  tr: () => import("virtual:mochi-i18n/tr"),
  uk: () => import("virtual:mochi-i18n/uk"),
  vi: () => import("virtual:mochi-i18n/vi"),
};

/**
 * Fetches a locale's flat map (no-op for "en" or a locale already loaded). Never rejects: a
 * failed load logs a warning and translate() keeps falling back to English source text, so a
 * missing chunk can never block bootstrap or a language switch. Concurrent calls share one load.
 */
export function ensureLocale(language: unknown): Promise<void> {
  const normalized = normalizeLanguage(language);
  if (normalized === "en" || loadedLocales.has(normalized)) return Promise.resolve();
  const pending = pendingLoads.get(normalized);
  if (pending) return pending;
  const load = LOCALE_LOADERS[normalized];
  if (!load) return Promise.resolve();
  const loading = load().then(
    (module) => {
      loadedLocales.set(normalized, module.default);
      pendingLoads.delete(normalized);
    },
    (error: unknown) => {
      // Keep the locale out of `loadedLocales` so a later attempt can retry.
      pendingLoads.delete(normalized);
      console.warn(`Mochi could not load the "${normalized}" translation`, error);
    },
  );
  pendingLoads.set(normalized, loading);
  return loading;
}

let localeRequest = 0;

/**
 * Loads the locale first, then runs `commit`, so no frame renders UI in a locale whose map is
 * still in flight. A newer request supersedes an older one, so rapid language clicks (Settings,
 * first-launch setup) can never commit out of order. `commit` typically applies the locale
 * (applyLauncherLanguage) and persists the preference.
 */
export function commitWhenLocaleReady(language: unknown, commit: () => void): void {
  const request = ++localeRequest;
  void ensureLocale(language).then(() => {
    if (request === localeRequest) commit();
  });
}

/**
 * Translates a source-language UI string. The signature stays synchronous: callers pass either
 * the active locale (getTranslationLocale(), updated only after ensureLocale resolved) or the
 * behaviour preference, which switch paths only commit after commitWhenLocaleReady loaded it.
 * If a locale genuinely is not loaded yet (e.g. a race around a switch), the English source text
 * is returned — the same fallback as an unknown message; the full catalogue chain no longer ships
 * with the app. Navigation labels are a small always-bundled table and win first, as before.
 */
export function translate(message: string, language: unknown = getTranslationLocale()): string {
  const normalized = normalizeLanguage(language);
  const navigation = navLabel(message, normalized);
  if (navigation !== message) return navigation;
  // "en" keeps no map: source text is the translation (navLabel above already covers nav ids).
  if (normalized === "en") return message;
  return loadedLocales.get(normalized)?.[message] ?? message;
}


/**
 * Translates a fully rendered UI message, including strings whose placeholders were already
 * interpolated by the caller. Exact matches in the active locale's flat map stay fast; dynamic
 * messages are matched against the placeholder templates the locale has actually translated.
 * Templates are cached per locale because the flat map only ships the active locale.
 */
type UiTemplate = { source: string; pattern: RegExp; placeholders: number; staticLength: number };
const uiTemplatesByLocale = new Map<string, UiTemplate[]>();
const uiMessageCache = new Map<string, string>();

function escapeUiPattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getUiTemplates(locale: string, flat: FlatMessages): UiTemplate[] {
  const cached = uiTemplatesByLocale.get(locale);
  if (cached) return cached;
  const placeholder = /\{[^}]+\}/g;
  const templates = Object.keys(flat)
    .filter((source) => /\{[^}]+\}/.test(source) && source.replace(placeholder, "").trim().length > 0)
    .map((source) => {
      const count = (source.match(placeholder) ?? []).length;
      const parts = source.split(placeholder);
      return { source, pattern: new RegExp("^" + parts.map(escapeUiPattern).join("([\\s\\S]+?)") + "$"), placeholders: count, staticLength: parts.join("").length };
    })
    .sort((a, b) => b.staticLength - a.staticLength || a.placeholders - b.placeholders);
  uiTemplatesByLocale.set(locale, templates);
  return templates;
}

export function translateUiMessage(message: string, language: unknown = getTranslationLocale()): string {
  const normalized = normalizeLanguage(language);
  if (normalized === "en") return message;
  const navigation = navLabel(message, normalized);
  if (navigation !== message) return navigation;
  const flat = loadedLocales.get(normalized);
  // Locale not loaded yet: fall back to source text, matching translate()'s documented behaviour.
  if (flat === undefined) return message;
  const exact = flat[message];
  if (exact) return exact;
  const cacheKey = `${normalized} ${message}`;
  const cached = uiMessageCache.get(cacheKey);
  if (cached !== undefined) return cached;
  for (const template of getUiTemplates(normalized, flat)) {
    const match = template.pattern.exec(message);
    if (!match) continue;
    const translatedTemplate = flat[template.source];
    if (!translatedTemplate) continue;
    let index = 1;
    const localized = translatedTemplate.replace(/\{[^}]+\}/g, () => match[index++] ?? "");
    uiMessageCache.set(cacheKey, localized);
    return localized;
  }
  uiMessageCache.set(cacheKey, message);
  return message;
}
