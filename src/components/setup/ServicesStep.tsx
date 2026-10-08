import { Check, KeyRound, LoaderCircle, Plug } from "lucide-react";
import { validateNexusApiKey, validateSteamGridDbKey, type ProviderCredential } from "../../lib/providerCredentials";

export type ServicesProps = {
  signedIn: boolean;
  credentialStatus: Record<ProviderCredential, boolean>;
  credentialStatusLoaded: boolean;
  credentialBusy: ProviderCredential | null;
  saveCredential: (provider: ProviderCredential) => Promise<void>;
  igdbClientId: string; setIgdbClientId: (value: string) => void;
  igdbClientSecret: string; setIgdbClientSecret: (value: string) => void;
  nexusApiKey: string; setNexusApiKey: (value: string) => void;
  steamGridDbKey: string; setSteamGridDbKey: (value: string) => void;
};

function Configured() {
  return <div className="setup-provider-configured"><Check size={16} /><strong>Configured</strong><small>Saved securely to your account</small></div>;
}

export function ServicesStep(p: ServicesProps) {
  const { credentialStatus: status, credentialBusy: busy, saveCredential } = p;
  return (
    <section className="setup-page setup-form-page">
      <div className="setup-icon"><Plug size={22} /></div>
      <h1>Connect your game services.</h1>
      <p className="setup-description">Optional keys that unlock richer game pages. They are stored in your account vault and cannot be read back.</p>
      {!p.signedIn ? (
        <div className="setup-no-sources"><KeyRound size={20} /><strong>Sign in to add keys.</strong><span>You can do this later from Settings.</span></div>
      ) : !p.credentialStatusLoaded ? (
        <div className="setup-scan-state"><LoaderCircle size={20} className="spin" /><span>Checking your saved keys…</span></div>
      ) : (
        <div className="setup-provider-fields">
          <div className={"setup-provider-card" + (status.igdb ? " configured" : "")}>
            <div><strong>IGDB</strong><span>Fills in descriptions, release dates, screenshots and cover art. Use a Twitch application Client ID and Secret.</span></div>
            {status.igdb && <Configured />}
            {!status.igdb && <>
              <label>Client ID<input value={p.igdbClientId} onChange={(event) => p.setIgdbClientId(event.target.value)} placeholder="Twitch Client ID" autoComplete="off" /></label>
              <label>Client Secret<input type="password" value={p.igdbClientSecret} onChange={(event) => p.setIgdbClientSecret(event.target.value)} placeholder="Twitch Client Secret" autoComplete="off" /></label>
            </>}
            <button type="button" className="secondary-button" disabled={busy === "igdb" || !p.igdbClientId.trim() || !p.igdbClientSecret.trim()} onClick={() => void saveCredential("igdb")}>{busy === "igdb" ? "Saving…" : status.igdb ? "Replace IGDB keys" : "Save IGDB keys"}</button>
          </div>
          <div className={"setup-provider-card" + (status.nexus ? " configured" : "")}>
            <div><strong>Nexus Mods</strong><span>Lets you browse and install Nexus mods for your games from inside Mochi.</span></div>
            {status.nexus ? <Configured /> : <label>Personal API key<input type="password" maxLength={4096} value={p.nexusApiKey} onChange={(event) => p.setNexusApiKey(event.target.value)} placeholder="Nexus Mods API key" autoComplete="off" spellCheck={false} /></label>}
            <button type="button" className="secondary-button" disabled={busy === "nexus" || Boolean(validateNexusApiKey(p.nexusApiKey))} onClick={() => void saveCredential("nexus")}>{busy === "nexus" ? "Saving…" : status.nexus ? "Replace Nexus key" : "Save Nexus key"}</button>
          </div>
          <div className={"setup-provider-card" + (status.steamgriddb ? " configured" : "")}>
            <div><strong>SteamGridDB</strong><span>Finds community grids, heroes and logos so your library covers look great.</span></div>
            {status.steamgriddb ? <Configured /> : <label>API key<input type="password" maxLength={4096} value={p.steamGridDbKey} onChange={(event) => p.setSteamGridDbKey(event.target.value)} placeholder="SteamGridDB API key" autoComplete="off" spellCheck={false} /></label>}
            <button type="button" className="secondary-button" disabled={busy === "steamgriddb" || Boolean(validateSteamGridDbKey(p.steamGridDbKey))} onClick={() => void saveCredential("steamgriddb")}>{busy === "steamgriddb" ? "Saving…" : status.steamgriddb ? "Replace SteamGridDB key" : "Save SteamGridDB key"}</button>
          </div>
        </div>
      )}
    </section>
  );
}
