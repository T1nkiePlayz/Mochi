import { Github, ShieldCheck, X } from "lucide-react";
import { MochiIcon } from "./MochiIcon";
import { useApp } from "../state/AppContext";
import { useTranslation } from "../lib/useTranslation";

function GoogleIcon({ size = 15 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.35 12.27c0-.71-.06-1.39-.18-2.04H12v3.86h5.24a4.48 4.48 0 0 1-1.94 2.94v2.45h3.14c1.84-1.69 2.91-4.18 2.91-7.21Z"/><path fill="#34A853" d="M12 21.6c2.63 0 4.84-.87 6.45-2.36l-3.14-2.45c-.87.58-1.98.93-3.31.93-2.54 0-4.69-1.72-5.46-4.03H3.3v2.53A9.74 9.74 0 0 0 12 21.6Z"/><path fill="#FBBC05" d="M6.54 13.69A5.84 5.84 0 0 1 6.23 12c0-.59.11-1.16.31-1.69V7.78H3.3A9.72 9.72 0 0 0 2.27 12c0 1.57.38 3.05 1.03 4.22l3.24-2.53Z"/><path fill="#EA4335" d="M12 6.28c1.43 0 2.71.49 3.72 1.46l2.79-2.79C16.83 3.3 14.63 2.4 12 2.4a9.74 9.74 0 0 0-8.7 5.38l3.24 2.53C7.31 8 9.46 6.28 12 6.28Z"/></svg>;
}

export function AuthModal() {
  const t = useTranslation();
  const { account: a } = useApp();
  const close = () => a.setShowAuth(false);
  return <div className="modal-backdrop" onClick={close}><form className="modal auth-modal" onSubmit={a.authenticate} onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
    <div className="modal-header"><div className="auth-brand"><img src="/mochi-mark.png" alt="Mochi" /><div><p className="eyebrow">Mochi Cloud</p><h2>{a.emailCodeStep ? t("Check your email.") : a.authMode === "sign-in" ? t("Welcome back.") : t("Create your account.")}</h2></div></div><button className="icon-button" type="button" aria-label="Close" onClick={close}><MochiIcon name="close" fallback={X} size={17} /></button></div>
    {a.emailCodeStep ? <>
      <p className="modal-description">{t("We sent a six-digit verification code to {email}. Enter it below to finish signing in.").replace("{email}", a.emailCodeEmail)}</p>
      <div className="form-fields"><label>Verification code<input className="mfa-input" inputMode="numeric" autoComplete="one-time-code" value={a.emailCode} onChange={(e) => a.setEmailCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="123456" maxLength={6} /></label></div>
      {a.authError && <p className="auth-error">{a.authError}</p>}
      {a.authNotice && <p className="auth-notice">{a.authNotice}</p>}
      <button className="play-button form-submit" type="button" disabled={a.authBusy || a.emailCode.length !== 6} onClick={a.submitEmailCode}>{a.authBusy ? t("Verifying...") : t("Verify and sign in")}</button>
      <button type="button" className="switch-auth" onClick={() => { a.setEmailCodeStep(false); a.setAuthError(""); a.setAuthNotice(""); }}>{t("Use a different sign-in method")}</button>
    </> : <>
      <p className="modal-description">{a.authMode === "sign-in" ? t("Sign in to access your securely stored API credentials and, if you enable it, keep Mochi metadata available across devices.") : t("Your games stay local. Your Mochi metadata can follow you.")}</p>
      <div className="form-fields"><label>Email<input name="email" type="email" placeholder="you@example.com" required /></label><label>Password<input name="password" type="password" minLength={6} placeholder="At least 6 characters" required /></label></div>
      {a.authError && <p className="auth-error">{a.authError}</p>}{a.authNotice && <p className="auth-notice">{a.authNotice}</p>}
      {a.mfaRequired ? <div className="mfa-challenge"><div className="mfa-shield"><MochiIcon name="security" fallback={ShieldCheck} size={25}/></div><p className="mfa-title">Two-factor authentication</p><p className="mfa-description">{a.mfaMessage}</p><label className="mfa-code-label">Authentication code<input className="mfa-input" inputMode="numeric" autoComplete="one-time-code" aria-label="Six digit authentication code" value={a.mfaCode} onChange={(e) => a.setMfaCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" maxLength={6} autoFocus /></label><button className="play-button form-submit" type="button" disabled={a.authBusy || a.mfaCode.length !== 6} onClick={a.completeMfa}>{a.authBusy ? t("Verifying...") : t("Verify and continue")}</button><button className="switch-auth" type="button" onClick={() => { a.setMfaRequired(false); a.setMfaCode(""); a.setMfaMessage(""); }}>{t("Use another sign-in method")}</button></div> : <><button className="play-button form-submit" disabled={a.authBusy} type="submit">{a.authBusy ? t("Connecting...") : a.authMode === "sign-in" ? t("Sign in") : t("Create account")}</button>
      <div className="auth-provider-row auth-provider-row-three"><button type="button" className="secondary-button" onClick={a.requestEmailCode}>{a.authBusy ? t("Sending...") : t("Sign in with code")}</button><button type="button" className="secondary-button" onClick={() => a.signInWith("github")}><MochiIcon name="github" fallback={Github} size={15}/> GitHub</button><button type="button" className="secondary-button" onClick={() => a.signInWith("google")}><GoogleIcon /> Google</button></div>
      <div className="auth-website-row"><button type="button" className="secondary-button" onClick={a.openWebsiteSignIn}>Use website</button></div>
      <button className="switch-auth" type="button" onClick={() => { a.setAuthMode(a.authMode === "sign-in" ? "sign-up" : "sign-in"); a.setAuthError(""); a.setAuthNotice(""); }}>{a.authMode === "sign-in" ? t("New to Mochi? Create an account") : t("Already have an account? Sign in")}</button></>}
    </>}
  </form></div>;
}
