import type { SupabaseClient } from "@supabase/supabase-js";
import type { Piko } from "../../models";

export type ProviderId = "igdb" | "steamgriddb" | "steam";
export type ArtworkSource = ProviderId;

/** Text-ish metadata normalised across providers. */
export type TextMeta = {
  name?: string;
  description?: string;
  categories?: string[];
  screenshots?: string[];
  /** YouTube video id; only IGDB provides one. */
  trailerId?: string;
  /** Unix seconds. */
  firstReleaseDate?: number;
  igdbId?: number;
};

export type ArtChoice = { source: ArtworkSource; url: string };

export type ProviderResult = { text?: TextMeta; art?: ArtChoice[] };

export type ProviderContext = { client: SupabaseClient | null };

export type ProviderErrorKind = "rate-limit" | "offline" | "auth" | "other";

export class ProviderError extends Error {
  constructor(message: string, readonly kind: ProviderErrorKind = "other") { super(message); }
}

/** Sorts a thrown value into a ProviderError so callers can back off on 429s and stay quiet offline. */
export function classifyError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (/\b429\b|rate.?limit|too many requests/i.test(message)) return new ProviderError(message, "rate-limit");
  if (/failed to fetch|network|offline|failed to send a request|timed? ?out/i.test(message)) return new ProviderError(message, "offline");
  if (/rejected|api key|not configured|authentication|401|403/i.test(message)) return new ProviderError(message, "auth");
  return new ProviderError(message, "other");
}

/** One metadata source. Providers never mutate Pikos; they return normalised data for `merge.ts`. */
export interface MetadataProvider {
  id: ProviderId;
  label: string;
  provides: { text: boolean; art: boolean };
  lookup(context: ProviderContext, piko: Piko): Promise<ProviderResult>;
}

export type MetadataChoice = "auto" | "igdb" | "steamgriddb";
export type Readiness = { igdb: boolean; steamgriddb: boolean };
