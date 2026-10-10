import { useCallback } from "react";
import { useAppSelector } from "../state/AppContext";
import { translate } from "./i18n";

/** Read the current launcher language and keep translated controls reactive to settings changes. */
export function useTranslation() {
  const language = useAppSelector((app) => app.behavior.language);
  return useCallback((message: string) => translate(message, language), [language]);
}
