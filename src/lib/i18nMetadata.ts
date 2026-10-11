import { i18nMetadataPart1 } from "./i18nMetadataPart1";
import { i18nMetadataPart2 } from "./i18nMetadataPart2";

/** Combined synchronous lookup catalogue; its data is emitted as smaller build chunks. */
export const metadataMessages: Record<string, Record<string, string>> = {
  ...i18nMetadataPart1,
  ...i18nMetadataPart2,
};
