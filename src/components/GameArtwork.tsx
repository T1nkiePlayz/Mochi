import { useEffect, useRef, useState } from "react";
import { ARTWORK_CHANGED_EVENT } from "../lib/artwork";
import { loadArtwork, peekArtwork } from "../lib/artworkCache";
import { cssUrl } from "../lib/metadata/merge";
import { artworkBackground, generatedArt } from "../lib/fallbackArt";
import type { Piko } from "../models";
import { GeneratedMarks, generatedStyle } from "./GeneratedArt";

/** Resolves true once the element is (nearly) on screen, so off-screen covers in a long library are not loaded. */
function useNearViewport(ref: React.RefObject<HTMLElement>, skip: boolean) {
  const [near, setNear] = useState(() => skip || typeof IntersectionObserver === "undefined");
  useEffect(() => {
    if (near || !ref.current) return;
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) setNear(true); }, { rootMargin: "400px" });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [near, ref]);
  return near;
}

/** The game's cover, or a generated local cover (its initials on a colour taken from its name) when there is none. Never an empty box. */
export function GameArtwork({ className, cacheKey, fallback, name, kind, sourceId }: { className: string; cacheKey?: string; fallback: string; name?: string } & Pick<Piko, "kind" | "sourceId">) {
  const ref = useRef<HTMLDivElement>(null);
  const [cached, setCached] = useState(() => (cacheKey ? peekArtwork(cacheKey) ?? "" : ""));
  const [revision, setRevision] = useState(0);
  const near = useNearViewport(ref, cached !== "");
  // Reload when the editor saved or removed this game's cover.
  useEffect(() => {
    const onChanged = (event: Event) => { if ((event as CustomEvent<string>).detail === cacheKey) setRevision((value) => value + 1); };
    window.addEventListener(ARTWORK_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(ARTWORK_CHANGED_EVENT, onChanged);
  }, [cacheKey]);
  useEffect(() => {
    if (!cacheKey) { setCached(""); return; }
    const known = peekArtwork(cacheKey);
    if (known !== undefined) { setCached(known); return; }
    setCached("");
    if (!near) return;
    let cancelled = false;
    void loadArtwork(cacheKey).then((value) => { if (!cancelled && value) setCached(value); });
    return () => { cancelled = true; };
  }, [cacheKey, revision, near]);
  const background = cached ? `linear-gradient(145deg, rgba(10,15,20,.12), rgba(11,15,20,.88)), ${cssUrl(cached)}` : artworkBackground(fallback);
  if (background || !name) return <div ref={ref} className={className} style={{ backgroundImage: background }} />;
  const art = generatedArt({ name, kind, sourceId });
  return <div ref={ref} className={`${className} generated-art${art.launcher ? " is-launcher" : ""}`} style={generatedStyle(art)} data-generated-art=""><GeneratedMarks art={art} /></div>;
}
