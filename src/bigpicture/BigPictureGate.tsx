import { Suspense, lazy, useEffect, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { useApp } from "../state/AppContext";
import { emitAction, subscribeActions } from "../controller/manager";
import { isTextField } from "../controller/keyboard";
import type { Action } from "../controller/types";
import { enterBigPicture, syncInitialFullscreen, toggleBigPicture, useBigPictureActive } from "./mode";

const BigPicture = lazy(() => import("./BigPicture"));

const KEY_ACTIONS: Record<string, Action> = {
  ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
  Escape: "back", Backspace: "back", m: "menu", M: "menu", x: "x", X: "x", y: "y", Y: "y", q: "tabPrev", Q: "tabPrev", e: "tabNext", E: "tabNext",
  PageUp: "triggerLeft", PageDown: "triggerRight",
};

/**
 * Swaps the desktop UI for Big Picture when active and owns every way in or out: F11, the
 * Start+Select hold, the tray item / `--big-picture` second launch, and keyboard control of the console UI.
 */
export function BigPictureGate({ children }: { children: ReactNode }) {
  const { showFirstLaunchSetup } = useApp();
  const active = useBigPictureActive();

  useEffect(() => { syncInitialFullscreen(); }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "F11") { event.preventDefault(); toggleBigPicture(); return; }
      if (!active || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      const action = KEY_ACTIONS[event.key];
      if (!action || isTextField(document.activeElement)) return;
      event.preventDefault();
      emitAction(action, "keyboard", event.repeat);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  useEffect(() => subscribeActions((event) => {
    if (event.action !== "chord") return false;
    toggleBigPicture();
    return true;
  }, 200), []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void listen("mochi-bigpicture", () => enterBigPicture()).then((off) => { if (disposed) off(); else unlisten = off; }).catch(() => {});
    return () => { disposed = true; unlisten?.(); };
  }, []);

  // First-run setup comes first; Big Picture takes over once it is finished.
  if (active && !showFirstLaunchSetup) {
    return <Suspense fallback={<div className="bp-loading" role="status" aria-label="Loading Big Picture" />}><BigPicture /></Suspense>;
  }
  return <>{children}</>;
}
