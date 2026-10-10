import { useEffect, useMemo, useRef } from "react";
import { useApp } from "../state/AppContext";
import { subscribeActions } from "../controller/manager";
import { readAchievements } from "../state/useAchievements";
import { playSound, useSoundSettings, type SoundEvent } from "../lib/sound";
import { applyVolume, isAudioUnlocked, lastPlayedAt, loadChain, unlockAudio } from "../lib/sound/engine";
import { fallbackNoticeOnce } from "../lib/sound/fallbackNotice";
import { BUILTIN_PACKS } from "../lib/sound";
import { useSoundChain } from "../lib/sound/useSoundChain";
import { isBigPictureActive } from "./mode";

const CLICKABLE = "button, a[href], summary, [role=button], [role=tab], [role=menuitem], [role=menuitemradio], [role=menuitemcheckbox], [role=option], [role=radio], [role=switch], input[type=checkbox], input[type=radio]";
const POPUPS = "[role=dialog], [role=alertdialog], [role=menu], [role=listbox], .modal";

/** Which sound a click on `element` makes; reads state before the click flips it. */
export function clickSound(element: Element): SoundEvent {
  if (element instanceof HTMLInputElement && (element.type === "checkbox" || element.type === "radio")) {
    return element.type === "radio" ? "select" : element.checked ? "toggleOff" : "toggleOn";
  }
  const role = element.getAttribute("role");
  if (role === "tab") return "tab";
  if (role === "switch" || element.hasAttribute("aria-pressed")) {
    const state = element.getAttribute(role === "switch" ? "aria-checked" : "aria-pressed");
    return state === "true" ? "toggleOff" : "toggleOn";
  }
  return "select";
}

const matchesPopup = (node: Node) => node instanceof Element && (node.matches(POPUPS) || node.querySelector(POPUPS) !== null);

/**
 * Renders nothing. Plays interface sounds for the whole app (Big Picture and the launcher): controller and
 * keyboard navigation, clicks, toggles, dialogs, launches, downloads, errors, notifications and achievement unlocks.
 * Also preloads the active pack and unlocks audio on the first real input.
 */
export function InterfaceSounds() {
  const { themeEngine, sessions, downloads, actions, notifications } = useApp();
  const [settings] = useSoundSettings();
  const enabled = (settings.bigPicture || settings.launcher) && !settings.muted;
  const theme = useMemo(() => themeEngine.themes.find((option) => option.id === themeEngine.theme), [themeEngine.themes, themeEngine.theme]);
  const { chain, skipped, key: chainKey } = useSoundChain(theme);
  const notifyRef = useRef(notifications.notify);
  notifyRef.current = notifications.notify;

  useEffect(() => { applyVolume(settings); }, [settings]);

  // Preload the resolved chain once per theme/pack change so the first sound is instant. Only packs that are
  // needed are read; a missing or failing pack is skipped, and the user hears about the first one once per session.
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    void loadChain(chain).then(({ failed }) => {
      if (!current) return;
      const name = (id: string) => chain.find((pack) => pack.id === id)?.installed?.name ?? id;
      const lost = [...skipped, ...failed.map(name)];
      const using = chain.find((pack) => !failed.includes(pack.id));
      const text = fallbackNoticeOnce(lost, using?.installed?.name ?? BUILTIN_PACKS.find((pack) => pack.id === using?.id)?.name ?? "Mochi");
      if (text) notifyRef.current("Sound pack unavailable", text);
    }).catch(() => {});
    return () => { current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, chainKey, skipped.join(",")]);

  // Autoplay policy: audio can only start inside a real user gesture.
  useEffect(() => {
    if (!enabled) return;
    const unlock = () => { if (unlockAudio()) remove(); };
    const events = ["pointerdown", "keydown", "touchstart"] as const;
    const remove = () => events.forEach((name) => window.removeEventListener(name, unlock, true));
    if (isAudioUnlocked()) return;
    events.forEach((name) => window.addEventListener(name, unlock, { capture: true, passive: true }));
    return remove;
  }, [enabled]);

  // Controller and Big Picture keyboard actions. Observes only; never consumes.
  const lastConfirm = useRef(0);
  useEffect(() => subscribeActions((event) => {
    if (!isAudioUnlocked()) unlockAudio();
    switch (event.action) {
      case "up": case "down": case "left": case "right": playSound("navigate"); break;
      case "tabPrev": case "tabNext": playSound("tab"); break;
      case "back": playSound("back"); break;
      case "confirm": {
        lastConfirm.current = performance.now();
        const focused = document.activeElement;
        const target = focused?.closest(CLICKABLE);
        if (target && !(target as HTMLButtonElement).disabled && !target.closest("[data-sound=none]")) playSound(clickSound(target));
        break;
      }
      default: break;
    }
    return false;
  }, 10_000), []);

  // Clicks (mouse, touch, Enter/Space). Skips the click a controller "confirm" just produced.
  useEffect(() => {
    if (!enabled) return;
    const onClick = (event: MouseEvent) => {
      if (performance.now() - lastConfirm.current < 150) return;
      const target = (event.target as Element | null)?.closest?.(CLICKABLE);
      // data-sound="none" opts out, for controls that play their own sound (Settings previews).
      if (!target || target.closest("[data-sound=none]") || (target as HTMLButtonElement).disabled || target.getAttribute("aria-disabled") === "true") return;
      playSound(clickSound(target));
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [enabled]);

  // Dialogs, menus and pickers opening and closing in the launcher (Big Picture plays its own).
  useEffect(() => {
    if (!settings.launcher || settings.muted) return;
    const observer = new MutationObserver((records) => {
      if (isBigPictureActive()) return;
      let opened = false, closed = false;
      for (const record of records) {
        record.addedNodes.forEach((node) => { if (!opened && matchesPopup(node)) opened = true; });
        record.removedNodes.forEach((node) => { if (!closed && matchesPopup(node)) closed = true; });
      }
      if (opened) playSound("open"); else if (closed) playSound("close");
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [settings.launcher, settings.muted]);

  // A game started.
  const running = useRef(new Set<string>());
  useEffect(() => {
    const ids = new Set(sessions.sessions.map((session) => session.gameId));
    const started = [...ids].some((id) => !running.current.has(id));
    running.current = ids;
    if (started) playSound("launch");
  }, [sessions.sessions]);

  // Errors shown by launch actions.
  useEffect(() => { if (actions.launchError) playSound("error"); }, [actions.launchError]);

  // Downloads finishing or failing.
  const downloadState = useRef(new Map<string, string>());
  useEffect(() => {
    let finished = false, failed = false;
    const next = new Map<string, string>();
    for (const entry of downloads) {
      const before = downloadState.current.get(entry.id);
      if (before === "downloading" && entry.status === "completed") finished = true;
      if (before === "downloading" && entry.status === "failed") failed = true;
      next.set(entry.id, entry.status);
    }
    downloadState.current = next;
    if (finished) playSound("download"); else if (failed) playSound("error");
  }, [downloads]);

  // New notifications, unless a more specific sound just played for the same thing.
  const seenNotification = useRef<string | null>(null);
  useEffect(() => {
    const newest = notifications.notifications[0];
    const previous = seenNotification.current;
    seenNotification.current = newest?.id ?? null;
    if (!newest || newest.id === previous || (previous === null && notifications.notifications.length > 1) || newest.progress) return;
    const timer = window.setTimeout(() => {
      const now = performance.now();
      const covered = (["download", "achievement", "error", "launch"] as const).some((event) => now - lastPlayedAt(event) < 800);
      if (!covered) playSound("notification");
    }, 80);
    return () => window.clearTimeout(timer);
  }, [notifications.notifications]);

  // Achievement unlocks (the watcher announces changes with a window event).
  useEffect(() => {
    let before = readAchievements();
    const onChange = () => {
      const after = readAchievements();
      const gained = Object.keys(after.unlocked).some((id) => !(id in before.unlocked));
      // The first run unlocks an existing library silently; so do we.
      if (gained && before.seeded) playSound("achievement");
      before = after;
    };
    window.addEventListener("mochi-achievements-changed", onChange);
    return () => window.removeEventListener("mochi-achievements-changed", onChange);
  }, []);

  return null;
}
