import { useSyncExternalStore } from "react";
import { translate } from "../lib/i18n";
import { getTranslationLocale, subscribeTranslationLocale } from "../lib/translationLocale";

type Props = { message: string; spaceBefore?: boolean; spaceAfter?: boolean };

/** Renders a source-language JSX string as reactive, translated text without adding a DOM wrapper. */
export function LocalizedText({ message, spaceBefore = false, spaceAfter = false }: Props) {
  const locale = useSyncExternalStore(subscribeTranslationLocale, getTranslationLocale, getTranslationLocale);
  return <>{spaceBefore ? " " : ""}{translate(message, locale)}{spaceAfter ? " " : ""}</>;
}
