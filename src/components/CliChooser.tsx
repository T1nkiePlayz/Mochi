import type { Piko } from "../models";
import { ModalShell } from "./mods/ModalShell";

/** Shown when a command-line launch or link matches several games: pick one (Tab / arrows / Enter, Esc cancels). */
export function CliChooser({ kind, query, matches, onPick, onClose }: { kind: "launch" | "open"; query: string; matches: Piko[]; onPick: (piko: Piko) => void; onClose: () => void }) {
  const move = (event: React.KeyboardEvent<HTMLUListElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    event.preventDefault();
    items[(at + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
  };
  return <ModalShell label="Choose a game" className="modal confirm-dialog cli-chooser" onClose={onClose}>
    <div className="confirm-heading"><h2>Which game?</h2></div>
    <p className="modal-description">{`"${query}" matches ${matches.length} games. Choose one to ${kind === "launch" ? "launch" : "open"}.`}</p>
    <ul className="cli-chooser-list" onKeyDown={move} style={{ listStyle: "none", padding: 0, display: "grid", gap: 6, margin: "12px 0" }}>
      {matches.map((piko, index) => <li key={piko.id}><button type="button" className="secondary-button" data-autofocus={index === 0 ? "" : undefined} style={{ width: "100%", textAlign: "left" }} onClick={() => onPick(piko)}>{piko.name}</button></li>)}
    </ul>
    <div className="confirm-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button></div>
  </ModalShell>;
}
