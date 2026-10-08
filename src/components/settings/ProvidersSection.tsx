import { useSyncExternalStore } from "react";
import { UserRound } from "lucide-react";
import { Select } from "../ui/Select";
import { MochiIcon } from "../MochiIcon";
import { validateNexusApiKey, validateSteamGridDbKey } from "../../lib/providerCredentials";
import { useApp } from "../../state/AppContext";
import { SettingsGroup } from "./Section";

const subscribeOnline = (notify: () => void) => {
  window.addEventListener("online", notify); window.addEventListener("offline", notify);
  return () => { window.removeEventListener("online", notify); window.removeEventListener("offline", notify); };
};

const sourceOptions = [
  { value: "auto" as const, label: "Automatic", description: "IGDB for text, the best available artwork, Steam as a keyless fallback" },
  { value: "igdb" as const, label: "IGDB only", description: "Text, genres, screenshots, trailers and IGDB covers" },
  { value: "steamgriddb" as const, label: "SteamGridDB only", description: "Artwork only; text is left as it is" },
];

export function ProvidersSection() {
  const { account, credentials: c, behavior, setBehavior } = useApp();
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const { user } = account;
  const signIn = <button className="secondary-button" onClick={account.openSignIn}><MochiIcon name="account" fallback={UserRound} size={14} /> Sign in to save</button>;
  const state = (saved: boolean) => <span className={saved ? "credential-status saved" : "credential-status"}>{user ? (saved ? "Saved" : "Not saved") : "Sign in required"}</span>;
  const removeButton = (provider: "igdb" | "nexus" | "steamgriddb", saved: boolean) => saved && <button className="secondary-button danger-outline" onClick={() => void c.remove(provider)} disabled={c.busy !== null}>Remove</button>;
  return <SettingsGroup title="Mod & metadata providers" subtitle="Credentials are encrypted with Supabase Vault" id="settings-providers">
    <div className="setting-row">
      <span><strong>Metadata source</strong><small>Choose where Mochi gets descriptions and artwork. Automatic combines every provider you have set up.</small></span>
      <Select label="Metadata source" value={behavior.metadataProvider} options={sourceOptions} onChange={(metadataProvider) => setBehavior((current) => ({ ...current, metadataProvider }))} />
    </div>
    <small className="metadata-note settings-note" role="status">
      Ready: {[user && c.status.igdb ? "IGDB" : null, user && c.status.steamgriddb ? "SteamGridDB" : null, "Steam Store (Steam games, no key needed)"].filter(Boolean).join(", ")}.
      {!online && " You are offline: Mochi keeps showing saved details and artwork and will refresh when you reconnect."}
    </small>
    <div className="provider-grid">
      <div className="provider-credential-card">
        <div className="provider-credential-heading"><div><strong>IGDB</strong><small>Descriptions, genres, release dates, screenshots and trailers. Needs a free Twitch Client ID and Secret.</small></div>{state(c.status.igdb)}</div>
        {user ? <>
          <div className="provider-fields"><input value={c.igdbClientId} onChange={(event) => c.setIgdbClientId(event.target.value)} placeholder="Twitch Client ID" aria-label="Twitch Client ID" autoComplete="off" /><input type="password" value={c.igdbClientSecret} onChange={(event) => c.setIgdbClientSecret(event.target.value)} placeholder="Twitch Client Secret" aria-label="Twitch Client Secret" autoComplete="off" /></div>
          <button className="secondary-button" onClick={() => void c.save("igdb")} disabled={c.busy !== null}>{c.busy === "igdb" ? "Saving..." : "Save IGDB securely"}</button>{removeButton("igdb", c.status.igdb)}
        </> : signIn}
      </div>
      <div className="provider-credential-card">
        <div className="provider-credential-heading"><div><strong>SteamGridDB</strong><small>Community cover art, heroes, logos and icons. Needs a free API key from your SteamGridDB preferences page.</small></div>{state(c.status.steamgriddb)}</div>
        {user ? <>
          <input type="password" value={c.steamGridDbKey} maxLength={256} onChange={(event) => c.setSteamGridDbKey(event.target.value)} placeholder={c.status.steamgriddb ? "Enter a new key to replace the saved key" : "Paste your SteamGridDB API key"} aria-label="SteamGridDB API key" autoComplete="off" spellCheck={false} />
          <button className="secondary-button" onClick={() => void c.save("steamgriddb")} disabled={c.busy !== null || Boolean(validateSteamGridDbKey(c.steamGridDbKey))}>{c.busy === "steamgriddb" ? "Saving..." : "Save SteamGridDB securely"}</button>{removeButton("steamgriddb", c.status.steamgriddb)}
        </> : signIn}
      </div>
      <div className="provider-credential-card">
        <div className="provider-credential-heading"><div><strong>Nexus Mods</strong><small>Your Nexus API key is stored server-side and is never returned to the launcher.</small></div>{state(c.status.nexus)}</div>
        {user ? <>
          <input type="password" value={c.nexusApiKey} maxLength={4096} onChange={(event) => c.setNexusApiKey(event.target.value)} placeholder={c.status.nexus ? "Enter a new key to replace the saved key" : "Paste your Nexus Mods Personal API Key"} aria-label="Nexus Mods API key" autoComplete="off" spellCheck={false} />
          <small className="metadata-note">Use the full Personal API Key (at least 32 characters). Mochi verifies it with Nexus Mods before saving.</small>
          <button className="secondary-button" onClick={() => void c.save("nexus")} disabled={c.busy !== null || Boolean(validateNexusApiKey(c.nexusApiKey))}>{c.busy === "nexus" ? "Validating..." : "Save Nexus securely"}</button>{removeButton("nexus", c.status.nexus)}
        </> : signIn}
      </div>
    </div>
    {c.message && <small className="metadata-note settings-note" role="status">{c.message}</small>}
  </SettingsGroup>;
}
