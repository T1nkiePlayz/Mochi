import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { clearAccountCloudData, getCloudAccountSettings, pullLibrary, pushLibrary } from "../lib/cloud";
import type { Piko } from "../models";

export type SyncState = "offline" | "syncing" | "synced" | "error";

/** Optional cloud metadata sync: pulls on sign-in, then pushes (debounced) whenever the library changes. */
export function useCloudSync(user: User | null, library: Piko[], setLibrary: Dispatch<SetStateAction<Piko[]>>, storageReady: boolean, storageKey: string) {
  const [syncState, setSyncState] = useState<SyncState>("offline");
  const [cloudSyncEnabled, setCloudSyncEnabled] = useState(false);
  const [cloudDataAccessAllowed, setCloudDataAccessAllowed] = useState(false);
  const [cloudDataBusy, setCloudDataBusy] = useState(false);
  const [cloudDataMessage, setCloudDataMessage] = useState("");
  const initialized = useRef(false);

  useEffect(() => {
    if (!storageReady) return;
    if (!supabase || !user) {
      initialized.current = false;
      setCloudSyncEnabled(false); setCloudDataAccessAllowed(false); setSyncState("offline");
      return;
    }
    let cancelled = false;
    const client = supabase;
    setSyncState("syncing");
    void getCloudAccountSettings(client, user.id)
      .then(async (settings) => {
        if (cancelled) return;
        setCloudDataAccessAllowed(settings.metadataSyncAllowed);
        setCloudSyncEnabled(settings.syncEnabled);
        if (!settings.syncEnabled) { initialized.current = false; setSyncState("offline"); return; }
        const cloudLibrary = await pullLibrary(client, user.id);
        if (cancelled) return;
        if (cloudLibrary.length) {
          // Merge instead of replacing so games that only exist on this device are not lost.
          const cloudIds = new Set(cloudLibrary.map((piko) => piko.id));
          setLibrary((local) => [...cloudLibrary, ...local.filter((piko) => !cloudIds.has(piko.id))]);
        } else {
          await pushLibrary(client, library);
        }
        initialized.current = true;
        setSyncState("synced");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        console.error("Mochi cloud sync failed", error);
        initialized.current = false;
        setCloudDataAccessAllowed(false); setCloudSyncEnabled(false); setSyncState("error");
      });
    return () => { cancelled = true; };
  }, [user?.id, storageReady, storageKey]);

  useEffect(() => {
    if (!storageReady || !supabase || !user || !cloudSyncEnabled || !initialized.current) return;
    const client = supabase;
    setSyncState("syncing");
    // Debounced: imports and metadata refreshes change the library many times in a burst.
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void pushLibrary(client, library)
        .then(() => { if (!cancelled) setSyncState("synced"); })
        .catch((error: unknown) => { console.error("Mochi cloud sync failed", error); if (!cancelled) setSyncState("error"); });
    }, 1200);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [library, user?.id, cloudSyncEnabled, storageReady, storageKey]);

  const clearCloudData = async () => {
    if (!supabase || !user || !cloudDataAccessAllowed || cloudDataBusy) return;
    if (!window.confirm("Delete all Mochi Cloud Pikos and Tofus for this account? Your local library, account, and saved provider credentials will not be changed.")) return;
    setCloudDataBusy(true); setCloudDataMessage("");
    try {
      const deleted = await clearAccountCloudData(supabase);
      initialized.current = cloudSyncEnabled;
      setSyncState(cloudSyncEnabled ? "synced" : "offline");
      setCloudDataMessage(`Cloud library cleared. Removed ${deleted.deleted_pikos} Pikos and ${deleted.deleted_tofus} Tofus. Your local library and saved provider credentials were not changed.`);
    } catch (error) {
      setCloudDataMessage(error instanceof Error ? error.message : "Unable to clear cloud library data.");
    } finally { setCloudDataBusy(false); }
  };

  return { syncState, cloudSyncEnabled, cloudDataAccessAllowed, cloudDataBusy, cloudDataMessage, clearCloudData };
}
