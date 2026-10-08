import { Suspense, lazy } from "react";
import type { Piko, Tofu } from "../../models";
import { modSupportOf } from "../../lib/mods/gameSupport";

// The mod managers are large and only needed on a game page that supports mods, so they load on demand.
const GameModsContent = lazy(() => import("./GameModsContent").then((m) => ({ default: m.GameModsContent })));

type Props = { piko: Piko; tofu: Tofu; onUpdate: (patch: Partial<Tofu>) => void };

export function GameMods(props: Props) {
  if (modSupportOf(props.piko) === "none") return null;
  return <Suspense fallback={null}><GameModsContent {...props} /></Suspense>;
}
