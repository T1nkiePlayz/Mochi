import { useSyncExternalStore } from "react";

// `navigator.onLine` only says whether a network interface is up, so fetch wrappers also report real
// request outcomes here: a failed request flags "offline" until the next success or an `online` event.
let networkFailed = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

export function markNetworkFailure() {
  if (networkFailed) return;
  networkFailed = true;
  emit();
}

export function markNetworkOk() {
  if (!networkFailed) return;
  networkFailed = false;
  emit();
}

export function isOnline(): boolean {
  return (typeof navigator === "undefined" || navigator.onLine !== false) && !networkFailed;
}

/** True when an error looks like a connectivity problem rather than a server-side rejection. */
export function isNetworkError(error: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error ?? "");
  return /failed to fetch|networkerror|network request failed|load failed|fetch failed|err_internet|timed out|timeout|AuthRetryableFetchError/i.test(text);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onOnline = () => { networkFailed = false; emit(); };
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", listener);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, isOnline, () => true);
}
