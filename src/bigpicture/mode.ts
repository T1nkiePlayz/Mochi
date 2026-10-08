import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { readJson, readString, storageKeys, writeString } from "../lib/storage";

/** What the native side knows about how this process was started; injected before the page loads. */
export type BootInfo = { bigPicture?: boolean; autostart?: boolean; steamDeck?: boolean; gamescope?: boolean };

declare global { interface Window { __MOCHI_BOOT__?: BootInfo } }

export const bigPictureExplicitKey = "mochi:bigpicture-startup-explicit";

export function readBoot(): BootInfo {
  const boot = { ...(window.__MOCHI_BOOT__ ?? {}) };
  if (import.meta.env.DEV) {
    const params = new URLSearchParams(window.location.search);
    if (params.has("bigpicture")) boot.bigPicture = true;
    if (params.has("deck")) { boot.steamDeck = true; boot.gamescope = params.has("gamescope"); }
  }
  return boot;
}

/**
 * Whether Mochi should open in Big Picture: the launch flag always wins; otherwise the user's
 * setting, which defaults to on in a Steam gaming session until the user has chosen for themselves.
 */
export function shouldStartInBigPicture(boot: BootInfo, startupSetting: unknown, userChose: boolean): boolean {
  if (boot.bigPicture) return true;
  if (userChose) return startupSetting === true;
  return startupSetting === true || boot.gamescope === true;
}

/** The effective "open in Big Picture on startup" value, as shown in Settings. */
export function effectiveStartup(startupSetting: boolean): boolean {
  return shouldStartInBigPicture({ gamescope: readBoot().gamescope }, startupSetting, readString(bigPictureExplicitKey) === "true");
}

export function markStartupChoice() { writeString(bigPictureExplicitKey, "true"); }

const boot = readBoot();
/** The device-wide mirror wins (per-account profiles keep their settings elsewhere); old installs fall back to the shared settings. */
export function readStartupSetting(): unknown {
  const mirrored = readString(storageKeys.bigPictureStartup);
  if (mirrored === "true" || mirrored === "false") return mirrored === "true";
  return readJson<Record<string, unknown>>(storageKeys.settings, {}).bigPictureOnStartup;
}

let active = shouldStartInBigPicture(
  boot,
  readStartupSetting(),
  readString(bigPictureExplicitKey) === "true",
);
const listeners = new Set<() => void>();

function applyDocument() {
  const root = document.documentElement;
  if (active) root.setAttribute("data-mochi-mode", "bigpicture"); else root.removeAttribute("data-mochi-mode");
  if (boot.steamDeck) root.setAttribute("data-steam-deck", "true");
  if (boot.gamescope) root.setAttribute("data-gamescope", "true");
}
applyDocument();

async function setFullscreen(value: boolean) {
  if (boot.gamescope) return; // gamescope already presents every window fullscreen
  try { await (await import("@tauri-apps/api/window")).getCurrentWindow().setFullscreen(value); } catch { /* browser/development mode or missing permission */ }
}

function setActive(next: boolean) {
  if (active === next) return;
  active = next;
  applyDocument();
  void setFullscreen(next);
  listeners.forEach((listener) => listener());
}

export const isBigPictureActive = () => active;
export const enterBigPicture = () => setActive(true);
export const exitBigPicture = () => setActive(false);
export const toggleBigPicture = () => setActive(!active);

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const useBigPictureActive = () => useSyncExternalStore(subscribe, isBigPictureActive, isBigPictureActive);

/** Fullscreen at boot when starting in Big Picture (the window starts windowed). */
export function syncInitialFullscreen() { if (active) void setFullscreen(true); }

export const isSteamDeckSession = () => boot.steamDeck === true;
export const isGamescopeSession = () => boot.gamescope === true;

export const quitMochi = () => invoke<void>("quit_mochi");
