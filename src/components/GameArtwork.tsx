import { useEffect, useRef, useState } from "react";
import { ARTWORK_CHANGED_EVENT } from "../lib/artwork";
import { loadArtwork, peekArtwork } from "../lib/artworkCache";
import { cssUrl } from "../lib/metadata/merge";
import { artworkBackground, generatedArt } from "../lib/fallbackArt";
import type { Piko } from "../models";
import { useNearViewport } from "../hooks";
import { GeneratedMarks, generatedStyle } from "./GeneratedArt";

/** Resolve after the browser has loaded and, where supported, decoded the artwork. */
function prepareArtwork(url: string): Promise<void> {
  return new Promise((resolve) => {
    const image = new Image();
    image.decoding = "async";
    const finish = () => resolve();
    image.onload = finish;
    image.onerror = finish;
    image.src = url;
    if (typeof image.decode === "function") void image.decode().then(finish, finish);
    else if (image.complete) finish();
  });
}

/** The game's cover, or a generated local cover (its initials on a colour taken from its name) when there is none. Never an empty box. */
export function GameArtwork({ className, cacheKey, fallback, name, kind, sourceId }: { className: string; cacheKey?: string; fallback: string; name?: string } & Pick<Piko, "kind" | "sourceId">) {
  const ref = useRef<HTMLDivElement>(null);
  const [cached, setCached] = useState(() => (cacheKey ? peekArtwork(cacheKey) ?? "" : ""));
  const [readyCached, setReadyCached] = useState("");
  const [revision, setRevision] = useState(0);
  // Load well before a cover enters view. Once a card has been near the viewport it stays eligible,
  // avoiding repeated native lookups when the user scrolls back and forth through the Library.
  const near = useNearViewport(ref, cached !== "", "1200px 0px");

  // Do not swap the placeholder for a URL until the browser has decoded the image. This avoids
  // exposing a blank/unpainted background while WebKit catches up during fast scrolling.
  useEffect(() => {
    if (!cached) { setReadyCached(""); return; }
    let cancelled = false;
    void prepareArtwork(cached).then(() => { if (!cancelled) setReadyCached(cached); });
    return () => { cancelled = true; };
  }, [cached]);

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

  const visibleCached = cached && readyCached === cached ? cached : "";
  const background = visibleCached ? `linear-gradient(145deg, rgba(10,15,20,.02), rgba(11,15,20,.12)), ${cssUrl(visibleCached)}` : artworkBackground(fallback);
  if (background || !name) return <div ref={ref} className={className} style={{ backgroundImage: background }} />;
  const art = generatedArt({ name, kind, sourceId });
  return <div ref={ref} className={`${className} generated-art${art.launcher ? " is-launcher" : ""}`} style={generatedStyle(art)} data-generated-art=""><GeneratedMarks art={art} /></div>;
}
