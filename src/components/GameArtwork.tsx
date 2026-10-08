import { useEffect, useRef, useState } from "react";
import { ARTWORK_CHANGED_EVENT } from "../lib/artwork";
import { loadArtwork, peekArtwork } from "../lib/artworkCache";
import { cssUrl } from "../lib/metadata/merge";

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

export function GameArtwork({ className, cacheKey, fallback }: { className: string; cacheKey?: string; fallback: string }) {
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
  // Older libraries stored a hard-coded purple gradient as "no artwork"; let the theme's placeholder show instead.
  const custom = fallback && !fallback.includes("rgba(73,57,103") ? fallback : undefined;
  return <div ref={ref} className={className} style={{ backgroundImage: cached ? `linear-gradient(145deg, rgba(10,15,20,.12), rgba(11,15,20,.88)), ${cssUrl(cached)}` : custom }} />;
}
