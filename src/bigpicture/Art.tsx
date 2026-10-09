import type { CSSProperties } from "react";
import type { Piko } from "../models";
import { useArtworkUrl } from "./hooks";
import { cssUrl } from "../lib/metadata/merge";
import { artworkBackground, generatedArt } from "../lib/fallbackArt";
import { GeneratedMarks, generatedStyle } from "../components/GeneratedArt";

export function artStyle(url: string, piko: Piko | undefined): CSSProperties | undefined {
  if (url) return { backgroundImage: cssUrl(url) };
  const fallback = piko ? artworkBackground(piko.artwork) : undefined;
  return fallback ? { backgroundImage: fallback } : undefined;
}

export function Art({ piko, className = "" }: { piko: Piko; className?: string }) {
  const url = useArtworkUrl(piko);
  const style = artStyle(url, piko);
  if (style) return <div className={`bp-art ${className}`.trim()} style={style} aria-hidden="true" />;
  const art = generatedArt(piko);
  return <div className={`bp-art generated-art ${className}`.trim()} style={generatedStyle(art)} aria-hidden="true"><GeneratedMarks art={art} /></div>;
}

/** Full-bleed, crossfading background behind the whole screen. */
export function BackdropLayer({ piko, override }: { piko: Piko | undefined; override?: string }) {
  const url = useArtworkUrl(piko);
  const style = artStyle(override || url, piko);
  // No artwork: tint the backdrop with the game's own generated colours.
  if (!style && piko) return <div className="bp-backdrop-layer generated-art is-backdrop" style={generatedStyle(generatedArt(piko))} />;
  return <div className="bp-backdrop-layer" style={style} />;
}
