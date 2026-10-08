import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export function GameArtwork({ className, cacheKey, fallback }: { className: string; cacheKey?: string; fallback: string }) {
  const [cached, setCached] = useState("");
  useEffect(() => {
    let cancelled = false;
    setCached("");
    if (cacheKey) void invoke<string | null>("get_cached_game_artwork", { cacheKey })
      .then(value => { if (!cancelled && value) setCached(value); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [cacheKey]);
  return <div className={className} style={{ backgroundImage: cached ? `linear-gradient(145deg, rgba(10,15,20,.12), rgba(11,15,20,.88)), url("${cached}")` : fallback }} />;
}
