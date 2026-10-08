import { useEffect, useRef, useSyncExternalStore } from "react";
import { readJson, writeJson } from "../lib/storage";
import { checkForUpdate, installUpdate, openReleasePage, type DownloadProgress, type UpdateInfo } from "../lib/updater";

/**
 * Self-contained updater store (no provider needed). `useUpdater()` reads it anywhere;
 * `useUpdateScheduler()` is mounted once (by UpdateBanner) and drives the background checks.
 */

export type UpdaterStatus = "idle" | "checking" | "current" | "available" | "downloading" | "restarting" | "offline" | "error";

export type UpdaterState = {
  status: UpdaterStatus;
  info?: UpdateInfo;
  progress?: DownloadProgress;
  error?: string;
  lastChecked?: number;
  /** Version whose banner the user dismissed. */
  dismissed?: string;
};

const FIRST_CHECK_DELAY_MS = 10_000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const STORAGE_KEY = "mochi:updater";

const saved = readJson<{ lastChecked?: number; dismissed?: string }>(STORAGE_KEY, {});
let state: UpdaterState = { status: "idle", lastChecked: saved.lastChecked, dismissed: saved.dismissed };
const listeners = new Set<() => void>();
let inFlight = false;
let notifiedVersion = "";

function setState(patch: Partial<UpdaterState>) {
  state = { ...state, ...patch };
  writeJson(STORAGE_KEY, { lastChecked: state.lastChecked, dismissed: state.dismissed });
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const getState = () => state;

/** Returns the new version when an update was found by this check. */
export async function checkNow(): Promise<string | null> {
  if (inFlight || state.status === "downloading" || state.status === "restarting") return null;
  inFlight = true;
  setState({ status: "checking", error: undefined });
  try {
    const result = await checkForUpdate(__APP_VERSION__);
    const lastChecked = Date.now();
    switch (result.kind) {
      case "available": setState({ status: "available", info: result.info, lastChecked }); return result.info.version;
      case "current": setState({ status: "current", info: undefined, lastChecked }); break;
      case "offline": setState({ status: "offline", info: state.info, error: undefined }); break;
      case "error": setState({ status: "error", error: result.message, lastChecked }); break;
    }
    return null;
  } finally {
    inFlight = false;
  }
}

export async function installNow(): Promise<void> {
  const info = state.info;
  if (!info || state.status === "downloading") return;
  if (!info.installable) { void openReleasePage(info.releaseUrl); return; }
  setState({ status: "downloading", progress: { downloaded: 0 }, error: undefined });
  const outcome = await installUpdate((progress) => setState({ progress }));
  if (outcome === "restarting") { setState({ status: "restarting" }); return; }
  // The native updater cannot handle this install type; hand the user the release page instead.
  setState({ status: "available", info: { ...info, installable: false }, progress: undefined });
  void openReleasePage(info.releaseUrl);
}

export function dismissUpdate() {
  if (state.info) setState({ dismissed: state.info.version });
}

export function useUpdater() {
  const current = useSyncExternalStore(subscribe, getState);
  return { ...current, checkNow, installNow, dismiss: dismissUpdate };
}

/** Checks ~10 s after start and every 6 h while `enabled`; never offline, never blocks startup. */
export function useUpdateScheduler(enabled: boolean, notify: (title: string, message: string) => void) {
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  useEffect(() => {
    if (!enabled) return;
    const run = async () => {
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      const version = await checkNow();
      if (version && version !== notifiedVersion && version !== state.dismissed) {
        notifiedVersion = version;
        notifyRef.current("Update available", `Mochi ${version} is ready to install.`);
      }
    };
    const first = window.setTimeout(() => void run(), FIRST_CHECK_DELAY_MS);
    const repeat = window.setInterval(() => void run(), CHECK_INTERVAL_MS);
    return () => { window.clearTimeout(first); window.clearInterval(repeat); };
  }, [enabled]);
}
