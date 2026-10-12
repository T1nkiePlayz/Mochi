// HaveIBeenPwned k-anonymity check — the free, keyless equivalent of Supabase's
// paid leaked-password protection. Only the first 5 characters of the SHA-1 hash
// leave the launcher; the full hash never does.
// https://haveibeenpwned.com/API/v3#PwnedPasswords

const PWNED_RANGE_URL = "https://api.pwnedpasswords.com/range/";

async function sha1Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
}

/**
 * Returns true when the password appears in known breach corpora, false when it does
 * not, and null when the check could not run (offline, blocked, non-OK response).
 * Callers must block on true but must NEVER block on null: Mochi is offline-capable
 * by requirement, so a failed check must not lock the user out of creating an account.
 */
export async function passwordIsBreached(password: string): Promise<boolean | null> {
  try {
    const hash = await sha1Hex(password);
    const response = await fetch(`${PWNED_RANGE_URL}${hash.slice(0, 5)}`, { headers: { "Add-Padding": "true" } });
    if (!response.ok) return null;
    const suffix = hash.slice(5);
    const body = await response.text();
    return body.split(/\r?\n/).some((line) => line.startsWith(suffix));
  } catch {
    return null;
  }
}
