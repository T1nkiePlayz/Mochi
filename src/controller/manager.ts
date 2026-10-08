import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getControllerSettings, updateControllerSettings } from "./settings";
import { buttonToAction, familyFromName, repeatTiming, stickDirection, webButtonName } from "./mapping";
import type { Action, ActionEvent, Direction, Family, InputDevice, PadAxis, PadButton, PadInfo } from "./types";

/**
 * Turns raw controller input (native `gilrs` events, with the web Gamepad API as a fallback)
 * into UI actions with dead zones and repeat-on-hold. Everything else subscribes here.
 */

type PadState = { info: PadInfo; buttons: Set<PadButton>; axes: Partial<Record<PadAxis, number>>; stick: Direction | null };

type Handler = (event: ActionEvent) => boolean | void;

const pads = new Map<string, PadState>();
const handlers: Array<{ handler: Handler; priority: number }> = [];
const axisListeners = new Set<() => void>();
let activeDirections: Direction[] = [];
let repeatDirection: Direction | null = null;
let repeatTimer: number | undefined;
let lastFamily: Family = "generic";
let device: InputDevice = "keyboard";
let startedAt = 0;

type Snapshot = { pads: PadInfo[]; device: InputDevice; family: Family };
let snapshot: Snapshot = { pads: [], device, family: lastFamily };
const stateListeners = new Set<() => void>();

function publish() {
  snapshot = { pads: [...pads.values()].map((pad) => pad.info), device, family: lastFamily };
  document.documentElement.setAttribute("data-input", device);
  stateListeners.forEach((listener) => listener());
}

const subscribeState = (listener: () => void) => { stateListeners.add(listener); return () => { stateListeners.delete(listener); }; };
export const getSnapshot = () => snapshot;
export const useControllerState = (): Snapshot => useSyncExternalStore(subscribeState, getSnapshot, getSnapshot);

/** Registers an action handler. Higher priority runs first; returning true consumes the action. */
export function subscribeActions(handler: Handler, priority = 0): () => void {
  const entry = { handler, priority };
  handlers.push(entry);
  handlers.sort((a, b) => b.priority - a.priority);
  return () => { const index = handlers.indexOf(entry); if (index >= 0) handlers.splice(index, 1); };
}

export function subscribeAxes(listener: () => void): () => void {
  axisListeners.add(listener);
  return () => { axisListeners.delete(listener); };
}

/** Largest deflection of an axis across all connected pads, with the dead zone removed. */
export function getAxis(axis: PadAxis): number {
  const dead = getControllerSettings().deadZone;
  let best = 0;
  for (const pad of pads.values()) {
    const value = pad.axes[axis] ?? 0;
    if (Math.abs(value) > Math.abs(best)) best = value;
  }
  const magnitude = Math.abs(best);
  return magnitude <= dead ? 0 : Math.sign(best) * Math.min(1, (magnitude - dead) / (1 - dead));
}

function dispatch(event: ActionEvent) {
  for (const { handler } of [...handlers]) {
    try { if (handler(event) === true) return; } catch (error) { console.warn("Mochi controller handler failed", error); }
  }
}

/** Feeds an action that did not come from a controller (keyboard in Big Picture, tests). */
export function emitAction(action: Action, source: InputDevice = "keyboard", repeat = false) {
  dispatch({ action, repeat, source, family: lastFamily });
}

function setDevice(next: InputDevice) {
  if (device === next) return;
  device = next;
  publish();
}

function fire(action: Action, repeat: boolean, pad: PadInfo | undefined) {
  if (pad && pad.family !== lastFamily) { lastFamily = pad.family; publish(); }
  setDevice("controller");
  // First controller use switches controller navigation on, unless the user decided otherwise.
  if (getControllerSettings().enabled === null) updateControllerSettings({ enabled: true });
  dispatch({ action, repeat, source: "controller", family: pad?.family ?? lastFamily });
}

// --- Directions with repeat-on-hold ---------------------------------------------------------

function stopRepeat() {
  window.clearTimeout(repeatTimer);
  repeatTimer = undefined;
  repeatDirection = null;
}

function startRepeat(direction: Direction, pad: PadInfo | undefined) {
  stopRepeat();
  repeatDirection = direction;
  const { initial, interval } = repeatTiming(getControllerSettings().repeatSpeed);
  const tick = () => {
    if (repeatDirection !== direction) return;
    fire(direction, true, pad);
    repeatTimer = window.setTimeout(tick, interval);
  };
  repeatTimer = window.setTimeout(tick, initial);
}

function recomputeDirections(changed: PadState | undefined) {
  const threshold = getControllerSettings().deadZone;
  const held = new Set<Direction>();
  for (const pad of pads.values()) {
    const x = pad.axes.leftX ?? 0;
    const y = pad.axes.leftY ?? 0;
    // Release at 75% of the press threshold so a stick settling near the edge does not jitter.
    pad.stick = stickDirection(x, y, pad.stick ? threshold * 0.75 : threshold, pad.stick);
    if (pad.stick) held.add(pad.stick);
    if (pad.buttons.has("dpadUp") || (pad.axes.dpadY ?? 0) < -0.5) held.add("up");
    if (pad.buttons.has("dpadDown") || (pad.axes.dpadY ?? 0) > 0.5) held.add("down");
    if (pad.buttons.has("dpadLeft") || (pad.axes.dpadX ?? 0) < -0.5) held.add("left");
    if (pad.buttons.has("dpadRight") || (pad.axes.dpadX ?? 0) > 0.5) held.add("right");
  }
  const added = [...held].filter((direction) => !activeDirections.includes(direction));
  activeDirections = activeDirections.filter((direction) => held.has(direction));
  for (const direction of added) {
    activeDirections.push(direction);
    fire(direction, false, changed?.info);
    startRepeat(direction, changed?.info);
  }
  if (repeatDirection && !activeDirections.includes(repeatDirection)) {
    const fallback = activeDirections[activeDirections.length - 1];
    if (fallback) startRepeat(fallback, changed?.info); else stopRepeat();
  }
}

// --- Buttons, chord and axes -----------------------------------------------------------------

let chordTimer: number | undefined;
let chordFired = false;
let bothSeen = false;

function anyHeld(button: PadButton) {
  for (const pad of pads.values()) if (pad.buttons.has(button)) return true;
  return false;
}

function updateChord(pad: PadInfo | undefined) {
  if (anyHeld("start") && anyHeld("select")) {
    bothSeen = true;
    if (chordTimer === undefined && !chordFired) {
      chordTimer = window.setTimeout(() => { chordTimer = undefined; chordFired = true; fire("chord", false, pad); }, 900);
    }
  } else {
    window.clearTimeout(chordTimer);
    chordTimer = undefined;
    if (!anyHeld("start") && !anyHeld("select")) { chordFired = false; bothSeen = false; }
  }
}

function setButton(key: string, button: PadButton, pressed: boolean) {
  const pad = pads.get(key);
  if (!pad) return;
  const had = pad.buttons.has(button);
  if (pressed === had) return;
  if (pressed) pad.buttons.add(button); else pad.buttons.delete(button);
  const settings = getControllerSettings();
  const action = buttonToAction(button, pad.info.family, settings.swapConfirmBack);

  if (button === "start" || button === "select") {
    // Start/Select fire on release so holding both together can be a chord instead.
    const wasBoth = bothSeen;
    updateChord(pad.info);
    if (!pressed && action && !wasBoth && !anyHeld("start") && !anyHeld("select")) fire(action, false, pad.info);
    return;
  }
  if (action === "up" || action === "down" || action === "left" || action === "right") { recomputeDirections(pad); return; }
  if (pressed && action) fire(action, false, pad.info);
}

function setAxis(key: string, axis: PadAxis, value: number) {
  const pad = pads.get(key);
  if (!pad) return;
  pad.axes[axis] = value;
  if (axis === "leftX" || axis === "leftY" || axis === "dpadX" || axis === "dpadY") recomputeDirections(pad);
  else axisListeners.forEach((listener) => listener());
  if ((axis === "rightX" || axis === "rightY") && Math.abs(value) > getControllerSettings().deadZone) setDevice("controller");
}

function addPad(info: PadInfo) {
  pads.set(info.key, { info, buttons: new Set(), axes: {}, stick: null });
  lastFamily = info.family;
  publish();
}

function removePad(key: string) {
  pads.delete(key);
  recomputeDirections(undefined);
  updateChord(undefined);
  publish();
}

// --- Native source ---------------------------------------------------------------------------

type NativePad = { id: number; name: string; family: Family; rumble: boolean };
type NativeEvent =
  | { kind: "connected"; pad: NativePad }
  | { kind: "disconnected"; id: number }
  | { kind: "button"; id: number; button: PadButton; pressed: boolean }
  | { kind: "axis"; id: number; axis: PadAxis; value: number };

const nativeInfo = (pad: NativePad): PadInfo => ({ key: `n${pad.id}`, name: pad.name, family: pad.family, source: "native", rumble: pad.rumble });

function handleNative(event: NativeEvent) {
  switch (event.kind) {
    case "connected": addPad(nativeInfo(event.pad)); break;
    case "disconnected": removePad(`n${event.id}`); break;
    case "button": setButton(`n${event.id}`, event.button, event.pressed); break;
    case "axis": setAxis(`n${event.id}`, event.axis, event.value); break;
  }
}

async function startNative() {
  await listen<NativeEvent>("gamepad-event", (event) => handleNative(event.payload));
  const existing = await invoke<NativePad[]>("get_gamepads");
  existing.forEach((pad) => { if (!pads.has(`n${pad.id}`)) addPad(nativeInfo(pad)); });
}

// --- Web Gamepad API fallback ----------------------------------------------------------------

let webLoop = 0;
const webAxes: PadAxis[] = ["leftX", "leftY", "rightX", "rightY"];

function pollWeb() {
  webLoop = 0;
  if ([...pads.values()].some((pad) => pad.info.source === "native")) return; // the native source is authoritative
  const connected = (navigator.getGamepads?.() ?? []).filter((pad): pad is Gamepad => Boolean(pad));
  const keys = new Set(connected.map((pad) => `w${pad.index}`));
  for (const key of [...pads.keys()]) if (key.startsWith("w") && !keys.has(key)) removePad(key);
  for (const pad of connected) {
    const key = `w${pad.index}`;
    if (!pads.has(key)) addPad({ key, name: pad.id, family: familyFromName(pad.id), source: "web", rumble: false });
    pad.buttons.forEach((button, index) => { const name = webButtonName(index); if (name) setButton(key, name, button.pressed || button.value > 0.6); });
    webAxes.forEach((axis, index) => setAxis(key, axis, pad.axes[index] ?? 0));
  }
  if (connected.length) webLoop = window.requestAnimationFrame(pollWeb);
}

function ensureWebLoop() { if (!webLoop) webLoop = window.requestAnimationFrame(pollWeb); }

// --- Start ------------------------------------------------------------------------------------

/** Idempotent; safe to call from React effects and when no backend or controller exists. */
export function startController() {
  if (startedAt) return;
  startedAt = Date.now();
  void startNative().catch(() => { /* browser/development mode: the web fallback below covers it */ });
  window.addEventListener("gamepadconnected", ensureWebLoop);
  ensureWebLoop();
  const onKey = (event: KeyboardEvent) => { if (event.isTrusted) setDevice("keyboard"); };
  const onPointer = (event: PointerEvent) => { if (event.isTrusted && (event.movementX || event.movementY || event.type !== "pointermove")) setDevice("pointer"); };
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("pointermove", onPointer, true);
  window.addEventListener("pointerdown", onPointer, true);
  publish();
}
