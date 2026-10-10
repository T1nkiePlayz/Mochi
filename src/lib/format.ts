import { getTranslationLocale } from "./translationLocale";

function intlLocale(locale: string): string {
  try {
    new Intl.RelativeTimeFormat(locale);
    return locale;
  } catch {
    return "en";
  }
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 KiB";
  if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + " KiB";
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + " MiB";
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + " GiB";
}

export function formatPlaytime(seconds: number, language = getTranslationLocale()): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (language === "en") return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
  const locale = intlLocale(language);
  const hoursFormatter = new Intl.NumberFormat(locale, { style: "unit", unit: "hour", unitDisplay: "short", maximumFractionDigits: 0 });
  const minutesFormatter = new Intl.NumberFormat(locale, { style: "unit", unit: "minute", unitDisplay: "short", maximumFractionDigits: 0 });
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
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (!Number.isFinite(diff) || diff < 90) return relative.format(0, "second");
  if (diff < 3600) return relative.format(-Math.floor(diff / 60), "minute");
  if (diff < 86400) return relative.format(-Math.floor(diff / 3600), "hour");
  if (diff < 86400 * 30) return relative.format(-Math.floor(diff / 86400), "day");
  return new Date(epochSeconds * 1000).toLocaleDateString(locale);
}
