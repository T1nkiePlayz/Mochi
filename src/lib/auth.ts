import type { SupabaseClient } from "@supabase/supabase-js";

export async function signInWithProvider(client: SupabaseClient, provider: "google" | "github") {
  return client.auth.signInWithOAuth({
    provider,
    options: { redirectTo: window.location.origin },
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

export async function listPasskeys(client: SupabaseClient) {
  return client.auth.passkey.list();
}

export async function deletePasskey(client: SupabaseClient, passkeyId: string) {
  return client.auth.passkey.delete({ passkeyId });
}

export async function linkAuthIdentity(client: SupabaseClient, provider: "google" | "github") {
  return client.auth.linkIdentity({
    provider,
    options: { redirectTo: window.location.origin },
  });
}


export async function verifyEmailToken(client: SupabaseClient, url: string) {
  const parsed = new URL(url);
  if (parsed.protocol !== "mochi:" || parsed.hostname !== "auth" || parsed.pathname !== "/verify") {
    throw new Error("Invalid Mochi verification link.");
  }

  const tokenHash = parsed.searchParams.get("token_hash");
  const type = parsed.searchParams.get("type");
  if (!tokenHash || type !== "email") {
    throw new Error("This verification link is missing the information needed to confirm your email.");
  }

  const { error } = await client.auth.verifyOtp({
    token_hash: tokenHash,
    type: "email",
  });
  if (error) throw error;
  return true;
}
