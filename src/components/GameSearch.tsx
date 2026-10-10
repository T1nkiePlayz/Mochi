import { lazy, Suspense, useEffect, useState } from "react";
import { useExperimental } from "../state/useExperimental";
import { OPEN_GAME_SEARCH_EVENT } from "../lib/gameSearch";

const GameSearchDialog = lazy(() => import("./GameSearchDialog").then((m) => ({ default: m.GameSearchDialog })));

/** Mounted once; renders nothing until the "Search all games" command opens it. */
export function GameSearch() {
  const enabled = useExperimental("game-search");
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(OPEN_GAME_SEARCH_EVENT, show);
    return () => window.removeEventListener(OPEN_GAME_SEARCH_EVENT, show);
  }, []);
  if (!open || !enabled) return null;
  return <Suspense fallback={null}><GameSearchDialog onClose={() => setOpen(false)} /></Suspense>;
}

