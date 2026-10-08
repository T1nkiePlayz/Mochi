import { useEffect, useMemo, useState, useSyncExternalStore, type ComponentType, type CSSProperties } from "react";
import type { LucideProps } from "lucide-react";
import { cssUrl } from "../lib/metadata/merge";

type Mode = "mask" | "image";

function iconVariable(name: string): string {
  return name.replace(/([a-z])([A-Z])/g, "$1-$2").replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();
}

/** Pulls the URL out of a `url("...")` custom property value. */
function assetUrl(value: string): string {
  const match = /^url\(\s*(['"]?)(.*)\1\s*\)$/.exec(value.trim());
  return match ? match[2] : "";
}

function isSvg(url: string): boolean {
  return /^data:image\/svg\+xml/i.test(url) || /\.svg(?:[?#].*)?$/i.test(url);
}

/**
 * A theme SVG can be tinted (mask) only when it is monochrome: one paint colour at most
 * and no gradients or embedded images. Coloured artwork keeps its own colours.
 */
export function isMonochromeSvg(source: string): boolean {
  if (/<(?:image|linearGradient|radialGradient|pattern)\b/i.test(source)) return false;
  const colours = new Set<string>();
  for (const match of source.matchAll(/\b(?:fill|stroke|stop-color)\s*[=:]\s*["']?\s*([^"';\s>]+)/gi)) {
    const colour = match[1].toLowerCase();
    if (colour === "none" || colour === "transparent" || colour === "currentcolor" || colour.startsWith("url(")) continue;
    colours.add(colour);
  }
  return colours.size <= 1;
}

const modes = new Map<string, Mode>();
const pending = new Map<string, Promise<Mode>>();

/** Decides how to paint an asset. Raster formats are always images; SVGs are inspected once and cached. */
async function resolveMode(url: string): Promise<Mode> {
  if (!isSvg(url)) return "image";
  const known = modes.get(url);
  if (known) return known;
  let request = pending.get(url);
  if (!request) {
    request = (async () => {
      try {
        const text = url.startsWith("data:") ? decodeURIComponent(url.slice(url.indexOf(",") + 1)) : await (await fetch(url)).text();
        return isMonochromeSvg(text) ? "mask" : "image";
      } catch {
        return "image";
      }
    })().then((mode) => { modes.set(url, mode); pending.delete(url); return mode; });
    pending.set(url, request);
  }
  return request;
}

type Props = LucideProps & {
  name: string;
  fallback: ComponentType<LucideProps>;
};

// One shared theme listener and one style read per theme change, instead of one of each per icon on screen.
let themeRevision = 0;
const themeListeners = new Set<() => void>();
const themeValues = new Map<string, { url: string; forced: Mode | "" }>();

function onThemeChanged() {
  themeRevision += 1;
  themeValues.clear();
  themeListeners.forEach((listener) => listener());
}

function subscribeTheme(listener: () => void) {
  if (!themeListeners.size) window.addEventListener("mochi-theme-changed", onThemeChanged);
  themeListeners.add(listener);
  return () => {
    themeListeners.delete(listener);
    if (!themeListeners.size) window.removeEventListener("mochi-theme-changed", onThemeChanged);
  };
}

function readThemeIcon(variable: string): { url: string; forced: Mode | "" } {
  let value = themeValues.get(variable);
  if (!value) {
    const style = getComputedStyle(document.documentElement);
    // A theme can force one mode for its whole set (--mochi-icon-mode: image | mask) so mixed artwork stays consistent.
    const override = style.getPropertyValue("--mochi-icon-mode").trim();
    value = { url: assetUrl(style.getPropertyValue(variable)), forced: override === "image" || override === "mask" ? override : "" };
    themeValues.set(variable, value);
  }
  return value;
}

export function MochiIcon({ name, fallback: Fallback, size = 16, ...props }: Props) {
  const variable = "--mochi-icon-" + iconVariable(name);
  const revision = useSyncExternalStore(subscribeTheme, () => themeRevision, () => 0);
  const { url: customUrl, forced } = useMemo(() => readThemeIcon(variable), [variable, revision]); // eslint-disable-line react-hooks/exhaustive-deps
  const [mode, setMode] = useState<Mode>("image");

  useEffect(() => {
    let live = true;
    if (customUrl) void resolveMode(customUrl).then((resolved) => { if (live) setMode(resolved); });
    return () => { live = false; };
  }, [customUrl]);

  return (
    <span
      className="mochi-icon-wrap"
      aria-hidden="true"
      style={{ width: size, height: size, minWidth: size, minHeight: size, flex: `0 0 ${size}px` }}
    >
      {customUrl
        ? <span className="mochi-icon-custom" data-mode={forced || mode} style={{ "--mochi-icon-src": cssUrl(customUrl) } as CSSProperties} />
        : <Fallback size={size} {...props} />}
    </span>
  );
}
