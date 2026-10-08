import type { SupabaseClient } from "@supabase/supabase-js";
import { AUTH_CALLBACK_URL, isDesktopApp } from "./deepLinkAuth";
import { openExternalUrl } from "./platform";

/**
 * Starts a provider sign-in. In the desktop app the provider page opens in the system browser (Google
 * refuses embedded web views, notably WKWebView on macOS) and returns through mochi://auth/callback.
 */
async function startOAuth(client: SupabaseClient, provider: "google" | "github", link: boolean) {
  if (!isDesktopApp()) {
    const options = { redirectTo: window.location.origin };
    return link ? client.auth.linkIdentity({ provider, options }) : client.auth.signInWithOAuth({ provider, options });
  }
  const options = { redirectTo: AUTH_CALLBACK_URL, skipBrowserRedirect: true };
  const result = link ? await client.auth.linkIdentity({ provider, options }) : await client.auth.signInWithOAuth({ provider, options });
  const url = result.data?.url;
  if (!result.error && url) await openExternalUrl(url);
  return result;
}

export async function signInWithProvider(client: SupabaseClient, provider: "google" | "github") {
  return startOAuth(client, provider, false);
}

export async function sendEmailCode(client: SupabaseClient, email: string) {
  return client.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  });
}

export async function verifyEmailCode(client: SupabaseClient, email: string, token: string) {
  return client.auth.verifyOtp({
    email,
    token,
    type: "email",
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
  return startOAuth(client, provider, true);
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
