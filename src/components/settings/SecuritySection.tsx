import { Github, KeyRound, ShieldCheck, Unlink } from "lucide-react";
import { MochiIcon } from "../MochiIcon";
import { useApp } from "../../state/AppContext";
import { SettingsGroup } from "./Section";

export function SecuritySection() {
  const { account: a } = useApp();
  const user = a.user;
  const verified = a.securityFactors.filter((factor) => factor.status === "verified");
  return <SettingsGroup title="Security" subtitle="Account protection and sign-in methods" id="settings-security" className="security-settings-group">
    {user ? <div className="security-settings">
      <div className="security-card"><div className="security-card-icon"><MochiIcon name="security" fallback={ShieldCheck} size={18}/></div><div className="security-card-copy"><strong>Authenticator app</strong><small>{verified.length ? "Two-factor authentication is enabled." : "Use a time-based one-time password for an extra layer of protection."}</small></div><span className={verified.length ? "credential-status saved" : "credential-status"}>{verified.length ? "Enabled" : "Not configured"}</span></div>
      {a.mfaSetup ? <div className="mfa-setup-card"><div><strong>Set up your authenticator</strong><small>Scan this QR code in your authenticator app.</small></div><img src={a.mfaSetup.qr} alt="Authenticator setup QR code" /><code>{a.mfaSetup.secret}</code><div className="mfa-setup-actions"><input className="mfa-input" inputMode="numeric" aria-label="Six digit authenticator code" value={a.mfaCode} onChange={(e) => a.setMfaCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" maxLength={6}/><button className="secondary-button" disabled={a.securityBusy || a.mfaCode.length !== 6} onClick={() => void a.verifyAuthenticatorSetup()}>Verify</button><button className="secondary-button" disabled={a.securityBusy} onClick={() => { a.setMfaSetup(null); a.setMfaCode(""); }}>Cancel</button></div></div>
        : <div className="security-actions"><button className="secondary-button" onClick={() => void a.addAuthenticator()} disabled={a.securityBusy}>{verified.length ? "Add another authenticator" : "Set up authenticator"}</button>{verified.map((factor) => <button key={factor.id} className="secondary-button danger-outline" disabled={a.securityBusy} onClick={() => void a.removeAuthenticator(factor.id)}>Remove authenticator</button>)}</div>}
      <div className="security-card"><div className="security-card-icon"><Github size={18}/></div><div className="security-card-copy"><strong>Connected accounts</strong><small>Google and GitHub identities linked to this Mochi account.</small></div></div>
      <div className="security-provider-grid">{(["google", "github"] as const).map((provider) => {
        const connected = (user.identities ?? []).find((identity) => identity.provider === provider);
        const canUnlink = (user.identities ?? []).length > 1;
        const label = provider === "google" ? "Google" : "GitHub";
        return <div className="security-provider" key={provider}>
          <span className="security-provider-copy"><strong>{label}</strong><small>{connected ? "Connected" : "Not connected"}</small></span>
          {connected
            ? <button type="button" className="secondary-button danger-outline security-provider-action" onClick={() => void a.unlinkAuthIdentity(provider)} disabled={a.securityBusy || !canUnlink} title={canUnlink ? "Unlink " + label : "Add another sign-in method before unlinking this account."}><Unlink size={13} /> {canUnlink ? "Unlink" : "Required"}</button>
            : <button type="button" className="secondary-button security-provider-action" onClick={() => a.connectIdentity(provider)} disabled={a.securityBusy}>Connect</button>}
        </div>;
      })}</div>
      <div className="security-card"><div className="security-card-icon"><KeyRound size={18}/></div><div className="security-card-copy"><strong>Passkeys</strong><small>Use a device, password manager, biometrics, or security key instead of a password.</small></div></div>
      <div className="passkey-list">{a.passkeys.length ? a.passkeys.map((passkey) => <div className="passkey-row" key={passkey.id}><span><strong>{passkey.friendly_name || "Mochi passkey"}</strong><small>Added {passkey.created_at ? new Date(passkey.created_at).toLocaleDateString() : "recently"}</small></span><button className="secondary-button danger-outline" disabled={a.securityBusy} onClick={() => void a.removePasskey(passkey.id)}>Remove</button></div>) : <small className="metadata-note">No passkeys registered yet.</small>}<button className="secondary-button" disabled={a.securityBusy} onClick={() => void a.addPasskey()}>{a.securityBusy ? "Working..." : "Set up a passkey"}</button></div>
      {a.authNotice && <small className="metadata-note security-notice" role="status">{a.authNotice}</small>}
    </div> : <div className="security-signed-out"><ShieldCheck size={18}/><span>Sign in to manage authenticator, connected-account, and passkey settings.</span><button className="secondary-button" onClick={a.openSignIn}>Sign in</button></div>}
  </SettingsGroup>;
}
