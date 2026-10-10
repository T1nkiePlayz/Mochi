import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { Piko } from "../models";
import { parseCliPayload, resolveGame, type CliIntent } from "../lib/cliIntent";

declare global { interface Window { __MOCHI_CLI__?: unknown } }

export type CliChoice = CliIntent & { matches: Piko[] };

type Options = {
  ready: boolean;
  library: readonly Piko[];
  /** Starts the game through the normal launch path (tracking, launch options, mod sync). */
  launch: (piko: Piko) => void;
  /** Shows the game's page; never starts anything. */
  open: (piko: Piko) => void;
  report: (message: string) => void;
};

let bootHandled = false;

/**
 * `mochi launch|open <game>` and mochi://launch|open links. The game must be in the library (an id, or a name
 * that matches); several matches open a chooser. Intents that arrive before the library has loaded wait for it.
 */
export function useCliIntents({ ready, library, launch, open, report }: Options) {
  const [choice, setChoice] = useState<CliChoice | null>(null);
  const latest = useRef({ ready, library, launch, open, report });
  latest.current = { ready, library, launch, open, report };
  const pending = useRef<CliIntent[]>([]);

  const run = useCallback((intent: CliIntent) => {
    const { library: games, launch: start, open: show, report: say } = latest.current;
    const act = (piko: Piko) => (intent.kind === "launch" ? start(piko) : show(piko));
    const result = resolveGame(games, intent.query);
    if (result.status === "one") act(result.game);
    else if (result.status === "many") setChoice({ ...intent, matches: result.matches });
    else say(`No game in your Mochi library matches "${intent.query}".`);
  }, []);

  const handle = useCallback((intent: CliIntent) => {
    if (!latest.current.ready) { pending.current.push(intent); return; }
    run(intent);
  }, [run]);

  useEffect(() => {
    if (!ready || !pending.current.length) return;
    const waiting = pending.current;
    pending.current = [];
    waiting.forEach(run);
  }, [ready, run]);

  useEffect(() => {
    // The first start (`mochi launch x` with Mochi closed) hands its command over through the boot script.
    if (!bootHandled) {
      bootHandled = true;
      const boot = parseCliPayload(window.__MOCHI_CLI__);
      delete window.__MOCHI_CLI__;
      if (boot) handle(boot);
    }
    if (!("__TAURI_INTERNALS__" in window)) return;
    let off: (() => void) | undefined;
    let disposed = false;
    void listen<unknown>("cli-intent", (event) => {
      const intent = parseCliPayload(event.payload);
      if (intent) handle(intent);
    }).then((unlisten) => { if (disposed) unlisten(); else off = unlisten; }).catch(() => {});
    return () => { disposed = true; off?.(); };
  }, [handle]);

  const pick = (piko: Piko) => {
    const current = choice;
    setChoice(null);
    if (!current) return;
    if (current.kind === "launch") latest.current.launch(piko); else latest.current.open(piko);
  };

  return { choice, handle, pick, closeChoice: () => setChoice(null) };
}
