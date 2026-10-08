import { useEffect, useRef, useState } from "react";
import { useApp, type NavId } from "../state/AppContext";
import { useBigPictureActive } from "../bigpicture/mode";
import { OnScreenKeyboard } from "./OnScreenKeyboard";
import { getAxis, startController, subscribeActions, subscribeAxes } from "./manager";
import { isTextField, setFieldValue, type TextField } from "./keyboard";
import { getControllerSettings } from "./settings";
import { focusablesIn, moveFocus, navScope, scrollParent } from "./spatial";
import type { Action, ActionEvent, Direction } from "./types";

const NAV_ORDER: NavId[] = ["Library", "Installed", "Discover", "Downloads", "Stats", "Settings"];
const DIRECTIONS: Action[] = ["up", "down", "left", "right"];

function pressKey(target: Element, key: string) {
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}

function defaultScroller(): HTMLElement {
  const active = document.activeElement;
  if (active && active !== document.body) return scrollParent(active);
  return document.querySelector<HTMLElement>("[data-scroll-default], .content") ?? document.documentElement;
}

function fieldLabel(field: TextField): string {
  return field.getAttribute("aria-label") || field.placeholder || field.labels?.[0]?.textContent?.trim() || "";
}

/**
 * Drives the normal Mochi UI (and Big Picture) from controller actions: spatial navigation,
 * confirm/back, modal awareness, tab switching, scrolling and the on-screen keyboard.
 * Renders nothing unless the keyboard is open.
 */
export function ControllerRuntime() {
  const app = useApp();
  const bigPicture = useBigPictureActive();
  const [osk, setOsk] = useState<{ field: TextField; original: string } | null>(null);
  const latest = useRef({ app, bigPicture });
  latest.current = { app, bigPicture };

  useEffect(() => { startController(); }, []);

  useEffect(() => subscribeActions((event: ActionEvent) => {
    const { app: current, bigPicture: inBigPicture } = latest.current;
    const config = getControllerSettings();
    if (event.action === "chord") return false;
    if (event.source === "controller" && !inBigPicture && config.enabled === false) return false;
    if (event.source === "pointer") return false;

    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const openSelect = active?.closest(".mochi-select.open") ?? null;
    const scope = navScope();
    const inModal = scope !== document.body && !scope.hasAttribute("data-bp-root");

    if (DIRECTIONS.includes(event.action)) {
      const direction = event.action as Direction;
      if (openSelect && active) {
        if (direction === "up" || direction === "down") pressKey(active, direction === "up" ? "ArrowUp" : "ArrowDown");
        return true;
      }
      if (active instanceof HTMLInputElement && active.type === "range" && (direction === "left" || direction === "right")) {
        if (direction === "left") active.stepDown(); else active.stepUp();
        active.dispatchEvent(new Event("input", { bubbles: true }));
        active.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }
      if (isTextField(active) && (direction === "left" || direction === "right")) {
        try {
          const at = active.selectionStart;
          if (at !== null && !(direction === "left" && at === 0) && !(direction === "right" && at === active.value.length)) {
            const next = at + (direction === "left" ? -1 : 1);
            active.setSelectionRange(next, next);
            return true;
          }
        } catch { /* number/email inputs have no caret */ }
      }
      moveFocus(direction);
      return true;
    }

    switch (event.action) {
      case "confirm": {
        if (openSelect && active) { pressKey(active, "Enter"); return true; }
        if (!active || active === document.body || !scope.contains(active)) { moveFocus("down"); return true; }
        if (isTextField(active)) {
          if (config.onScreenKeyboard && event.source === "controller") setOsk({ field: active, original: active.value });
          return true;
        }
        if (active instanceof HTMLSelectElement) { try { active.showPicker(); } catch { /* unsupported */ } return true; }
        active.click();
        return true;
      }
      case "back": {
        if (openSelect && active) { pressKey(active, "Escape"); return true; }
        if (isTextField(active)) { active.blur(); return true; }
        if (inModal) {
          const close = Array.from(scope.querySelectorAll<HTMLElement>("button, [role=button]")).find((element) => {
            const name = (element.getAttribute("aria-label") || element.textContent || "").trim();
            return element.hasAttribute("data-modal-close") || /^(close|cancel|back|done|dismiss|not now|no thanks)$/i.test(name) || /^close\b/i.test(name);
          });
          if (close) close.click(); else pressKey(document.body, "Escape");
          return true;
        }
        if (inBigPicture) return false;
        if (current.app.lib.gameDetailsId) { current.app.lib.setGameDetailsId(""); return true; }
        if (current.app.activeNav !== "Library") { current.app.setActiveNav("Library"); return true; }
        return false;
      }
      case "tabPrev":
      case "tabNext": {
        const step = event.action === "tabNext" ? 1 : -1;
        const tablist = scope.querySelector<HTMLElement>("[role=tablist]");
        const tabs = tablist ? focusablesIn(tablist).filter((element) => element.getAttribute("role") === "tab") : [];
        if (tabs.length > 1) {
          const index = Math.max(0, tabs.findIndex((tab) => tab.getAttribute("aria-selected") === "true"));
          tabs[(index + step + tabs.length) % tabs.length].click();
          return true;
        }
        if (inModal || inBigPicture) return false;
        const index = NAV_ORDER.indexOf(current.app.activeNav);
        current.app.setActiveNav(NAV_ORDER[(index + step + NAV_ORDER.length) % NAV_ORDER.length]);
        return true;
      }
      case "triggerLeft":
      case "triggerRight": {
        const scroller = defaultScroller();
        scroller.scrollBy({ top: (event.action === "triggerRight" ? 1 : -1) * scroller.clientHeight * 0.85, behavior: "smooth" });
        return true;
      }
      case "menu": {
        if (inBigPicture || inModal) return false;
        document.querySelector<HTMLInputElement>(".search-box input")?.focus();
        return true;
      }
      default: return false;
    }
  }, 0), []);

  // Right stick scrolls whatever is under focus.
  useEffect(() => {
    let frame = 0;
    const step = () => {
      frame = 0;
      const value = getAxis("rightY");
      if (!value || document.querySelector(".mochi-select.open") || document.querySelector(".osk")) return;
      defaultScroller().scrollTop += value * 22;
      frame = window.requestAnimationFrame(step);
    };
    return subscribeAxes(() => { if (!frame && getControllerSettings().enabled !== false) frame = window.requestAnimationFrame(step); });
  }, []);

  if (!osk) return null;
  const { field, original } = osk;
  const close = () => { setOsk(null); field.focus({ preventScroll: true }); };
  return <OnScreenKeyboard
    initial={field.value} label={fieldLabel(field)} password={field.type === "password"}
    onChange={(value) => setFieldValue(field, value)}
    onSubmit={close}
    onCancel={() => { setFieldValue(field, original); close(); }}
  />;
}
