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
export function GameAvatar({ src, name, className = "" }: { src?: string; name: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const style = { "--game-hue": hueOf(name) } as React.CSSProperties;
  return <span className={`game-avatar ${className}`.trim()} style={style} aria-hidden="true">
    {src && !failed ? <img src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <span className="game-avatar-initials">{initialsOf(name)}</span>}
  </span>;
}
