import { Github, KeyRound, ShieldCheck, Unlink } from "lucide-react";
import { useTranslation } from "../../lib/useTranslation";
import { MochiIcon } from "../MochiIcon";
import { useApp } from "../../state/AppContext";
import { SettingsGroup } from "./Section";
import { confirmAction } from "../../lib/confirm";

export function SecuritySection() {
  const t = useTranslation();
  const { account: a } = useApp();
  const user = a.user;
  const verified = a.securityFactors.filter((factor) => factor.status === "verified");
  return <SettingsGroup title={t("Security")} subtitle={t("Account protection and sign-in methods")} id="settings-security" className="security-settings-group">
    {user ? <div className="security-settings">
      <div className="security-card"><div className="security-card-icon"><MochiIcon name="security" fallback={ShieldCheck} size={18}/></div><div className="security-card-copy"><strong>{t("Authenticator app")}</strong><small>{verified.length ? t("Two-factor authentication is enabled.") : t("Use a time-based one-time password for an extra layer of protection.")}</small></div><span className={verified.length ? "credential-status saved" : "credential-status"}>{verified.length ? t("Enabled") : t("Not configured")}</span></div>
      {a.mfaSetup ? <div className="mfa-setup-card"><div><strong>{t("Set up your authenticator")}</strong><small>{t("Scan this QR code in your authenticator app.")}</small></div><img src={a.mfaSetup.qr} alt={t("Authenticator setup QR code")} /><code>{a.mfaSetup.secret}</code><div className="mfa-setup-actions"><input className="mfa-input" inputMode="numeric" aria-label={t("Six digit authenticator code")} value={a.mfaCode} onChange={(e) => a.setMfaCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder={t("Six digit code")} maxLength={6}/><button className="secondary-button" disabled={a.securityBusy || a.mfaCode.length !== 6} onClick={() => void a.verifyAuthenticatorSetup()}>{t("Verify")}</button><button className="secondary-button" disabled={a.securityBusy} onClick={() => { a.setMfaSetup(null); a.setMfaCode(""); }}>{t("Cancel")}</button></div></div>
        : <div className="security-actions"><button className="secondary-button" onClick={() => void a.addAuthenticator()} disabled={a.securityBusy}>{verified.length ? t(t("Add another authenticator")) : t(t("Set up authenticator"))}</button>{verified.map((factor) => <button key={factor.id} className="secondary-button danger-outline" disabled={a.securityBusy} onClick={() => void confirmAction({ title: t("Remove this authenticator?"), danger: true, confirmLabel: t("Remove authenticator"), message: t("Sign-in no longer asks for its codes. You can set up an authenticator again at any time."), items: [factor.friendly_name || "Authenticator app"] }).then((ok) => { if (ok) void a.removeAuthenticator(factor.id); })}>{t("Remove authenticator")}</button>)}</div>}
      <div className="security-card"><div className="security-card-icon"><Github size={18}/></div><div className="security-card-copy"><strong>{t("Connected accounts")}</strong><small>{t("Google and GitHub identities linked to this Mochi account.")}</small></div></div>
      <div className="security-provider-grid">{(["google", "github"] as const).map((provider) => {
        const connected = (user.identities ?? []).find((identity) => identity.provider === provider);
        const canUnlink = (user.identities ?? []).length > 1;
        const label = provider === "google" ? "Google" : "GitHub";
        return <div className="security-provider" key={provider}>
          <span className="security-provider-copy"><strong>{label}</strong><small>{connected ? t("Connected") : t("Not connected")}</small></span>
          {connected
            ? <button type="button" className="secondary-button danger-outline security-provider-action" onClick={() => void a.unlinkAuthIdentity(provider)} disabled={a.securityBusy || !canUnlink} title={canUnlink ? "Unlink " + label : t("Add another sign-in method before unlinking this account.")}><Unlink size={13} /> {canUnlink ? t("Unlink") : t("Required")}</button>
            : <button type="button" className="secondary-button security-provider-action" onClick={() => a.connectIdentity(provider)} disabled={a.securityBusy}>{t("Connect")}</button>}
        </div>;
      })}</div>
      <div className="security-card"><div className="security-card-icon"><KeyRound size={18}/></div><div className="security-card-copy"><strong>{t("Passkeys")}</strong><small>{t("Use a device, password manager, biometrics, or security key instead of a password.")}</small></div></div>
      <div className="passkey-list">{a.passkeys.length ? a.passkeys.map((passkey) => <div className="passkey-row" key={passkey.id}><span><strong>{passkey.friendly_name || t("Mochi passkey")}</strong><small>{t("Added {date}").replace("{date}", passkey.created_at ? new Date(passkey.created_at).toLocaleDateString() : t("recently"))}</small></span><button className="secondary-button danger-outline" disabled={a.securityBusy} onClick={() => void confirmAction({ title: t("Remove this passkey?"), danger: true, confirmLabel: t("Remove passkey"), message: t("You can no longer sign in to Mochi with it. Other sign-in methods keep working."), items: [passkey.friendly_name || t("Mochi passkey")] }).then((ok) => { if (ok) void a.removePasskey(passkey.id); })}>{t("Remove")}</button></div>) : <small className="metadata-note">{t("No passkeys registered yet.")}</small>}<p className="metadata-note">{t("To register a new passkey, use the Mochi account dashboard in your web browser. Existing passkeys can still be removed here.")}</p></div>
      {a.authNotice && <small className="metadata-note security-notice" role="status">{a.authNotice}</small>}
    </div> : <div className="security-signed-out"><ShieldCheck size={18}/><span>{t("Sign in to manage authenticator, connected-account, and passkey settings.")}</span><button className="secondary-button" onClick={a.openSignIn}>{t("Sign in")}</button></div>}
  </SettingsGroup>;
}
