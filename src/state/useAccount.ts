import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import {
  deletePasskey, enrollTotp, getVerifiedTotpFactor, linkAuthIdentity, listPasskeys, registerPasskey, removeTotp,
  sendEmailCode, signInWithProvider, verifyEmailCode, verifyMfaCode,
} from "../lib/auth";
import { openExternalUrl } from "../lib/platform";
import { readJson, storageKeys, writeJson } from "../lib/storage";

export type SavedAccount = { id: string; username: string; email: string; refreshToken: string; avatarUrl?: string };

export const usernameOf = (user: User | null | undefined): string =>
  user?.user_metadata?.username
  || user?.user_metadata?.user_name
  || user?.user_metadata?.preferred_username
  || (user?.email ? user.email.split("@")[0] : null)
  || "Guest";

/** Everything about who is signed in: sessions, the sign-in modal, saved accounts and security settings. */
export function useAccount(notify: (title: string, message: string) => void) {
  const [user, setUser] = useState<User | null>(null);
  const [showAuth, setShowAuth] = useState(false);
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [savedAccounts, setSavedAccounts] = useState<SavedAccount[]>(() =>
    readJson<SavedAccount[]>(storageKeys.accounts, []).slice(0, 5).map((account) => ({
      ...account,
      username: account.username.includes("@") ? account.username.split("@")[0] : account.username,
    })));
  const [authMode, setAuthMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [authError, setAuthError] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authNotice, setAuthNotice] = useState("");
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaFactorId, setMfaFactorId] = useState("");
  const [mfaMessage, setMfaMessage] = useState("");
  const [emailCodeStep, setEmailCodeStep] = useState(false);
  const [emailCode, setEmailCode] = useState("");
  const [emailCodeEmail, setEmailCodeEmail] = useState("");
  const [securityFactors, setSecurityFactors] = useState<any[]>([]);
  const [passkeys, setPasskeys] = useState<any[]>([]);
  const [securityBusy, setSecurityBusy] = useState(false);
  const [mfaSetup, setMfaSetup] = useState<{ id: string; qr: string; secret: string } | null>(null);

  const openSignIn = useCallback(() => { setAuthMode("sign-in"); setAuthError(""); setShowAuth(true); }, []);

  const saveAccountSession = useCallback((sessionUser: User, refreshToken: string) => {
    const account: SavedAccount = {
      id: sessionUser.id,
      username: usernameOf(sessionUser),
      email: sessionUser.email || "",
      refreshToken,
      avatarUrl: typeof sessionUser.user_metadata?.avatar_url === "string" ? sessionUser.user_metadata.avatar_url
        : typeof sessionUser.user_metadata?.picture === "string" ? sessionUser.user_metadata.picture : undefined,
    };
    setSavedAccounts((current) => {
      const next = [account, ...current.filter((item) => item.id !== account.id)].slice(0, 5);
      writeJson(storageKeys.accounts, next);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      if (data.session?.user && data.session.refresh_token) saveAccountSession(data.session.user, data.session.refresh_token);
    }).catch(() => { /* Offline: stay signed out until the next auth event. */ });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user && session.refresh_token) saveAccountSession(session.user, session.refresh_token);
    });
    return () => listener.subscription.unsubscribe();
  }, [saveAccountSession]);

  const loadSecurity = useCallback(async () => {
    if (!supabase) return;
    try {
      const [mfaResult, passkeyResult] = await Promise.all([supabase.auth.mfa.listFactors(), listPasskeys(supabase)]);
      if (!mfaResult.error) setSecurityFactors(mfaResult.data.totp ?? []);
      if (!passkeyResult.error) setPasskeys(passkeyResult.data ?? []);
    } catch { /* Offline: security factors load again on the next sign-in. */ }
  }, []);

  useEffect(() => {
    if (user) void loadSecurity();
    else { setSecurityFactors([]); setPasskeys([]); }
  }, [user?.id, loadSecurity]);

  const switchAccount = async (account: SavedAccount) => {
    if (!supabase || account.id === user?.id) { setShowAccountMenu(false); return; }
    setAuthBusy(true);
    try {
      const { data, error } = await supabase.auth.refreshSession({ refresh_token: account.refreshToken });
      if (error || !data.session) throw error ?? new Error("Unable to restore this saved account.");
      if (data.session.refresh_token) saveAccountSession(data.session.user, data.session.refresh_token);
      setShowAccountMenu(false);
      notify("Account switched", "Now using " + account.username + ".");
    } catch (error) {
      setSavedAccounts((current) => {
        const next = current.filter((item) => item.id !== account.id);
        writeJson(storageKeys.accounts, next);
        return next;
      });
      setAuthError(error instanceof Error ? error.message : "Unable to switch accounts. Please sign in again.");
      setShowAccountMenu(false);
      setShowAuth(true);
    } finally { setAuthBusy(false); }
  };

  const signOut = async () => {
    const currentId = user?.id;
    if (!supabase) return;
    if (currentId) {
      setSavedAccounts((current) => {
        const next = current.filter((item) => item.id !== currentId);
        writeJson(storageKeys.accounts, next);
        return next;
      });
    }
    await supabase.auth.signOut({ scope: "local" });
    setShowAccountMenu(false);
  };

  const completeMfa = async () => {
    if (!supabase || !mfaFactorId || !mfaCode) return;
    setAuthBusy(true);
    try {
      await verifyMfaCode(supabase, mfaFactorId, mfaCode);
      setMfaRequired(false); setMfaCode(""); setMfaMessage(""); setShowAuth(false);
    } catch (error) {
      setMfaMessage(error instanceof Error ? error.message : "Invalid authentication code.");
    } finally { setAuthBusy(false); }
  };

  const requestEmailCode = async () => {
    if (!supabase) return;
    const emailInput = document.querySelector<HTMLInputElement>('input[name="email"]');
    const email = emailInput?.value.trim().toLowerCase() ?? "";
    if (!email) { emailInput?.reportValidity(); setAuthError("Enter your email address first."); return; }
    setAuthBusy(true); setAuthError("");
    try {
      const { error } = await sendEmailCode(supabase, email);
      if (error) throw error;
      setEmailCodeEmail(email); setEmailCode(""); setEmailCodeStep(true);
      setAuthNotice("Verification code sent. Check your email.");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Unable to send the verification code.");
    } finally { setAuthBusy(false); }
  };

  const submitEmailCode = async () => {
    if (!supabase || !emailCodeEmail) return;
    const token = emailCode.replace(/\s/g, "");
    if (!/^\d{6}$/.test(token)) { setAuthError("Enter the 6-digit verification code from your email."); return; }
    setAuthBusy(true); setAuthError("");
    try {
      const { error } = await verifyEmailCode(supabase, emailCodeEmail, token);
      if (error) throw error;
      setAuthNotice("Signed in successfully."); setEmailCodeStep(false); setShowAuth(false);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "The verification code could not be verified.");
    } finally { setAuthBusy(false); }
  };

  const openWebsiteSignIn = () => {
    void openExternalUrl("https://t1nkieplayz.github.io/Mochi-Website/#/signin?app=mochi")
      .catch((error) => setAuthError(error instanceof Error ? error.message : "Unable to open the Mochi website."));
  };

  const signInWith = (provider: "github" | "google") => {
    if (!supabase) return;
    setAuthError("");
    void signInWithProvider(supabase, provider).then(({ error }) => { if (error) setAuthError(error.message); });
  };

  const authenticate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) return;
    setAuthBusy(true); setAuthError("");
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") || "").trim();
    const password = String(form.get("password") || "");
    try {
      const result = authMode === "sign-in"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password, options: { emailRedirectTo: "mochi://auth/verify" } });
      if (result.error) setAuthError(result.error.message);
      else if (authMode === "sign-up") { setAuthNotice("Account created. Check your email if confirmation is enabled."); setShowAuth(false); }
      else {
        const factor = await getVerifiedTotpFactor(supabase);
        if (factor) { setMfaFactorId(factor.id); setMfaRequired(true); setMfaMessage("MFA is enabled on this account. Enter your authenticator code."); }
        else setShowAuth(false);
      }
    } catch (error) {
      // A network failure must not leave the form stuck on "Connecting...".
      setAuthError(error instanceof Error ? error.message : "Unable to reach Mochi. Check your connection and try again.");
    } finally { setAuthBusy(false); }
  };

  const securityAction = async (run: () => Promise<void>, failure: string) => {
    setSecurityBusy(true);
    try { await run(); } catch (error) { setAuthNotice(error instanceof Error ? error.message : failure); }
    finally { setSecurityBusy(false); }
  };

  const addAuthenticator = () => securityAction(async () => {
    if (!supabase) return;
    const { data, error } = await enrollTotp(supabase, "Mochi authenticator");
    if (error) throw error;
    if (data?.totp?.qr_code) {
      setMfaSetup({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret || "" });
      setMfaCode("");
      setAuthNotice("Scan the QR code with your authenticator app, then verify the six-digit code.");
    }
    await loadSecurity();
  }, "Unable to enroll an authenticator.");

  const verifyAuthenticatorSetup = () => securityAction(async () => {
    if (!supabase || !mfaSetup || !mfaCode) return;
    const result = await verifyMfaCode(supabase, mfaSetup.id, mfaCode);
    if (result.error) throw result.error;
    setMfaSetup(null); setMfaCode("");
    setAuthNotice("Authenticator enabled successfully.");
    await loadSecurity();
  }, "The authenticator code could not be verified.");

  const removeAuthenticator = (factorId: string) => securityAction(async () => {
    if (!supabase) return;
    const { error } = await removeTotp(supabase, factorId);
    if (error) throw error;
    setAuthNotice("Authenticator removed.");
    await loadSecurity();
  }, "Unable to remove the authenticator.");

  const addPasskey = () => securityAction(async () => {
    if (!supabase) return;
    const { error } = await registerPasskey(supabase);
    if (error) throw error;
    setAuthNotice("Passkey registered successfully.");
    await loadSecurity();
  }, "Unable to register a passkey.");

  const removePasskey = (passkeyId: string) => securityAction(async () => {
    if (!supabase) return;
    const { error } = await deletePasskey(supabase, passkeyId);
    if (error) throw error;
    setAuthNotice("Passkey removed.");
    await loadSecurity();
  }, "Unable to remove the passkey.");

  const unlinkAuthIdentity = async (provider: "google" | "github") => {
    if (!supabase || !user) return;
    const identity = (user.identities ?? []).find((item) => item.provider === provider);
    if (!identity) return;
    if ((user.identities ?? []).length < 2) { setAuthNotice("Add another sign-in method before unlinking this account."); return; }
    const providerName = provider === "google" ? "Google" : "GitHub";
    if (!window.confirm(`Unlink ${providerName} from your Mochi account? You will no longer be able to sign in with ${providerName} until you connect it again.`)) return;
    setAuthNotice("");
    await securityAction(async () => {
      const { error } = await supabase!.auth.unlinkIdentity(identity);
      if (error) throw error;
      const { data: userData, error: userError } = await supabase!.auth.getUser();
      if (userError) throw userError;
      if (userData.user) setUser(userData.user);
      setAuthNotice(`${providerName} was unlinked from your Mochi account.`);
      await loadSecurity();
    }, `Unable to unlink ${providerName}.`);
  };

  const connectIdentity = (provider: "google" | "github") => {
    if (!supabase) return;
    void linkAuthIdentity(supabase, provider)
      .then(({ error }) => { if (error) setAuthNotice(error.message); })
      .catch((error) => setAuthNotice(error instanceof Error ? error.message : "Unable to connect this account."));
  };

  return {
    user, setUser, showAuth, setShowAuth, showAccountMenu, setShowAccountMenu, savedAccounts, openSignIn,
    authMode, setAuthMode, authError, setAuthError, authBusy, setAuthBusy, authNotice, setAuthNotice,
    mfaRequired, setMfaRequired, mfaCode, setMfaCode, mfaMessage, setMfaMessage, completeMfa,
    emailCodeStep, setEmailCodeStep, emailCode, setEmailCode, emailCodeEmail, requestEmailCode, submitEmailCode,
    openWebsiteSignIn, signInWith, authenticate, switchAccount, signOut, saveAccountSession,
    securityFactors, passkeys, securityBusy, mfaSetup, setMfaSetup,
    addAuthenticator, verifyAuthenticatorSetup, removeAuthenticator, addPasskey, removePasskey, unlinkAuthIdentity, connectIdentity,
  };
}

export type AccountState = ReturnType<typeof useAccount>;
