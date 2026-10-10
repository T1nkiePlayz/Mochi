import { lazy, Suspense, useEffect, useState } from "react";
import { OPEN_GAME_SEARCH_EVENT } from "../lib/gameSearch";

const GameSearchDialog = lazy(() => import("./GameSearchDialog").then((m) => ({ default: m.GameSearchDialog })));

/** Mounted once; renders nothing until the "Search all games" command opens it. */
export function GameSearch() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(OPEN_GAME_SEARCH_EVENT, show);
    return () => window.removeEventListener(OPEN_GAME_SEARCH_EVENT, show);
  }, []);
  if (!open) return null;
  return <Suspense fallback={null}><GameSearchDialog onClose={() => setOpen(false)} /></Suspense>;
}

