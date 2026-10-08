import type { SupabaseClient } from "@supabase/supabase-js";
import { invokeProviderFunction } from "./functions";

export type ProviderCredential = "igdb" | "nexus" | "steamgriddb";

export function validateNexusApiKey(value: string): string | null {
  const key = value.trim();
  if (!key) return "Enter your Nexus Mods Personal API Key.";
  if (key.length < 32) return "Nexus Mods Personal API Keys must be at least 32 characters.";
  if (key.length > 4096) return "The Nexus Mods API key is too long.";
  if (!/^[!-~]+$/.test(key)) return "Remove spaces or line breaks from the Nexus Mods API key.";
  return null;
}

export function validateSteamGridDbKey(value: string): string | null {
  const key = value.trim();
  if (!key) return "Enter your SteamGridDB API key.";
  if (key.length < 16) return "SteamGridDB API keys are at least 16 characters.";
  if (key.length > 256) return "The SteamGridDB API key is too long.";
  if (!/^[A-Za-z0-9_-]+$/.test(key)) return "SteamGridDB API keys only contain letters, numbers, dashes and underscores.";
  return null;
}

export async function saveProviderCredential(client: SupabaseClient, provider: ProviderCredential, secret: string): Promise<void> {
  await invokeProviderFunction(client, { action: "set", provider, secret });
}

export async function getProviderCredentialStatuses(client: SupabaseClient): Promise<Record<ProviderCredential, boolean>> {
  const data = await invokeProviderFunction<{ providers?: ProviderCredential[] }>(client, { action: "status" });
  const configured = new Set(data.providers ?? []);
  return { igdb: configured.has("igdb"), nexus: configured.has("nexus"), steamgriddb: configured.has("steamgriddb") };
}

export async function deleteProviderCredential(client: SupabaseClient, provider: ProviderCredential): Promise<void> {
  await invokeProviderFunction(client, { action: "delete", provider });
}
