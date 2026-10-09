import { useEffect, useMemo, useRef, useState } from "react";
import { applyTofuMods, writeTofuManifest } from "../../lib/mods/instances";
import { manifestRequestFor, modSyncFor, tofusSharing } from "../../lib/mods/targets";
import { describeModSync } from "../../lib/nativeEvents";
import type { Piko, Tofu } from "../../models";
import { useApp } from "../../state/AppContext";

/** The Tofu last shown per game this session, so an explicit switch can be told apart from simply opening the page. */
const lastShown = new Map<string, string>();

/**
 * Tofu switching on a game page. When the user switches to another Tofu and the game is not running, that Tofu's mods are
 * applied at once (shared folder: its mods on, the other Tofus' off; own store: copied in), exactly as at launch. Also keeps
 * `<game folder>/.mochi/tofus.json` current after the folder changes (`changeKey`). Returns the ids of the Tofus sharing the folder.
 */
export function useTofuSwitch(piko: Piko, tofu: Tofu, changeKey: string, onApplied: () => void) {
  const { sessions } = useApp();
  const [message, setMessage] = useState("");
  const siblings = useMemo(() => tofusSharing(piko.tofus, tofu).map((other) => other.id), [piko.tofus, tofu]);
  const latest = useRef({ piko, tofu, onApplied });
  latest.current = { piko, tofu, onApplied };
  const running = sessions.isRunning(piko.id);

  useEffect(() => {
    const previous = lastShown.get(piko.id);
    lastShown.set(piko.id, tofu.id);
    if (!previous || previous === tofu.id) return;
    const request = modSyncFor(tofu, piko.tofus);
    if (!request) return;
    if (running) { setMessage(`${piko.name} is running. ${tofu.name}'s mods will be applied the next time you launch it.`); return; }
    let live = true;
    void applyTofuMods(request).then((report) => {
      if (!live) return;
      setMessage(describeModSync({ tofuId: tofu.id, report }, tofu.name)?.message ?? `${tofu.name}'s mods are active.`);
      latest.current.onApplied();
    }).catch((error) => { if (live) setMessage(error instanceof Error ? error.message : String(error)); });
    return () => { live = false; };
  }, [piko.id, tofu.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Save the Tofu list into the game folder a moment after anything changed there (downloads, toggles, a new Tofu).
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const request = manifestRequestFor(latest.current.tofu, latest.current.piko.tofus);
      if (request) void writeTofuManifest(request).catch(() => undefined);
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [changeKey, siblings.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  return { siblings, message };
}
