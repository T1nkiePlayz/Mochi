const EVENT = "mochi:open-picker";
let pending = false;

/** Asks the library page to open "What should I play?" (it may not be on screen yet, so the request is remembered until it is). */
export function requestPicker() { pending = true; window.dispatchEvent(new Event(EVENT)); }

/** True once per request; the library page calls this on mount and when the event fires. */
export function takePickerRequest(): boolean { const was = pending; pending = false; return was; }

export const subscribePickerRequest = (listener: () => void) => { window.addEventListener(EVENT, listener); return () => window.removeEventListener(EVENT, listener); };
