/** Every interface sound Mochi plays. Must match `SOUND_EVENTS` in src-tauri/src/soundpacks.rs. */
export const SOUND_EVENTS = [
  "navigate", "tab", "select", "back", "open", "close", "launch", "error", "notification", "toggleOn", "toggleOff", "achievement", "download",
] as const;

export type SoundEvent = (typeof SOUND_EVENTS)[number];

export const SOUND_LABELS: Record<SoundEvent, string> = {
  navigate: "Move focus", tab: "Switch tab or shelf", select: "Select", back: "Back", open: "Open a menu or dialog", close: "Close a menu or dialog",
  launch: "Launch a game", error: "Error", notification: "Notification", toggleOn: "Switch on", toggleOff: "Switch off",
  achievement: "Achievement unlocked", download: "Download finished",
};

/** Movement sounds play constantly; they are the ones "fewer sounds" and reduced motion turn off. */
export const MOVEMENT_EVENTS: ReadonlySet<SoundEvent> = new Set(["navigate", "tab"]);

/** Minimum gap between two plays of the same sound, in ms, so held directions and duplicate signals do not pile up. */
export const MIN_GAP_MS: Record<SoundEvent, number> = {
  navigate: 40, tab: 60, select: 40, back: 40, open: 80, close: 80, launch: 6000, error: 400, notification: 600, toggleOn: 40, toggleOff: 40, achievement: 800, download: 800,
};

export const isSoundEvent = (value: unknown): value is SoundEvent => typeof value === "string" && (SOUND_EVENTS as readonly string[]).includes(value);
