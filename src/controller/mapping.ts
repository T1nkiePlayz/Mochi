import type { Action, Direction, Family, PadButton, RepeatSpeed } from "./types";

/** Which physical button confirms; Nintendo pads put "A" on the east button. */
export function confirmButton(family: Family, swap: boolean): "south" | "east" {
  const base = family === "switch" ? "east" : "south";
  return swap ? (base === "south" ? "east" : "south") : base;
}

export function backButton(family: Family, swap: boolean): "south" | "east" {
  return confirmButton(family, swap) === "south" ? "east" : "south";
}

/** The "X" action sits on the physical west button, except on Nintendo layouts where X is north. */
export function xButton(family: Family): "west" | "north" { return family === "switch" ? "north" : "west"; }
export function yButton(family: Family): "west" | "north" { return family === "switch" ? "west" : "north"; }

export function buttonToAction(button: PadButton, family: Family, swap: boolean): Action | null {
  switch (button) {
    case "dpadUp": return "up";
    case "dpadDown": return "down";
    case "dpadLeft": return "left";
    case "dpadRight": return "right";
    case "south": case "east": return button === confirmButton(family, swap) ? "confirm" : "back";
    case "west": case "north": return button === xButton(family) ? "x" : "y";
    case "start": return "menu";
    case "select": return "options";
    case "l1": return "tabPrev";
    case "r1": return "tabNext";
    case "l2": return "triggerLeft";
    case "r2": return "triggerRight";
    default: return null;
  }
}

/** The physical button that performs an action on this family (for drawing prompts). */
export function actionToButton(action: Action, family: Family, swap: boolean): PadButton | null {
  switch (action) {
    case "up": return "dpadUp";
    case "down": return "dpadDown";
    case "left": return "dpadLeft";
    case "right": return "dpadRight";
    case "confirm": return confirmButton(family, swap);
    case "back": return backButton(family, swap);
    case "x": return xButton(family);
    case "y": return yButton(family);
    case "menu": return "start";
    case "options": return "select";
    case "tabPrev": return "l1";
    case "tabNext": return "r1";
    case "triggerLeft": return "l2";
    case "triggerRight": return "r2";
    case "chord": return null;
  }
}

/** Rescales a stick value so the dead zone maps to 0 and full deflection to 1. */
export function applyDeadZone(value: number, deadZone: number): number {
  const magnitude = Math.abs(value);
  if (magnitude <= deadZone) return 0;
  return Math.sign(value) * Math.min(1, (magnitude - deadZone) / (1 - deadZone));
}

/**
 * Quantises a stick position to a direction. `previous` adds hysteresis so a stick
 * resting near a diagonal does not flicker between two directions.
 */
export function stickDirection(x: number, y: number, threshold: number, previous: Direction | null = null): Direction | null {
  const absX = Math.abs(x);
  const absY = Math.abs(y);
  if (Math.hypot(x, y) < threshold) return null;
  const horizontal: Direction = x > 0 ? "right" : "left";
  const vertical: Direction = y > 0 ? "down" : "up";
  if (previous === horizontal && absX * 1.3 >= absY) return horizontal;
  if (previous === vertical && absY * 1.3 >= absX) return vertical;
  return absX > absY ? horizontal : vertical;
}

export function repeatTiming(speed: RepeatSpeed): { initial: number; interval: number } {
  switch (speed) {
    case "slow": return { initial: 480, interval: 190 };
    case "fast": return { initial: 280, interval: 70 };
    default: return { initial: 380, interval: 115 };
  }
}

/** Mirrors the native `detect_family` for pads reported by the web Gamepad API (id strings only). */
export function familyFromName(name: string, onDeck = false): Family {
  const lower = name.toLowerCase();
  const has = (...needles: string[]) => needles.some((needle) => lower.includes(needle));
  if (has("steam deck", "neptune", "jupiter") || has("28de") && has("1205")) return "deck";
  if (has("steam controller", "steam virtual", "valve", "vendor: 28de")) return "steam";
  if (has("dualsense", "dualshock", "playstation", "ps5", "ps4", "ps3", "054c") || lower === "wireless controller") return "playstation";
  if (has("pro controller", "joy-con", "joycon", "nintendo", "switch", "057e")) return "switch";
  if (has("xbox", "x-box", "xinput", "microsoft", "045e")) return onDeck && has("x-box 360", "xbox 360", "microsoft") ? "deck" : "xbox";
  return "generic";
}

/** Button order of the "standard" web Gamepad mapping. */
const WEB_BUTTONS: PadButton[] = ["south", "east", "west", "north", "l1", "r1", "l2", "r2", "select", "start", "l3", "r3", "dpadUp", "dpadDown", "dpadLeft", "dpadRight", "guide"];
export const webButtonName = (index: number): PadButton | null => WEB_BUTTONS[index] ?? null;
