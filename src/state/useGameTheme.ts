import { useEffect } from "react";
import type { Piko } from "../models";
import { loadArtwork } from "../lib/artworkCache";
import { accentFor, dominantColor, GAME_THEME_STYLE_ID, gameThemeCss, isHexColor, readGameAccents, rememberGameAccent } from "../lib/gameTheme";

const SAMPLE = 48;

/** Reads a colour from a game's cover (a local data/asset URL). Resolves null when it cannot be read or has no colour. */
async function colorFromImage(url: string): Promise<string | null> {
  const image = new Image();
  image.decoding = "async";
  image.src = url;
  try { await image.decode(); } catch { return null; }
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SAMPLE;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  try {
    context.drawImage(image, 0, 0, SAMPLE, SAMPLE);
    return dominantColor(context.getImageData(0, 0, SAMPLE, SAMPLE).data);
  } catch { return null; }
}

const removeStyle = () => document.getElementById(GAME_THEME_STYLE_ID)?.remove();

/**
 * The automatic per-game theme: while a game's page is open, its accent colour (taken from its cover, or the colour
 * saved with the game) is laid over the current theme. One setting, no per-game configuration. Off by default.
 */
export function useGameTheme(enabled: boolean, game: Piko | undefined) {
  const key = game ? game.artworkCacheKey || game.id : "";
  const fallback = game?.accent;
  const artworkKey = game?.artworkCacheKey;

  useEffect(() => {
    if (!enabled || !game) { removeStyle(); return; }
    let cancelled = false;
    const apply = (hex: string) => {
      if (cancelled) return;
      const scheme = document.documentElement.style.colorScheme === "light" ? "light" : "dark";
      const background = getComputedStyle(document.documentElement).getPropertyValue("--mochi-background").trim();
      const style = document.getElementById(GAME_THEME_STYLE_ID) ?? Object.assign(document.createElement("style"), { id: GAME_THEME_STYLE_ID });
      style.textContent = gameThemeCss(accentFor(hex, scheme, isHexColor(background) ? background : scheme === "dark" ? "#101010" : "#ffffff"));
      if (!style.isConnected) document.head.appendChild(style);
    };
    const remembered = readGameAccents()[key];
    if (remembered) apply(remembered);
    else if (isHexColor(fallback)) apply(fallback);
    if (!remembered && artworkKey) {
      void loadArtwork(artworkKey).then((url) => (url ? colorFromImage(url) : null)).then((hex) => { if (hex && !cancelled) { rememberGameAccent(key, hex); apply(hex); } }).catch(() => undefined);
    }
    // A theme switch rewrites the colours; lay the game's accent back over the new theme.
    const retheme = () => { const hex = readGameAccents()[key] ?? (isHexColor(fallback) ? fallback : null); if (hex) apply(hex); };
    window.addEventListener("mochi-theme-changed", retheme);
    return () => { cancelled = true; window.removeEventListener("mochi-theme-changed", retheme); removeStyle(); };
  }, [enabled, game?.id, key, fallback, artworkKey]); // eslint-disable-line react-hooks/exhaustive-deps
}
