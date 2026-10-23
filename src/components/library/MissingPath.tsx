import { useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { AlertTriangle } from "lucide-react";
import type { Piko } from "../../models";
import { useTranslation } from "../../lib/useTranslation";
import { useApp } from "../../state/AppContext";
import { applyLocated, applyNewPaths, matchMissingGames, scanInstalledGames, slotWantsFile, type PathField, type PathSlot, type RemapMatch } from "../../lib/pathRemap";
import { useMissingSlots } from "../../lib/pathRemapStore";

const FIELD_LABELS: Record<PathField, string> = {
  executablePath: "Executable", installPath: "Install folder", workingDir: "Working directory", tofuPath: "Mod folder",
  tofuGameDir: "Game folder", tofuContentRoot: "Content folder", tofuInstallPath: "Instance folder",
};
export const fieldLabel = (field: PathField) => FIELD_LABELS[field];

/** Small flag on a game card: the game's files are not on this device. */
export function MissingPathBadge({ gameId }: { gameId: string }) {
  const t = useTranslation();
  const slots = useMissingSlots(gameId);
  if (!slots.length) return null;
  return <span className="missing-path-badge" title={t("Some of this game's saved paths do not exist on this device. Open the game to fix them.")}><AlertTriangle size={11} aria-hidden="true" /> {t("Missing on this device")}</span>;
}

/** On the game page: lists the missing paths with "Locate..." for each and "Find automatically" (rescan, then confirm the proposal). */
export function MissingPathNotice({ game }: { game: Piko }) {
  const t = useTranslation();
  const { lib } = useApp();
  const slots = useMissingSlots(game.id);
  const [scanning, setScanning] = useState(false);
  const [found, setFound] = useState<RemapMatch | "none" | null>(null);
  if (!slots.length) return null;

  const locate = async (slot: PathSlot) => {
    const file = slotWantsFile(slot);
    const picked = await openDialog({ title: t(file ? "Choose the game's executable" : "Choose the folder"), directory: !file, multiple: false }).catch(() => null);
    if (typeof picked !== "string" || !picked) return;
    const changes = applyLocated(game, slot, picked);
    if (changes) lib.updateGame(game.id, changes);
  };
  const find = async () => {
    setScanning(true); setFound(null);
    try { setFound(matchMissingGames([game], await scanInstalledGames())[0] ?? "none"); } catch { setFound("none"); } finally { setScanning(false); }
  };
  const accept = (match: RemapMatch) => { const changes = applyNewPaths(game, match.newPaths); if (changes) lib.updateGame(game.id, changes); setFound(null); };

  return <section className="missing-path-notice" role="status" aria-label={t("Missing on this device")}>
    <p><AlertTriangle size={16} aria-hidden="true" /> <strong>{t("Missing on this device")}</strong> {t("These saved paths do not exist here. Locate them, or let Mochi look for the game in your launchers. The fix is kept on this device only.")}</p>
    <ul>{slots.map((slot) => <li key={`${slot.tofuId ?? ""}:${slot.field}`}><span><small>{t(FIELD_LABELS[slot.field])}</small><span className="path-text" title={slot.path}>{slot.path}</span></span>
      <button type="button" className="secondary-button" onClick={() => void locate(slot)}>{t("Locate...")}</button></li>)}</ul>
    <div className="missing-path-actions"><button type="button" className="secondary-button" disabled={scanning} onClick={() => void find()}>{scanning ? t("Scanning your launchers…") : t("Find automatically")}</button></div>
    {found === "none" && <p className="metadata-note">{t("No match was found in your installed launchers. Use Locate... instead.")}</p>}
    {found && found !== "none" && <div className="missing-path-proposal">
      <span><strong>{found.matched.name}</strong><small>{t(found.confidence === "store-id" ? "Matched by store ID" : "Matched by name only: check it is the right game")}</small>
        <span className="path-text">{found.newPaths.executablePath ?? found.newPaths.installPath}</span></span>
      <button type="button" className="play-button" onClick={() => accept(found)}>{t("Use this path")}</button>
      <button type="button" className="secondary-button" onClick={() => setFound(null)}>{t("Dismiss")}</button>
    </div>}
  </section>;
}
