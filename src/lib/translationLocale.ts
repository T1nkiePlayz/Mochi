type LocaleListener = () => void;

let currentLocale = "en";
const listeners = new Set<LocaleListener>();

export function getTranslationLocale(): string {
  return currentLocale;
}

export function setTranslationLocale(locale: string): void {
  if (currentLocale === locale) return;
  currentLocale = locale;
  listeners.forEach((listener) => listener());
}

export function subscribeTranslationLocale(listener: LocaleListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
