import type { SupabaseClient } from "@supabase/supabase-js";

export type ProviderCredential = "igdb" | "nexus";

export function validateNexusApiKey(value: string): string | null {
  const key = value.trim();
  if (!key) return "Enter your Nexus Mods Personal API Key.";
  if (key.length < 32) return "Nexus Mods Personal API Keys must be at least 32 characters.";
  if (key.length > 4096) return "The Nexus Mods API key is too long.";
  if (!/^[!-~]+$/.test(key)) return "Remove spaces or line breaks from the Nexus Mods API key.";
  return null;
}

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
