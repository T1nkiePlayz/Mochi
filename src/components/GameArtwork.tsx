import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ARTWORK_CHANGED_EVENT } from "../lib/artwork";

export function GameArtwork({ className, cacheKey, fallback }: { className: string; cacheKey?: string; fallback: string }) {
  const [cached, setCached] = useState("");
  const [revision, setRevision] = useState(0);
  // Reload when the editor saved or removed this game's cover.
  useEffect(() => {
    const onChanged = (event: Event) => { if ((event as CustomEvent<string>).detail === cacheKey) setRevision((value) => value + 1); };
    window.addEventListener(ARTWORK_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(ARTWORK_CHANGED_EVENT, onChanged);
  }, [cacheKey]);
  useEffect(() => {
    let cancelled = false;
    setCached("");
    if (cacheKey) void invoke<string | null>("get_cached_game_artwork", { cacheKey })
      .then(value => { if (!cancelled && value) setCached(value); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [cacheKey, revision]);
  // Older libraries stored a hard-coded purple gradient as "no artwork"; let the theme's placeholder show instead.
  const custom = fallback && !fallback.includes("rgba(73,57,103") ? fallback : undefined;
  return <div className={className} style={{ backgroundImage: cached ? `linear-gradient(145deg, rgba(10,15,20,.12), rgba(11,15,20,.88)), url("${cached}")` : custom }} />;
}
