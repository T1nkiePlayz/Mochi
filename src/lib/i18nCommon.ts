import { i18nCommonPart1 } from "./i18nCommonPart1";
import { i18nCommonPart2 } from "./i18nCommonPart2";

/** Combined synchronous lookup catalogue; its data is emitted as smaller build chunks. */
export const commonMessages: Record<string, Record<string, string>> = {
  ...i18nCommonPart1,
  ...i18nCommonPart2,
};
