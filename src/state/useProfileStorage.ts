import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { User } from "@supabase/supabase-js";
import type { Piko } from "../models";
import { profileStorageKey, readJson, removeKey, storageKeys, writeJson, writeJsonDebounced } from "../lib/storage";
import { sanitizeLibrary } from "../lib/library";
import { defaultBehavior, normalizeBehavior, type Behavior } from "./settings";
import type { AppNotification } from "./useNotifications";

type Params = {
  user: User | null;
  library: Piko[];
  setLibrary: Dispatch<SetStateAction<Piko[]>>;
  behavior: Behavior;
  setBehavior: Dispatch<SetStateAction<Behavior>>;
  notifications: AppNotification[];
  setNotifications: Dispatch<SetStateAction<AppNotification[]>>;
  theme: string;
  themeIds: string[];
  setTheme: (id: string) => Promise<void> | void;
  onProfileLoaded: (library: Piko[]) => void;
};

/**
 * Persists the library, settings and notifications, either shared on this device or
 * separately per signed-in account, and reloads them when the active profile changes.
 */
export function useProfileStorage(params: Params) {
  const { user, library, setLibrary, behavior, setBehavior, notifications, setNotifications, theme, themeIds, setTheme, onProfileLoaded } = params;
  const [multipleAccountsEnabled, setMultipleAccountsEnabled] = useState(() => readJson<{ multipleAccountsEnabled?: boolean }>(storageKeys.settings, {}).multipleAccountsEnabled === true);
  const [owner, setOwner] = useState("uninitialized");
  const activeProfileId = user?.id || "guest";
  const ownerKey = multipleAccountsEnabled ? `profiles:${activeProfileId}` : "shared";
  const scoped = (key: string) => (multipleAccountsEnabled ? profileStorageKey(activeProfileId, key) : `mochi:${key}`);
  const ready = owner === ownerKey;

  useEffect(() => { if (ready) writeJsonDebounced(scoped("pikos"), library); }, [library, ready, ownerKey]);
  useEffect(() => { if (ready) writeJsonDebounced(scoped("notifications"), notifications); }, [notifications, ready, ownerKey]);
  useEffect(() => {
    if (!ready) return;
    if (multipleAccountsEnabled) writeJsonDebounced(scoped("settings"), { ...behavior, theme });
    else writeJsonDebounced(storageKeys.settings, { ...behavior, multipleAccountsEnabled });
  }, [behavior, theme, multipleAccountsEnabled, ready, ownerKey]);

  // The multi-profile switch itself always lives in the shared settings so it survives a profile change.
  useEffect(() => {
    const global = readJson<Record<string, unknown>>(storageKeys.settings, {});
    if (global.multipleAccountsEnabled !== multipleAccountsEnabled) writeJson(storageKeys.settings, { ...global, multipleAccountsEnabled });
  }, [multipleAccountsEnabled]);

  useEffect(() => {
    if (ready) return;
    // Older versions saved the shared library under un-prefixed keys; move it to the canonical ones once.
    if (!multipleAccountsEnabled) {
      for (const key of ["pikos", "notifications"]) {
        try {
          const legacy = window.localStorage.getItem(key);
          if (legacy !== null) { window.localStorage.setItem(`mochi:${key}`, legacy); window.localStorage.removeItem(key); }
        } catch { /* storage unavailable */ }
      }
    }
    const separate = multipleAccountsEnabled && Boolean(user);
    const nextLibrary = sanitizeLibrary(readJson<unknown>(scoped("pikos"), separate ? [] : readJson<unknown>(storageKeys.pikos, [])));
    const nextSettings = readJson<Record<string, unknown>>(scoped("settings"), separate ? {} : readJson<Record<string, unknown>>(storageKeys.settings, {}));
    const nextNotifications = readJson<AppNotification[]>(scoped("notifications"), separate ? [] : readJson(storageKeys.notifications, []));
    setLibrary(nextLibrary);
    setBehavior(normalizeBehavior(nextSettings));
    setNotifications(Array.isArray(nextNotifications) ? nextNotifications : []);
    onProfileLoaded(nextLibrary);
    if (multipleAccountsEnabled) void setTheme(typeof nextSettings.theme === "string" && themeIds.includes(nextSettings.theme) ? nextSettings.theme : "mochi");
    setOwner(ownerKey);
  }, [user?.id, multipleAccountsEnabled, owner, ownerKey]);

  const setMultipleAccountProfiles = (enabled: boolean) => {
    if (enabled) {
      writeJson(profileStorageKey(activeProfileId, "pikos"), library);
      writeJson(profileStorageKey(activeProfileId, "settings"), { ...behavior, theme });
      writeJson(profileStorageKey(activeProfileId, "notifications"), notifications);
    } else {
      writeJson(storageKeys.pikos, library);
      writeJson(storageKeys.settings, { ...behavior, multipleAccountsEnabled: false });
      writeJson(storageKeys.notifications, notifications);
    }
    setMultipleAccountsEnabled(enabled);
  };

  return { multipleAccountsEnabled, setMultipleAccountProfiles, ready, ownerKey, defaultBehavior, removeKey };
}
