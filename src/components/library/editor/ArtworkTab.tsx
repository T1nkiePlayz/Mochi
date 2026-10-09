import { GameArtwork } from "../../GameArtwork";
import { ArtworkPicker } from "../../artwork/ArtworkPicker";
import type { EditorContext } from "./types";

export function ArtworkTab({ ctx }: { ctx: EditorContext }) {
  const { draft, artwork, setArtwork, artworkReset, setArtworkReset } = ctx;
  const custom = draft.artworkSource === "custom" || draft.lockedFields?.includes("artwork");
  return <div className="editor-fields">
    <p className="modal-description">Pick any image: a file, drag-and-drop, paste, a link or an online search. No API key is needed. Your cover is cropped to 3:4 and kept when metadata refreshes.</p>
    <ArtworkPicker gameName={draft.name} onChange={(selection) => { setArtwork(selection); if (selection) setArtworkReset(false); }}
      current={!artworkReset ? <GameArtwork className="artwork-current-cover" cacheKey={draft.artworkCacheKey} fallback={draft.artwork} name={draft.name} kind={draft.kind} sourceId={draft.sourceId} /> : null} />
    {(custom || artworkReset) && !artwork && <div className="editor-locked metadata-note">
      {artworkReset ? "The cover will go back to automatic when you save. " : "This cover was set by you. "}
      <button type="button" className="text-button" onClick={() => setArtworkReset(!artworkReset)}>{artworkReset ? "Undo" : "Reset to automatic"}</button>
    </div>}
  </div>;
}
