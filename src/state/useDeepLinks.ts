import { useEffect, useRef } from "react";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { supabase } from "../lib/supabase";
import { verifyEmailToken } from "../lib/auth";
import type { AccountState } from "./useAccount";
import { enterBigPicture } from "../bigpicture/mode";

let startupHandled = false;

/** Handles mochi://launch/<id> and the mochi://auth/* sign-in links. */
export function useDeepLinks(account: AccountState, launchFromLink: (gameId: string) => void) {
  const accountRef = useRef(account);
  accountRef.current = account;
  // Always points at the latest launch logic so links never act on stale library state.
  const launchRef = useRef(launchFromLink);
  launchRef.current = launchFromLink;

  useEffect(() => {
    const client = supabase;
    let unlisten: (() => void) | undefined;
    const parse = (url: string) => { try { return new URL(url); } catch { return null; } };

    const handle = (urls: string[]) => {
      for (const url of urls) {
        const parsed = parse(url);
        if (parsed?.protocol === "mochi:" && parsed.hostname === "bigpicture") { enterBigPicture(); return; }
        if (parsed?.protocol === "mochi:" && parsed.hostname === "launch") {
          let gameId = "";
          try { gameId = decodeURIComponent(parsed.pathname.replace(/^\//, "")); } catch { /* malformed escape: ignore the link */ }
          if (gameId) launchRef.current(gameId);
          return;
        }
      }
      if (!client) return;
      const { setShowAuth, setAuthBusy, setAuthError, setAuthNotice } = accountRef.current;
      const find = (path: string) => urls.find((url) => { const parsed = parse(url); return parsed?.protocol === "mochi:" && parsed.hostname === "auth" && parsed.pathname === path; });

      const callbackUrl = find("/callback");
      if (callbackUrl) {
        const parsed = new URL(callbackUrl);
        const accessToken = parsed.searchParams.get("access_token");
        const refreshToken = parsed.searchParams.get("refresh_token");
        if (accessToken && refreshToken) {
          // Any web page or app can open mochi:// links, so never switch accounts silently:
          // a crafted link could otherwise sign this device into an attacker's account.
          if (!window.confirm("Finish signing in to Mochi with the account from this browser link?")) return;
          setShowAuth(true); setAuthBusy(true); setAuthError(""); setAuthNotice("Completing browser sign-in…");
          void client.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
            .then(({ error }) => { if (error) throw error; setAuthNotice("Signed in successfully."); setShowAuth(false); })
            .catch((error) => setAuthError(error instanceof Error ? error.message : "Unable to complete browser sign-in."))
            .finally(() => setAuthBusy(false));
          return;
        }
      }

      const verificationUrl = find("/verify");
      if (!verificationUrl) return;
      setShowAuth(true); setAuthBusy(true); setAuthError(""); setAuthNotice("Verifying your email with Mochi…");
      void verifyEmailToken(client, verificationUrl)
        .then(() => setAuthNotice("Email verified successfully. Your Mochi account is ready."))
        .catch((error) => { setAuthError(error instanceof Error ? error.message : "Email verification failed."); setAuthNotice(""); })
        .finally(() => setAuthBusy(false));
    };

    void getCurrent().then((urls) => {
      // The startup link must only be acted on once, even if the effect runs again (hot reload, strict mode).
      if (urls && !startupHandled) { startupHandled = true; handle(urls); }
    }).catch((error) => console.warn("Mochi deep-link startup check failed", error));
    void onOpenUrl(handle).then((remove) => { unlisten = remove; }).catch((error) => console.warn("Mochi deep-link listener failed", error));
    return () => unlisten?.();
  }, []);
}
