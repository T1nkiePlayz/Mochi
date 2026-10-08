/** Where sign-in flows send the browser back to the desktop app. */
export const AUTH_CALLBACK_URL = "mochi://auth/callback";

export type AuthCallback = { accessToken: string; refreshToken: string } | { code: string };

/**
 * Reads the result of a browser sign-in from a mochi://auth/callback link. Supabase's implicit flow puts
 * the tokens in the URL fragment, the website hand-off uses the query, and PKCE uses `?code=`.
 */
export function parseAuthCallback(url: string): AuthCallback | null {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }
  if (parsed.protocol !== "mochi:" || parsed.hostname !== "auth" || parsed.pathname.replace(/\/+$/, "") !== "/callback") return null;
  const fragment = new URLSearchParams(parsed.hash.replace(/^#/, ""));
  const read = (name: string) => parsed.searchParams.get(name) || fragment.get(name);
  const accessToken = read("access_token");
  const refreshToken = read("refresh_token");
  if (accessToken && refreshToken) return { accessToken, refreshToken };
  const code = read("code");
  return code ? { code } : null;
}

/** True inside the desktop app (as opposed to the browser dev server). */
export const isDesktopApp = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
