import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Calls the provider edge function and surfaces the server's own error message.
 * `functions.invoke` hides the response body of non-2xx replies behind a generic error.
 */
export async function invokeProviderFunction<T = Record<string, unknown>>(client: SupabaseClient, body: Record<string, unknown>): Promise<T> {
  return invokeEdgeFunction<T>(client, "store-provider-credentials", body);
}

/** Error from an edge function that keeps the machine-readable `code` next to the readable message. */
export class EdgeFunctionError extends Error {
  constructor(message: string, readonly code?: string, readonly status?: number) { super(message); this.name = "EdgeFunctionError"; }
}

export async function invokeEdgeFunction<T = Record<string, unknown>>(client: SupabaseClient, name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await client.functions.invoke(name, { body });
  if (error) {
    const context = (error as { context?: unknown }).context;
    if (context instanceof Response) {
      const payload = await context.clone().json().catch(() => null) as { error?: string; code?: string } | null;
      if (payload?.error) throw new EdgeFunctionError(payload.error, payload.code, context.status);
    }
    throw error;
  }
  if (data?.error) throw new EdgeFunctionError(data.error, data.code);
  return data as T;
}
