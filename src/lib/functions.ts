import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Calls the provider edge function and surfaces the server's own error message.
 * `functions.invoke` hides the response body of non-2xx replies behind a generic error.
 */
export async function invokeProviderFunction<T = Record<string, unknown>>(client: SupabaseClient, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await client.functions.invoke("store-provider-credentials", { body });
  if (error) {
    const context = (error as { context?: unknown }).context;
    if (context instanceof Response) {
      const payload = await context.clone().json().catch(() => null) as { error?: string } | null;
      if (payload?.error) throw new Error(payload.error);
    }
    throw error;
  }
  if (data?.error) throw new Error(data.error);
  return data as T;
}
