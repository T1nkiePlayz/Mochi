import { useSyncExternalStore } from "react";
import { readJson, writeJson } from "../lib/storage";

export const controllerProfilesStorageKey = "mochi:controller-profiles";
export const MAX_CONTROLLER_PROFILES = 20;

export type ControllerLayout = "xbox" | "nintendo" | "custom";
export type ControllerTypeHint = "auto" | "xbox" | "playstation" | "nintendo";

/** The buttons a custom remap may move (SDL's names). */
export const remappableButtons = ["a", "b", "x", "y", "leftshoulder", "rightshoulder", "lefttrigger", "righttrigger", "leftstick", "rightstick", "start", "back"] as const;
export type RemapButton = (typeof remappableButtons)[number];

/** Settings applied as SDL and Proton environment variables when Mochi starts the game itself. Stored on this device only. */
export type ControllerProfile = {
  id: string;
  name: string;
  layout: ControllerLayout;
  /** Physical button to the button the game sees; only used by the "custom" layout. */
  remap: Partial<Record<RemapButton, RemapButton>>;
  typeHint: ControllerTypeHint;
  ignoreSteamVirtual: boolean;
  /** SDL GUID of the only controller the game may see. */
  onlyGuid?: string;
  /** Enable hidraw/HIDAPI for PlayStation and Switch pads (Proton and native SDL). */
  protonHidraw: boolean;
};

const layouts: ControllerLayout[] = ["xbox", "nintendo", "custom"];
const hints: ControllerTypeHint[] = ["auto", "xbox", "playstation", "nintendo"];
const isButton = (value: unknown): value is RemapButton => typeof value === "string" && (remappableButtons as readonly string[]).includes(value);

export const defaultControllerProfile = (id: string, name: string): ControllerProfile => ({ id, name, layout: "xbox", remap: {}, typeHint: "auto", ignoreSteamVirtual: false, protonHidraw: false });

export function normalizeControllerProfile(raw: unknown): ControllerProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const stored = raw as Record<string, unknown>;
  if (typeof stored.id !== "string" || !stored.id || typeof stored.name !== "string" || !stored.name.trim()) return null;
  const remap: ControllerProfile["remap"] = {};
  if (stored.remap && typeof stored.remap === "object") {
    for (const [from, to] of Object.entries(stored.remap as Record<string, unknown>)) if (isButton(from) && isButton(to) && from !== to) remap[from] = to;
  }
  return {
    id: stored.id,
    name: stored.name.trim().slice(0, 40),
    layout: layouts.includes(stored.layout as ControllerLayout) ? (stored.layout as ControllerLayout) : "xbox",
    remap,
    typeHint: hints.includes(stored.typeHint as ControllerTypeHint) ? (stored.typeHint as ControllerTypeHint) : "auto",
    ignoreSteamVirtual: stored.ignoreSteamVirtual === true,
    ...(typeof stored.onlyGuid === "string" && /^[0-9a-fA-F]{32}$/.test(stored.onlyGuid) ? { onlyGuid: stored.onlyGuid.toLowerCase() } : {}),
    protonHidraw: stored.protonHidraw === true,
  };
}

export function normalizeControllerProfiles(raw: unknown): ControllerProfile[] {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  const out: ControllerProfile[] = [];
  for (const item of list) {
    const profile = normalizeControllerProfile(item);
    if (profile && !seen.has(profile.id) && out.length < MAX_CONTROLLER_PROFILES) { seen.add(profile.id); out.push(profile); }
  }
  return out;
}

/** Whether two buttons would be remapped to the same output (the launcher then skips the remap). */
export function remapConflict(profile: ControllerProfile): boolean {
  if (profile.layout !== "custom") return false;
  const outputs = Object.entries(profile.remap).filter(([from, to]) => from !== to).map(([, to]) => to);
  return new Set(outputs).size !== outputs.length;
}

/** The shape the launcher expects (no id, only what the profile means for this game). */
export function launcherControllerProfile(profile: ControllerProfile | undefined) {
  if (!profile) return null;
  return { name: profile.name, layout: profile.layout, remap: profile.layout === "custom" ? profile.remap : {}, typeHint: profile.typeHint, ignoreSteamVirtual: profile.ignoreSteamVirtual, onlyGuid: profile.onlyGuid ?? null, protonHidraw: profile.protonHidraw };
}

let current = normalizeControllerProfiles(readJson<unknown>(controllerProfilesStorageKey, []));
const listeners = new Set<() => void>();

export const getControllerProfiles = () => current;

export function setControllerProfiles(next: ControllerProfile[]): void {
  current = normalizeControllerProfiles(next);
  writeJson(controllerProfilesStorageKey, current);
  listeners.forEach((listener) => listener());
}

export const addControllerProfile = (name: string, id: string = `cp-${crypto.randomUUID()}`): ControllerProfile | null => {
  const trimmed = name.trim().slice(0, 40);
  if (!trimmed || current.length >= MAX_CONTROLLER_PROFILES) return null;
  const profile = defaultControllerProfile(id, trimmed);
  setControllerProfiles([...current, profile]);
  return profile;
};
export const updateControllerProfile = (id: string, changes: Partial<Omit<ControllerProfile, "id">>) => setControllerProfiles(current.map((profile) => (profile.id === id ? { ...profile, ...changes } : profile)));
export const removeControllerProfile = (id: string) => setControllerProfiles(current.filter((profile) => profile.id !== id));

/** The profile assigned to a game, if it still exists. */
export const controllerProfileFor = (piko: { controllerProfileId?: string }): ControllerProfile | undefined => (piko.controllerProfileId ? current.find((profile) => profile.id === piko.controllerProfileId) : undefined);

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const useControllerProfiles = (): ControllerProfile[] => useSyncExternalStore(subscribe, getControllerProfiles, getControllerProfiles);
