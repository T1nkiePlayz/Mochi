import { getTranslationLocale } from "./translationLocale";

const localeCache = new Map<string, string>();
const numberFormatterCache = new Map<string, Intl.NumberFormat>();
const relativeFormatterCache = new Map<string, Intl.RelativeTimeFormat>();

function numberFormatter(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = locale + ":" + JSON.stringify(options);
  let formatter = numberFormatterCache.get(key);
  if (!formatter) { formatter = new Intl.NumberFormat(locale, options); numberFormatterCache.set(key, formatter); }
  return formatter;
}

function relativeFormatter(locale: string): Intl.RelativeTimeFormat {
  let formatter = relativeFormatterCache.get(locale);
  if (!formatter) { formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" }); relativeFormatterCache.set(locale, formatter); }
  return formatter;
}


function intlLocale(locale: string): string {
  const cached = localeCache.get(locale);
  if (cached) return cached;
  try {
    new Intl.RelativeTimeFormat(locale);
    localeCache.set(locale, locale);
    return locale;
  } catch {
    localeCache.set(locale, "en");
    return "en";
  }
}

export function formatBytes(bytes: number, language = getTranslationLocale()): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 KiB";
  const locale = intlLocale(language);
  const number = (value: number, maximumFractionDigits: number, minimumFractionDigits = 0) =>
    language === "en"
      ? value.toFixed(maximumFractionDigits)
      : numberFormatter(locale, { maximumFractionDigits, minimumFractionDigits }).format(value);
  if (bytes < 1024 * 1024) {
    const kib = Math.max(1, Math.round(bytes / 1024));
    return (language === "en" ? String(kib) : numberFormatter(locale, { maximumFractionDigits: 0 }).format(kib)) + " KiB";
  }
  if (bytes < 1024 * 1024 * 1024) return number(bytes / 1024 / 1024, 1, 1) + " MiB";
  return number(bytes / 1024 / 1024 / 1024, 2, 2) + " GiB";
}

export function formatPlaytime(seconds: number, language = getTranslationLocale()): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (language === "en") return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
  const locale = intlLocale(language);
  const hoursFormatter = numberFormatter(locale, { style: "unit", unit: "hour", unitDisplay: "short", maximumFractionDigits: 0 });
  const minutesFormatter = numberFormatter(locale, { style: "unit", unit: "minute", unitDisplay: "short", maximumFractionDigits: 0 });
  return hours ? `${hoursFormatter.format(hours)} ${minutesFormatter.format(minutes)}` : minutesFormatter.format(minutes);
}

export function formatRelativeTime(epochSeconds: number, language = getTranslationLocale()): string {
  const diff = Math.max(0, Date.now() / 1000 - epochSeconds);
  const locale = intlLocale(language);
  if (language === "en") {
    if (!Number.isFinite(diff) || diff < 90) return "just now";
    const unit = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"} ago`;
    if (diff < 3600) return unit(Math.floor(diff / 60), "minute");
    if (diff < 86400) return unit(Math.floor(diff / 3600), "hour");
    if (diff < 86400 * 30) return unit(Math.floor(diff / 86400), "day");
    return new Date(epochSeconds * 1000).toLocaleDateString(locale);
  }
  const relative = relativeFormatter(locale);
  if (!Number.isFinite(diff) || diff < 90) return relative.format(0, "second");
  if (diff < 3600) return relative.format(-Math.floor(diff / 60), "minute");
  if (diff < 86400) return relative.format(-Math.floor(diff / 3600), "hour");
  if (diff < 86400 * 30) return relative.format(-Math.floor(diff / 86400), "day");
  return new Date(epochSeconds * 1000).toLocaleDateString(locale);
}
