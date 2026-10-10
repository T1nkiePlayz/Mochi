import { confirmAction } from "../lib/confirm";
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { confirmedAfterClear, confirmedAfterPull, createSyncScheduler, isRetryableSyncError, loadConfirmedCache, saveConfirmedCache, type SyncScheduler } from "../lib/cloudStatus";
import { clearAccountCloudData, getCloudAccountSettings, mergeCloudLibrary, pullLibrary, pushLibrary } from "../lib/cloud";
import type { Piko } from "../models";
import { isNetworkError } from "../lib/offline";

export type SyncState = "offline" | "syncing" | "retrying" | "synced" | "empty" | "error";

const isRetryableCloudError = (error: unknown) => isNetworkError(error) || isRetryableSyncError(error);

/** Optional cloud metadata sync: pulls on sign-in, then pushes (debounced) whenever the library changes. */
export function useCloudSync(user: User | null, library: Piko[], setLibrary: Dispatch<SetStateAction<Piko[]>>, storageReady: boolean, storageKey: string) {
  const [syncState, setSyncState] = useState<SyncState>("offline");
  const [cloudSyncEnabled, setCloudSyncEnabled] = useState(false);
  const [cloudDataAccessAllowed, setCloudDataAccessAllowed] = useState(false);
  const [cloudDataBusy, setCloudDataBusy] = useState(false);
  const [cloudDataMessage, setCloudDataMessage] = useState("");
  const [confirmedIds, setConfirmedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [retryToken, setRetryToken] = useState(0);
  const initialized = useRef(false);
  const retryAttempt = useRef(0);
  const libraryRef = useRef(library);
  const schedulerRef = useRef<SyncScheduler | null>(null);
  libraryRef.current = library;
  const buildScheduler = (client: SupabaseClient, userId: string, isStale: () => boolean) => createSyncScheduler(async () => {
    try {
      setSyncState("syncing");
      const ids = await pushLibrary(client, libraryRef.current);
      if (isStale()) return;
      confirm(userId, ids); setSyncState("synced");
    } catch (error) {
      if (!isStale()) {
        if (!isNetworkError(error)) console.error("Mochi cloud sync failed", error);
        setSyncState(isRetryableCloudError(error) ? "retrying" : "error");
      }
      throw error;
    }
  }, { shouldRetry: isRetryableCloudError });
  const confirm = (userId: string, ids: ReadonlySet<string>) => { setConfirmedIds(ids); saveConfirmedCache(userId, ids); };

  useEffect(() => {
    if (!storageReady) return;
    if (!supabase || !user) {
      initialized.current = false; schedulerRef.current?.cancel(); schedulerRef.current = null;
      setCloudSyncEnabled(false); setCloudDataAccessAllowed(false); setSyncState("offline"); setConfirmedIds(new Set());
      return;
    }
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const client = supabase;
    // A different account must never inherit the previous account's "ready to push" state while its own settings load.
    initialized.current = false; schedulerRef.current?.cancel(); schedulerRef.current = null;
    setCloudSyncEnabled(false); setCloudDataAccessAllowed(false);
    setConfirmedIds(loadConfirmedCache(user.id));
    setSyncState("syncing");
    const retryWhenOnline = () => { retryAttempt.current = 0; setRetryToken((token) => token + 1); };
    window.addEventListener("online", retryWhenOnline);
    void getCloudAccountSettings(client, user.id)
      .then(async (settings) => {
        if (cancelled) return;
        retryAttempt.current = 0;
        setCloudDataAccessAllowed(settings.metadataSyncAllowed);
        setCloudSyncEnabled(settings.syncEnabled);
        if (!settings.syncEnabled) { initialized.current = false; setSyncState("offline"); confirm(user.id, new Set()); return; }
        const scheduler = buildScheduler(client, user.id, () => cancelled);
        const cloudLibrary = await pullLibrary(client, user.id);
        if (cancelled) { scheduler.cancel(); return; }
        retryAttempt.current = 0;
        schedulerRef.current = scheduler;
        // The pull is the source of truth for what is in the cloud.
        confirm(user.id, confirmedAfterPull(cloudLibrary));
        initialized.current = true;
        if (cloudLibrary.length) {
          // Merge instead of replacing so games and settings that only exist on this device are not lost.
          setLibrary((local) => mergeCloudLibrary(local, cloudLibrary));
          const cloudIds = confirmedAfterPull(cloudLibrary);
          if (libraryRef.current.some((piko) => !cloudIds.has(piko.id))) { setSyncState("syncing"); scheduler.notify(); return; }
        } else {
          setSyncState("syncing"); scheduler.notify(); return;
        }
        setSyncState("synced");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        initialized.current = false;
        // Initialization (settings + pull) must recover too; previously only pushes retried, leaving
        // a transient startup failure stuck at "error" until the account or app restarted.
        if (!isNetworkError(error)) console.error("Mochi cloud sync initialization failed", error);
        const retryable = isRetryableCloudError(error);
        setSyncState(retryable ? "retrying" : "error");
        if (retryable) {
          const delay = Math.min(60000, 2000 * 2 ** retryAttempt.current++);
          retryTimer = setTimeout(() => { if (!cancelled) setRetryToken((token) => token + 1); }, delay);
        }
      });
    return () => { cancelled = true; if (retryTimer !== undefined) clearTimeout(retryTimer); window.removeEventListener("online", retryWhenOnline); schedulerRef.current?.cancel(); schedulerRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- a new sync starts only for a different account or storage, not when callbacks change identity
  }, [user?.id, storageReady, storageKey, retryToken]);

  // Any library change (import, enrichment, edits) asks the scheduler for a push; it debounces with a max wait and retries with backoff.
  useEffect(() => {
    libraryRef.current = library;
    if (!storageReady || !supabase || !user || !cloudSyncEnabled || !initialized.current || !schedulerRef.current) return;
    setSyncState("syncing");
    schedulerRef.current.notify();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the account id, not the user object
  }, [library, user?.id, cloudSyncEnabled, storageReady, storageKey]);

  const clearCloudData = async () => {
    if (!supabase || !user || !cloudDataAccessAllowed || cloudDataBusy) return;
    if (!await confirmAction({ title: "Clear your cloud library?", danger: true, confirmLabel: "Clear cloud data", message: "Every Piko and Tofu stored in Mochi Cloud for this account is deleted. Your local library, account and saved provider credentials are not changed.", items: ["All cloud Pikos (games)", "All cloud Tofus (environments)"] })) return;
    setCloudDataBusy(true); setCloudDataMessage("");
    try {
      const deleted = await clearAccountCloudData(supabase);
      schedulerRef.current?.cancel();
      // Re-verify against the cloud instead of assuming the clear worked; no checkmark may outlive the data it describes.
      const remaining = await pullLibrary(supabase, user.id).then(confirmedAfterPull).catch(confirmedAfterClear);
      confirm(user.id, remaining);
      if (cloudSyncEnabled) {
        // Sync stays on: re-arm the scheduler (it was cancelled) so the next library change uploads again, but do not re-upload now.
        schedulerRef.current = buildScheduler(supabase, user.id, () => false);
      }
      setSyncState(cloudSyncEnabled ? "empty" : "offline");
      setCloudDataMessage(`Cloud library cleared. Removed ${deleted.deleted_pikos} Pikos and ${deleted.deleted_tofus} Tofus. Your local library and saved provider credentials were not changed.${cloudSyncEnabled ? " Cloud sync is still on, so games upload again the next time your library changes." : ""}`);
    } catch (error) {
      setCloudDataMessage(error instanceof Error ? error.message : "Unable to clear cloud library data.");
    } finally { setCloudDataBusy(false); }
  };

  return { syncState, confirmedIds, cloudSyncEnabled, cloudDataAccessAllowed, cloudDataBusy, cloudDataMessage, clearCloudData };
}
