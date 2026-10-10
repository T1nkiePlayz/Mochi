/**
 * Accessibility settings: stored per device (not synced), applied to <html> as data attributes and CSS
 * variables, and styled by src/styles/features/accessibility.css. `bootAccessibility()` runs synchronously
 * before React renders so there is no flash of unstyled settings.
 */
import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { readJson, storageKeys, writeJson } from "../lib/storage";

export type Tri = "system" | "on" | "off";
export type Accessibility = {
  /** Text size in percent of the default (85-150). */
  textScale: number;
  largeTargets: boolean;
  reduceMotion: Tri;
  reduceTransparency: boolean;
  highContrast: Tri;
  focusSize: "normal" | "thick" | "extra";
  focusColor: "theme" | "yellow" | "cyan" | "magenta" | "orange" | "text";
  focusOffset: number;
  focusAlways: boolean;
  focusDouble: boolean;
  underlineLinks: boolean;
  dyslexiaFont: boolean;
  lineHeight: "default" | "relaxed" | "loose";
  letterSpacing: "default" | "wide" | "wider";
  wordSpacing: "default" | "wide" | "wider";
  colorBlind: "none" | "deuteranopia" | "protanopia" | "tritanopia";
  largeCursor: boolean;
  textLabels: boolean;
  announcements: boolean;
  keepControlsVisible: boolean;
  simpleBackground: boolean;
};

export const defaultAccessibility: Accessibility = {
  textScale: 100, largeTargets: false, reduceMotion: "system", reduceTransparency: false, highContrast: "system",
  focusSize: "normal", focusColor: "theme", focusOffset: 2, focusAlways: false, focusDouble: false,
  underlineLinks: false, dyslexiaFont: false, lineHeight: "default", letterSpacing: "default", wordSpacing: "default",
  colorBlind: "none", largeCursor: false, textLabels: false, announcements: true, keepControlsVisible: false, simpleBackground: false,
};

const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
const pick = <T extends string>(v: unknown, allowed: readonly T[], d: T): T => (allowed.includes(v as T) ? (v as T) : d);
const clamp = (v: unknown, min: number, max: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : d);

/** Accepts anything read from storage and returns valid settings (missing or invalid values fall back to defaults). */
export function normalizeAccessibility(raw: unknown): Accessibility {
  const s = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = defaultAccessibility;
  return {
    textScale: clamp(s.textScale, 85, 150, d.textScale),
    largeTargets: bool(s.largeTargets, d.largeTargets),
    reduceMotion: pick(s.reduceMotion, ["system", "on", "off"], d.reduceMotion),
    reduceTransparency: bool(s.reduceTransparency, d.reduceTransparency),
    highContrast: pick(s.highContrast, ["system", "on", "off"], d.highContrast),
    focusSize: pick(s.focusSize, ["normal", "thick", "extra"], d.focusSize),
    focusColor: pick(s.focusColor, ["theme", "yellow", "cyan", "magenta", "orange", "text"], d.focusColor),
    focusOffset: clamp(s.focusOffset, 0, 6, d.focusOffset),
    focusAlways: bool(s.focusAlways, d.focusAlways),
    focusDouble: bool(s.focusDouble, d.focusDouble),
    underlineLinks: bool(s.underlineLinks, d.underlineLinks),
    dyslexiaFont: bool(s.dyslexiaFont, d.dyslexiaFont),
    lineHeight: pick(s.lineHeight, ["default", "relaxed", "loose"], d.lineHeight),
    letterSpacing: pick(s.letterSpacing, ["default", "wide", "wider"], d.letterSpacing),
    wordSpacing: pick(s.wordSpacing, ["default", "wide", "wider"], d.wordSpacing),
    colorBlind: pick(s.colorBlind, ["none", "deuteranopia", "protanopia", "tritanopia"], d.colorBlind),
    largeCursor: bool(s.largeCursor, d.largeCursor),
    textLabels: bool(s.textLabels, d.textLabels),
    announcements: bool(s.announcements, d.announcements),
    keepControlsVisible: bool(s.keepControlsVisible, d.keepControlsVisible),
    simpleBackground: bool(s.simpleBackground, d.simpleBackground),
  };
}

const media = (query: string): boolean => {
  try { return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches; } catch { return false; }
};
export const systemPrefersReducedMotion = () => media("(prefers-reduced-motion: reduce)");
export const systemPrefersMoreContrast = () => media("(prefers-contrast: more)");

/** Resolves the System/On/Off choices against the operating system. */
export function effectiveAccessibility(a: Accessibility) {
  return {
    reduceMotion: a.reduceMotion === "on" || (a.reduceMotion === "system" && systemPrefersReducedMotion()),
    highContrast: a.highContrast === "on" || (a.highContrast === "system" && systemPrefersMoreContrast()),
  };
}

const flag = (on: boolean) => (on ? "true" : "false");

export function applyAccessibility(a: Accessibility, root: HTMLElement = document.documentElement): void {
  const eff = effectiveAccessibility(a);
  const set = (name: string, value: string) => { root.dataset[name] = value; };
  set("reduceMotion", flag(eff.reduceMotion));
  set("highContrast", flag(eff.highContrast));
  set("reduceTransparency", flag(a.reduceTransparency));
  set("largeTargets", flag(a.largeTargets));
  set("focusSize", a.focusSize);
  set("focusColor", a.focusColor);
  set("focusAlways", flag(a.focusAlways));
  set("focusDouble", flag(a.focusDouble));
  set("underlineLinks", flag(a.underlineLinks));
  set("dyslexiaFont", flag(a.dyslexiaFont));
  set("lineSpacing", a.lineHeight);
  set("letterSpacing", a.letterSpacing);
  set("wordSpacing", a.wordSpacing);
  set("colorBlind", a.colorBlind);
  set("largeCursor", flag(a.largeCursor));
  set("textLabels", flag(a.textLabels));
  set("keepControls", flag(a.keepControlsVisible));
  set("simpleBackground", flag(a.simpleBackground));
  set("scheme", root.style.colorScheme.includes("light") ? "light" : "dark");
  root.style.setProperty("--mochi-ui-scale", String(a.textScale / 100));
  root.style.setProperty("--mochi-a11y-focus-offset", `${a.focusOffset}px`);
}

export const loadAccessibility = (): Accessibility => normalizeAccessibility(readJson<unknown>(storageKeys.accessibility, null));

/** Reads and applies stored settings synchronously. Call before the first render. */
export function bootAccessibility(): void {
  try { applyAccessibility(loadAccessibility()); } catch { /* unusable document: leave defaults */ }
}

type Ctx = { settings: Accessibility; update: (changes: Partial<Accessibility>) => void; reset: () => void; effective: ReturnType<typeof effectiveAccessibility> };
const AccessibilityContext = createContext<Ctx | null>(null);

export function AccessibilityProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Accessibility>(loadAccessibility);
  const [systemTick, setSystemTick] = useState(0);

  useEffect(() => { applyAccessibility(settings); }, [settings, systemTick]);
  useEffect(() => { writeJson(storageKeys.accessibility, settings); }, [settings]);

  // Re-resolve "System" choices when the OS preference changes, and track the theme's colour scheme.
  useEffect(() => {
    const lists = ["(prefers-reduced-motion: reduce)", "(prefers-contrast: more)"].map((q) => { try { return window.matchMedia(q); } catch { return null; } });
    const onChange = () => setSystemTick((n) => n + 1);
    lists.forEach((l) => l?.addEventListener?.("change", onChange));
    const observer = new MutationObserver(() => {
      const scheme = document.documentElement.style.colorScheme.includes("light") ? "light" : "dark";
      if (document.documentElement.dataset.scheme !== scheme) document.documentElement.dataset.scheme = scheme;
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "data-mochi-theme"] });
    return () => { lists.forEach((l) => l?.removeEventListener?.("change", onChange)); observer.disconnect(); };
  }, []);

  const update = useCallback((changes: Partial<Accessibility>) => setSettings((current) => normalizeAccessibility({ ...current, ...changes })), []);
  const reset = useCallback(() => setSettings(defaultAccessibility), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `systemTick` forces `effective` to be recomputed when the OS preference changes
  const value = useMemo(() => ({ settings, update, reset, effective: effectiveAccessibility(settings) }), [settings, update, reset, systemTick]);
  return createElement(AccessibilityContext.Provider, { value }, children);
}

const fallback: Ctx = { settings: defaultAccessibility, update: () => undefined, reset: () => undefined, effective: { reduceMotion: false, highContrast: false } };
export function useAccessibility(): Ctx {
  return useContext(AccessibilityContext) ?? fallback;
}

// ---- Screen reader announcements -------------------------------------------------------------------
let liveRegion: HTMLElement | null = null;
let clearTimer: number | undefined;

function region(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  if (liveRegion && document.body.contains(liveRegion)) return liveRegion;
  liveRegion = document.createElement("div");
  liveRegion.className = "visually-hidden";
  liveRegion.id = "mochi-announcer";
  liveRegion.setAttribute("role", "status");
  liveRegion.setAttribute("aria-live", "polite");
  liveRegion.setAttribute("aria-atomic", "true");
  document.body.appendChild(liveRegion);
  return liveRegion;
}

/** Speaks `message` through a polite live region (mounted once). Use sparingly for results the user cannot otherwise perceive. */
export function announce(message: string, politeness: "polite" | "assertive" = "polite"): void {
  if (!loadAccessibility().announcements) return;
  const el = region();
  if (!el) return;
  el.setAttribute("aria-live", politeness);
  el.setAttribute("role", politeness === "assertive" ? "alert" : "status");
  el.textContent = "";
  window.clearTimeout(clearTimer);
  // A short delay makes repeated identical messages re-announce.
  window.setTimeout(() => { el.textContent = message; }, 40);
  clearTimer = window.setTimeout(() => { el.textContent = ""; }, 6000);
}
