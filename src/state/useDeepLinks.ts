import { confirmAction } from "../lib/confirm";
import { useEffect, useRef } from "react";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { listen } from "@tauri-apps/api/event";
import { supabase } from "../lib/supabase";
import { verifyEmailToken } from "../lib/auth";
import { parseAuthCallback } from "../lib/deepLinkAuth";
import type { AccountState } from "./useAccount";
import { enterBigPicture } from "../bigpicture/mode";
import { isNxmUrl } from "../lib/mods/nxm";
import { queueNxmLink } from "./nxmLinks";
import { parseCliUrl, type CliIntent } from "../lib/cliIntent";

let startupHandled = false;

/** Handles mochi://launch/<game>, mochi://open/<game>, mochi://bigpicture and the mochi://auth/* sign-in links. */
export function useDeepLinks(account: AccountState, onCliIntent: (intent: CliIntent) => void) {
  const accountRef = useRef(account);
  accountRef.current = account;
  // Always points at the latest launch logic so links never act on stale library state.
  const intentRef = useRef(onCliIntent);
  intentRef.current = onCliIntent;

  useEffect(() => {
    const client = supabase;
    let unlisten: (() => void) | undefined;
    const parse = (url: string) => { try { return new URL(url); } catch { return null; } };

    const handle = async (urls: string[]) => {
      for (const url of urls) {
        // Nexus Mods "Mod Manager Download": ask which Tofu and download (components/mods/NxmPrompt).
        if (isNxmUrl(url)) { queueNxmLink(url); continue; }
        const parsed = parse(url);
        if (parsed?.protocol === "mochi:" && parsed.hostname === "bigpicture") { enterBigPicture(); return; }
        // Only launch/open are understood; the app resolves the name against the library (src/lib/cliIntent.ts).
        const intent = parseCliUrl(url);
        if (intent) { intentRef.current(intent); return; }
      }
      if (!client) return;
      const { setShowAuth, setAuthBusy, setAuthError, setAuthNotice } = accountRef.current;
      const find = (path: string) => urls.find((url) => { const parsed = parse(url); return parsed?.protocol === "mochi:" && parsed.hostname === "auth" && parsed.pathname === path; });

      const callbackUrl = find("/callback");
      const callback = callbackUrl ? parseAuthCallback(callbackUrl) : null;
      if (callback) {
        // Any web page or app can open mochi:// links, so never switch accounts silently:
        // a crafted link could otherwise sign this device into an attacker's account.
        if (!await confirmAction({ title: "Finish signing in?", message: "Sign in to Mochi with the account from this browser link. Only continue if you just started signing in.", confirmLabel: "Sign in" })) return;
        setShowAuth(true); setAuthBusy(true); setAuthError(""); setAuthNotice("Completing browser sign-in…");
        const finish = "code" in callback
          ? client.auth.exchangeCodeForSession(callback.code)
          : client.auth.setSession({ access_token: callback.accessToken, refresh_token: callback.refreshToken });
        void finish
          .then(({ error }) => { if (error) throw error; setAuthNotice("Signed in successfully."); setShowAuth(false); })
          .catch((error) => setAuthError(error instanceof Error ? error.message : "Unable to complete browser sign-in."))
          .finally(() => setAuthBusy(false));
        return;
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
      if (urls && !startupHandled) { startupHandled = true; void handle(urls); }
    }).catch((error) => console.warn("Mochi deep-link startup check failed", error));
    void onOpenUrl((urls) => void handle(urls)).then((remove) => { unlisten = remove; }).catch((error) => console.warn("Mochi deep-link listener failed", error));
    // The tray / menu-bar "Play recent" items: same path as `mochi launch <game>`.
    let offTray: (() => void) | undefined;
    let disposed = false;
    void listen<string>("mochi-tray-launch", (event) => { if (typeof event.payload === "string" && event.payload) intentRef.current({ kind: "launch", query: event.payload }); })
      .then((off) => { if (disposed) off(); else offTray = off; }).catch(() => {});
    return () => { disposed = true; unlisten?.(); offTray?.(); };
  }, []);
}
