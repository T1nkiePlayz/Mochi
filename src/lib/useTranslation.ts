import { useCallback, useSyncExternalStore } from "react";
import { useAppSelector } from "../state/AppContext";
import { translate } from "./i18n";
import { getTranslationLocale, subscribeTranslationLocale } from "./translationLocale";

/** Read the current launcher language and keep translated controls reactive to settings changes. */
export function useTranslation() {
  // Keep components that format dates/numbers from the active locale in sync too.
  // The returned translator still follows app state, so its identity stays stable on the store notification.
  useSyncExternalStore(subscribeTranslationLocale, getTranslationLocale, getTranslationLocale);
  const language = useAppSelector((app) => app.behavior.language);
  return useCallback((message: string) => translate(message, language), [language]);
}
