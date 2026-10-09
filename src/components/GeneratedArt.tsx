import type { CSSProperties } from "react";
import type { GeneratedArt } from "../lib/fallbackArt";

/** Inline style that gives a `.generated-art` element its name-derived hue. */
export const generatedStyle = (art: GeneratedArt) => ({ "--art-hue": art.hue }) as CSSProperties;

/** The initials (and the source's icon, when known) drawn on a generated cover. */
export function GeneratedMarks({ art }: { art: GeneratedArt }) {
  return <>
    <span className="generated-art-mark" aria-hidden="true">{art.initials}</span>
    {art.sourceIcon && <img className="generated-art-source" src={art.sourceIcon} alt="" width={20} height={20} draggable={false} />}
  </>;
}
