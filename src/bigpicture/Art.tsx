import type { CSSProperties } from "react";
import type { Piko } from "../models";
import { useArtworkUrl } from "./hooks";

/** Legacy libraries stored a fixed purple gradient as "no artwork"; let the theme placeholder show instead. */
const customFallback = (value: string) => (value && !value.includes("rgba(73,57,103") ? value : undefined);

export function artStyle(url: string, piko: Piko | undefined): CSSProperties | undefined {
  if (url) return { backgroundImage: `url("${url}")` };
  const fallback = piko ? customFallback(piko.artwork) : undefined;
  return fallback ? { backgroundImage: fallback } : undefined;
}

export function Art({ piko, className = "" }: { piko: Piko; className?: string }) {
  const url = useArtworkUrl(piko);
  const style = artStyle(url, piko);
  return <div className={`bp-art ${className}`.trim()} style={style} aria-hidden="true">
    {!style && <span className="bp-art-initial">{piko.name.slice(0, 1).toUpperCase()}</span>}
  </div>;
}

/** Full-bleed, crossfading background behind the whole screen. */
export function BackdropLayer({ piko, override }: { piko: Piko | undefined; override?: string }) {
  const url = useArtworkUrl(piko);
  const style = artStyle(override || url, piko);
  return <div className="bp-backdrop-layer" style={style} />;
}
