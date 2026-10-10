import { useEffect, useState } from "react";

/** Initials on a colour picked from the name, so the same game always looks the same. */
export function initialsOf(name: string): string {
  const words = name.replace(/[^\p{L}\p{N} ]+/gu, " ").split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function hueOf(name: string): number {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.codePointAt(0)!) % 360;
  return hash;
}

/**
 * A game's full icon, cropped to the avatar shape (round; square in the Ore theme) with a themed backdrop, so a
 * transparent PNG never shows up as a box. No image, or one that fails to load, becomes initials.
 */
export function GameAvatar({ src, fallbackSrcs = [], name, className = "" }: { src?: string; fallbackSrcs?: string[]; name: string; className?: string }) {
  const [fallbackIndex, setFallbackIndex] = useState(src ? -1 : 0);
  const [failed, setFailed] = useState(false);
  const fallbacks = fallbackSrcs.filter((url, index, all) => Boolean(url) && url !== src && all.indexOf(url) === index);
  const fallbackKey = fallbacks.join("\n");
  // Depend on URL values rather than array identity; callers may build an equivalent array during render.
  useEffect(() => { setFallbackIndex(src ? -1 : 0); setFailed(false); }, [src, fallbackKey]);
  const activeSrc = fallbackIndex < 0 ? src : fallbacks[fallbackIndex];
  const style = { "--game-hue": hueOf(name) } as React.CSSProperties;
  const onError = () => {
    if (fallbackIndex + 1 < fallbacks.length) setFallbackIndex((index) => index + 1);
    else setFailed(true);
  };
  return <span className={`game-avatar ${className}`.trim()} style={style} aria-hidden="true">
    {activeSrc && !failed ? <img src={activeSrc} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={onError} /> : <span className="game-avatar-initials">{initialsOf(name)}</span>}
  </span>;
}
