import { createClient } from "@supabase/supabase-js";
import { markNetworkFailure, markNetworkOk } from "./offline";

/** Reports real connectivity to the offline banner; failures still reject so callers can handle them. */
const trackedFetch: typeof fetch = async (input, init) => {
  try {
    const response = await fetch(input, init);
    markNetworkOk();
    return response;
  } catch (error) {
    // Aborted requests are not connectivity problems.
    if (!(error instanceof DOMException && error.name === "AbortError")) markNetworkFailure();
    throw error;
  }
};

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const supabase =
  supabaseUrl && supabasePublishableKey
    ? createClient(supabaseUrl, supabasePublishableKey, {
        global: { fetch: trackedFetch },
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          },
      })
    : null;

export const isCloudConfigured = Boolean(supabase);
