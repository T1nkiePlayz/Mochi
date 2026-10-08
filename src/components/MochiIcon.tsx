import { useEffect, useState, type ComponentType, type CSSProperties } from "react";
import type { LucideProps } from "lucide-react";

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

export function MochiIcon({ name, fallback: Fallback, size = 16, ...props }: Props) {
  const variable = "--mochi-icon-" + iconVariable(name);
  const [customUrl, setCustomUrl] = useState("");
  const [mode, setMode] = useState<Mode>("image");
  const [forced, setForced] = useState<Mode | "">("");

  useEffect(() => {
    const update = () => {
      const style = getComputedStyle(document.documentElement);
      setCustomUrl(assetUrl(style.getPropertyValue(variable)));
      // A theme can force one mode for its whole set (--mochi-icon-mode: image | mask) so mixed artwork stays consistent.
      const override = style.getPropertyValue("--mochi-icon-mode").trim();
      setForced(override === "image" || override === "mask" ? override : "");
    };
    update();
    window.addEventListener("mochi-theme-changed", update);
    return () => window.removeEventListener("mochi-theme-changed", update);
  }, [variable]);

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
        ? <span className="mochi-icon-custom" data-mode={forced || mode} style={{ "--mochi-icon-src": `url("${customUrl}")` } as CSSProperties} />
        : <Fallback size={size} {...props} />}
    </span>
  );
}
