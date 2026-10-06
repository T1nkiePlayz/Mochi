import type { SupabaseClient } from "@supabase/supabase-js";

export async function signInWithProvider(client: SupabaseClient, provider: "google" | "github") {
  return client.auth.signInWithOAuth({
    provider,
    options: { redirectTo: window.location.origin },
  });
}

export async function sendMagicLink(client: SupabaseClient, email: string) {
  return client.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin },
  });
}

export async function getVerifiedTotpFactor(client: SupabaseClient) {
  const { data, error } = await client.auth.mfa.listFactors();
  if (error) throw error;
  return data.totp?.find((factor) => factor.status === "verified") ?? null;
}

export async function verifyMfaCode(client: SupabaseClient, factorId: string, code: string) {
  const { data: challenge, error: challengeError } = await client.auth.mfa.challenge({ factorId });
  if (challengeError) throw challengeError;
  return client.auth.mfa.verify({
    factorId,
    challengeId: challenge.id,
    code,
  });
}

export async function enrollTotp(client: SupabaseClient, friendlyName = "Mochi authenticator") {
  return client.auth.mfa.enroll({ factorType: "totp", friendlyName });
}

export async function removeTotp(client: SupabaseClient, factorId: string) {
  return client.auth.mfa.unenroll({ factorId });
}

export async function registerPasskey(client: SupabaseClient) {
  return client.auth.registerPasskey();
}

export async function signInWithPasskey(client: SupabaseClient) {
  return client.auth.signInWithPasskey();
}
