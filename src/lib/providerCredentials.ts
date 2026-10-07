import type { SupabaseClient } from "@supabase/supabase-js";

export type ProviderCredential = "igdb" | "nexus";

export async function saveProviderCredential(client: SupabaseClient, provider: ProviderCredential, secret: string): Promise<void> {
  const { error } = await client.functions.invoke("store-provider-credentials", {
    body: { action: "set", provider, secret },
  });
  if (error) throw error;
}

export async function getProviderCredentialStatus(client: SupabaseClient, provider: ProviderCredential): Promise<boolean> {
  const { data, error } = await client.functions.invoke("store-provider-credentials", {
    body: { action: "status", provider },
  });
  if (error) throw error;
  return Boolean(data?.configured);
}

