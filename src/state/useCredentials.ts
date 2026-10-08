import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import {
  deleteProviderCredential, getProviderCredentialStatuses, saveProviderCredential, validateNexusApiKey,
  validateSteamGridDbKey, type ProviderCredential,
} from "../lib/providerCredentials";

export type CredentialStatus = Record<ProviderCredential, boolean>;
const none: CredentialStatus = { igdb: false, nexus: false, steamgriddb: false };

export const providerLabels: Record<ProviderCredential, string> = { igdb: "IGDB", nexus: "Nexus Mods", steamgriddb: "SteamGridDB" };

/** Provider API keys. They live in Supabase Vault; the launcher only ever learns whether one is saved. */
export function useCredentials(user: User | null, requireSignIn: () => void) {
  const [status, setStatus] = useState<CredentialStatus>(none);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<ProviderCredential | null>(null);
  const [message, setMessage] = useState("");
  const [igdbClientId, setIgdbClientId] = useState("");
  const [igdbClientSecret, setIgdbClientSecret] = useState("");
  const [nexusApiKey, setNexusApiKey] = useState("");
  const [steamGridDbKey, setSteamGridDbKey] = useState("");

  useEffect(() => {
    if (!supabase || !user) { setStatus(none); setLoaded(false); return; }
    void getProviderCredentialStatuses(supabase)
      .then((statuses) => { setStatus(statuses); setLoaded(true); })
      .catch((error) => console.warn("Mochi provider credential status unavailable", error));
  }, [user?.id]);

  const remove = async (provider: ProviderCredential) => {
    if (!supabase || !user || !window.confirm(`Remove your saved ${providerLabels[provider]} credentials from Mochi Vault?`)) return;
    setBusy(provider);
    try {
      await deleteProviderCredential(supabase, provider);
      setStatus((current) => ({ ...current, [provider]: false }));
      setMessage("Credentials removed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to remove the credentials.");
    } finally { setBusy(null); }
  };

  const save = async (provider: ProviderCredential) => {
    if (!supabase || !user) { requireSignIn(); return; }
    let secret = "";
    if (provider === "igdb") {
      if (!igdbClientId.trim() || !igdbClientSecret.trim()) { setMessage("Enter your IGDB Client ID and Client Secret first."); return; }
      secret = JSON.stringify({ clientId: igdbClientId.trim(), clientSecret: igdbClientSecret.trim() });
    } else if (provider === "nexus") {
      const problem = validateNexusApiKey(nexusApiKey);
      if (problem) { setMessage(problem); return; }
      secret = nexusApiKey.trim();
    } else {
      const problem = validateSteamGridDbKey(steamGridDbKey);
      if (problem) { setMessage(problem); return; }
      secret = steamGridDbKey.trim();
    }
    setBusy(provider);
    try {
      await saveProviderCredential(supabase, provider, secret);
      setStatus((current) => ({ ...current, [provider]: true }));
      if (provider === "nexus") setNexusApiKey("");
      if (provider === "steamgriddb") setSteamGridDbKey("");
      setMessage(`${providerLabels[provider]} saved securely to Mochi Vault.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save provider credentials.");
    } finally { setBusy(null); }
  };

  return {
    status, loaded, busy, message, setMessage, save, remove,
    igdbClientId, setIgdbClientId, igdbClientSecret, setIgdbClientSecret,
    nexusApiKey, setNexusApiKey, steamGridDbKey, setSteamGridDbKey,
  };
}

export type CredentialsState = ReturnType<typeof useCredentials>;
