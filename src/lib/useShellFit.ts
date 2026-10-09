import { useLayoutEffect, type RefObject } from "react";

/** Narrowing steps for the navigation, widest first. `drawer` is the last resort (see src/styles/layout.css). */
export type NavMode = "full" | "compact" | "tight" | "icons" | "drawer";
export const NAV_STEPS: readonly NavMode[] = ["full", "compact", "tight", "icons"];

/** The widest step whose navigation fits, or the drawer when none does. */
export function pickNavMode(fits: (mode: NavMode) => boolean, steps: readonly NavMode[] = NAV_STEPS): NavMode {
  for (const mode of steps) if (fits(mode)) return mode;
  return "drawer";
}

/** Below this width (CSS px) a sidebar and a usable page cannot share the window. */
export const SIDEBAR_MIN_VIEWPORT = 720;

/**
 * Chooses `<html data-nav-mode>` from what actually fits, so any theme (fonts, padding and nav items of any size),
 * text size or window size gets a navigation that is never cut off: bar shells step down until the bar stops
 * overflowing; sidebar shells switch to the drawer when the window is too narrow for a sidebar.
 */
export function useShellFit(ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const bar = ref.current;
    if (!bar) return undefined;
    let frame = 0;

    const fits = (mode: NavMode): boolean => {
      root.dataset.navMode = mode;
      const shell = root.dataset.mochiShell ?? "left";
      if (shell === "top" || shell === "bottom") return bar.scrollWidth <= bar.clientWidth + 1;
      return root.clientWidth >= SIDEBAR_MIN_VIEWPORT && bar.clientWidth <= root.clientWidth * 0.4;
    };
    const fit = () => {
      frame = 0;
      const mode = pickNavMode(fits);
      root.dataset.navMode = mode;
      if (mode !== "drawer") delete root.dataset.navOpen;
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(fit); };

    fit();
    const resize = new ResizeObserver(schedule);
    resize.observe(root);
    resize.observe(bar);
    // Attribute changes that change sizes: theme and shell, text size and other accessibility settings, inline font scaling.
    const mutations = new MutationObserver((records) => {
      if (records.some((record) => record.attributeName && record.attributeName !== "data-nav-mode" && record.attributeName !== "data-nav-open")) schedule();
    });
    mutations.observe(root, { attributes: true });
    window.addEventListener("resize", schedule);
    window.addEventListener("mochi-theme-changed", schedule);
    void document.fonts?.ready.then(schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      resize.disconnect();
      mutations.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("mochi-theme-changed", schedule);
      delete root.dataset.navMode;
    };
  }, [ref]);
}
