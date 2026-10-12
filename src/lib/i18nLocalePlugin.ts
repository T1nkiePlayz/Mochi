/**
 * Vite plugin serving `virtual:mochi-i18n/<locale>` as a flat `Record<english, translation>`
 * built at config/load time, so each locale becomes one self-contained dynamic chunk and the
 * ~60 catalogue files never enter the browser graph. Kept in its own module (not vite.config.ts)
 * so i18nLocale.test.ts can unit-test foldLocale without importing the Vite config.
 */
import type { Plugin } from "vite";
import { catalogues } from "./i18nCatalogues";
import { navIds, navLabel } from "./nav";
import { launcherLanguages, normalizeLanguage } from "./languages";

const VIRTUAL_PREFIX = "virtual:mochi-i18n/";
const RESOLVED_PREFIX = "\0" + VIRTUAL_PREFIX;

const launcherLocaleCodes = new Set<string>(launcherLanguages.map((item) => item.code));

/**
 * Folds every catalogue into one flat map for `locale`, reproducing the old synchronous
 * `??` chain exactly:
 *
 * - catalogues fold in REVERSE precedence order, so earlier catalogues overwrite later ones
 *   (first match wins), and only non-empty entries participate (an empty entry never won in
 *   practice — no catalogue contains empty translations, and i18nLocale.test.ts proves parity);
 * - the small nav table folds last so it outranks the catalogues, mirroring translate()'s
 *   navLabel-first check (only where navLabel actually differs from the id — where it returns
 *   the id, the old chain fell through to the catalogues, so the fold must too).
 */
export function foldLocale(locale: string): Record<string, string> {
  const normalized = normalizeLanguage(locale);
  const folded: Record<string, string> = {};
  for (let index = catalogues.length - 1; index >= 0; index -= 1) {
    for (const [message, translations] of Object.entries(catalogues[index])) {
      const value = translations[normalized];
      if (value) folded[message] = value;
    }
  }
  for (const id of navIds) {
    const label = navLabel(id, normalized);
    if (label !== id) folded[id] = label;
  }
  return folded;
}

/** Vite plugin: resolveId claims `virtual:mochi-i18n/<locale>`, load emits the folded map. */
export function i18nLocalePlugin(): Plugin {
  return {
    name: "mochi-i18n-locale",
    resolveId(id: string) {
      return id.startsWith(VIRTUAL_PREFIX) ? RESOLVED_PREFIX + id.slice(VIRTUAL_PREFIX.length) : null;
    },
    load(id: string) {
      if (!id.startsWith(RESOLVED_PREFIX)) return null;
      const locale = id.slice(RESOLVED_PREFIX.length);
      if (!launcherLocaleCodes.has(locale)) this.error(`Unknown Mochi locale "${locale}"`);
      // A plain object literal keeps the chunk self-contained: no imports, no shared catalogue chunk.
      return `export default ${JSON.stringify(foldLocale(locale))};`;
    },
  };
}
