import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { useTranslation } from "../../lib/useTranslation";
import { useApp } from "../../state/AppContext";
import { applyNewPaths, matchMissingGames, scanInstalledGames, type RemapMatch } from "../../lib/pathRemap";
import { closePathReview, getMissing, usePathReviewOpen } from "../../lib/pathRemapStore";

/** Mounted once: the "Fix missing paths" review sheet (Settings > Data and the command palette open it). */
export function PathRemapHost() {
  return usePathReviewOpen() ? <PathRemapDialog /> : null;
}

function PathRemapDialog() {
  const t = useTranslation();
  const { lib } = useApp();
  const [state, setState] = useState<{ status: "scanning" } | { status: "done"; matches: RemapMatch[]; unmatched: number }>({ status: "scanning" });
  const close = useRef<HTMLButtonElement>(null);
  const libraryRef = useRef(lib.library);
  libraryRef.current = lib.library;

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    close.current?.focus();
    return () => { if (opener?.isConnected) opener.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => {
    let cancelled = false;
    const missingGames = libraryRef.current.filter((piko) => getMissing().has(piko.id));
    void scanInstalledGames().catch(() => []).then((scanned) => {
      if (cancelled) return;
      const matches = matchMissingGames(missingGames, scanned);
      setState({ status: "done", matches, unmatched: missingGames.length - matches.length });
    });
    return () => { cancelled = true; };
  }, []);

  const accept = (matches: RemapMatch[]) => {
    const byId = new Map(matches.map((match) => [match.gameId, match]));
    lib.setLibrary((current) => current.map((piko) => {
      const match = byId.get(piko.id);
      const changes = match && applyNewPaths(piko, match.newPaths);
      return changes ? { ...piko, ...changes } : piko;
    }));
    setState((current) => current.status === "done" ? { ...current, matches: current.matches.filter((match) => !byId.has(match.gameId)) } : current);
  };
  const nameOf = (id: string) => lib.library.find((piko) => piko.id === id)?.name ?? id;
  const matches = state.status === "done" ? state.matches : [];
  const sure = matches.filter((match) => match.confidence === "store-id");

  return <div className="modal-backdrop" onClick={closePathReview}>
    <div className="modal duplicates-dialog" role="dialog" aria-modal="true" aria-labelledby="path-remap-title" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); closePathReview(); } }}>
      <div className="modal-header"><div><p className="eyebrow">{t("Library")}</p><h2 id="path-remap-title">{t("Fix missing paths")}</h2></div><button type="button" ref={close} className="icon-button" aria-label={t("Close")} onClick={closePathReview}><X size={17} /></button></div>
      <p className="modal-description">{t("Mochi rescanned your launchers and matched these games. Accept a row to use the new path on this device. Nothing is changed for your other machines.")}</p>
      {state.status === "scanning" && <p className="metadata-note" role="status">{t("Scanning your launchers…")}</p>}
      {state.status === "done" && <>
        <ul className="duplicates-groups">
          {matches.map((match) => <li key={match.gameId} className="duplicates-group">
            <span className="duplicates-member-copy"><strong>{nameOf(match.gameId)}</strong>
              <small>{t(match.confidence === "store-id" ? "Matched by store ID" : "Matched by name only: check it is the right game")}</small>
              <small className="path-text" title={match.newPaths.executablePath ?? match.newPaths.installPath}>{match.newPaths.executablePath ?? match.newPaths.installPath}</small></span>
            <div className="duplicates-actions"><button type="button" className="play-button" aria-label={t("Accept {name}").replace("{name}", nameOf(match.gameId))} onClick={() => accept([match])}>{t("Accept")}</button></div>
          </li>)}
        </ul>
        {!matches.length && <p className="metadata-note" role="status">{t(state.unmatched ? "No more matches were found. Open each remaining game to locate its files by hand." : "No missing paths. Everything is where Mochi expects it.")}</p>}
        {matches.length > 0 && state.unmatched > 0 && <p className="metadata-note">{t("{count} games had no match. Open them to locate their files by hand.").replace("{count}", String(state.unmatched))}</p>}
        <div className="duplicates-actions">
          <button type="button" className="play-button" disabled={!sure.length} onClick={() => accept(sure)}>{t("Accept all store ID matches")}</button>
        </div>
      </>}
    </div>
  </div>;
}
