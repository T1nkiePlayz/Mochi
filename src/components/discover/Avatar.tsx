import { useEffect, useState } from "react";
import { hueOf, initialsOf } from "./GameAvatar";

/**
 * A person's picture, always round. Lazy, sent without a referrer (some hosts refuse hot-linking), and a missing or
 * broken image becomes their initials on a colour from their name instead of a broken-image icon.
 */
export function Avatar({ src, name, className = "" }: { src?: string | null; name: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const style = { "--game-hue": hueOf(name || "?") } as React.CSSProperties;
  return <span className={`creator-avatar ${className}`.trim()} style={style} aria-hidden="true">
    {src && !failed ? <img src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <span>{initialsOf(name || "?")}</span>}
  </span>;
}
