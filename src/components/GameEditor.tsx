import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "../lib/useTranslation";
import { X } from "lucide-react";
import { supabase } from "../lib/supabase";
import { lookupIgdbGames } from "../lib/igdb";
import { applyIgdbMetadata, sanitizeKey } from "../lib/metadata";
import { deleteGameArtwork, saveCustomArtwork } from "../lib/artwork";
import { tagCounts } from "../lib/library";
import type { PlatformCapabilities } from "../lib/platform";
import type { Piko } from "../models";
import { useApp } from "../state/AppContext";
import { cacheArtwork } from "../state/useMetadata";
import type { ArtworkSelection } from "./artwork/ArtworkPicker";
import { ArtworkTab } from "./library/editor/ArtworkTab";
import { GeneralTab } from "./library/editor/GeneralTab";
import { LaunchTab } from "./library/editor/LaunchTab";
import { NotesTab } from "./library/editor/NotesTab";
import { MetadataTab } from "./library/editor/MetadataTab";
import type { EditorContext, LockedField } from "./library/editor/types";

type Props = {
  game: Piko;
  capabilities: PlatformCapabilities | null;
  onSave: (changes: Partial<Piko>) => void;
  onClose: () => void;
};

const tabs = [["general", "General"], ["launch", "Launch"], ["artwork", "Artwork"], ["notes", "Notes"], ["metadata", "Metadata"]] as const;
type TabId = (typeof tabs)[number][0];

export function GameEditor({ game, capabilities, onSave, onClose }: Props) {
  const t = useTranslation();
  const app = useApp();
  const [tab, setTab] = useState<TabId>("general");
  const [draft, setDraft] = useState<Piko>(game);
  // What the editor opened with. Only fields the user changed are saved, so a metadata refresh that landed while the editor was open is not overwritten.
  const baseline = useRef<Piko>(game).current;
  const [artwork, setArtwork] = useState<ArtworkSelection | null>(null);
  const [artworkReset, setArtworkReset] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const allTags = useMemo(() => tagCounts(app.lib.library).map(([tag]) => tag), [app.lib.library]);

  const patch = (changes: Partial<Piko>, lock?: LockedField) => setDraft((current) => ({
    ...current, ...changes,
    lockedFields: lock && !current.lockedFields?.includes(lock) ? [...(current.lockedFields ?? []), lock] : (changes.lockedFields ?? current.lockedFields),
  }));
  const unlock = (field: LockedField) => { setUnlocked(true); setDraft((current) => ({ ...current, lockedFields: current.lockedFields?.filter((item) => item !== field) })); };

  const ctx: EditorContext = {
    game, draft, capabilities, collections: app.collections.collections, tagSuggestions: allTags, patch, unlock,
    createCollection: (name) => app.collections.createCollection(name),
    artwork, setArtwork, artworkReset, setArtworkReset, hasIgdb: app.hasIgdb,
    refreshGame: (app.metadata as { refreshGame?: EditorContext["refreshGame"] }).refreshGame,
  };

  const submit = async () => {
    if (!draft.name.trim()) { setTab("general"); setError("A name is required."); return; }
    if (!draft.executablePath?.trim()) { setTab("launch"); setError("A launch target is required."); return; }
    setSaving(true); setError("");
    try {
      let final: Piko = { ...draft, name: draft.name.trim(), executablePath: draft.executablePath.trim(), installPath: draft.installPath?.trim() || undefined, platformCategory: draft.platformCategory?.trim() || undefined };
      const cacheKey = final.artworkCacheKey || sanitizeKey(final.id);
      if (artwork) {
        await saveCustomArtwork(cacheKey, artwork.source, artwork.crop);
        final = { ...final, artworkCacheKey: cacheKey, artworkSource: "custom", artworkUrl: undefined, artwork: "", lockedFields: [...new Set([...(final.lockedFields ?? []), "artwork" as const])] };
      } else if (artworkReset) {
        await deleteGameArtwork(cacheKey).catch(() => {});
        final = { ...final, artworkSource: undefined, artwork: final.artworkUrl ? final.artwork : "", lockedFields: final.lockedFields?.filter((field) => field !== "artwork") };
        if (!final.artworkUrl) final.artworkCacheKey = undefined;
      }
      // "Reset to automatic" re-applies the saved IGDB match for the fields that were unlocked.
      if (unlocked && final.igdbId && supabase && app.hasIgdb) {
        try {
          const found = await lookupIgdbGames(supabase, final.name);
          const match = found.find((item) => item.id === final.igdbId);
          if (match) final = applyIgdbMetadata(final, match);
        } catch { /* offline: the fields refresh next time metadata runs */ }
      }
      if (final.artworkUrl && final.artworkSource !== "custom" && (final.artworkUrl !== baseline.artworkUrl || artworkReset)) await cacheArtwork(final);
      const changes: Partial<Piko> = {};
      (Object.keys(final) as Array<keyof Piko>).concat(Object.keys(baseline) as Array<keyof Piko>).forEach((key) => {
        if (JSON.stringify(final[key]) !== JSON.stringify(baseline[key])) (changes as Record<string, unknown>)[key] = final[key];
      });
      onSave(changes);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setSaving(false);
    }
  };

  const onTabKey = (event: KeyboardEvent, index: number) => {
    const next = event.key === "ArrowRight" || event.key === "ArrowDown" ? index + 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? index - 1 : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    const target = (next + tabs.length) % tabs.length;
    setTab(tabs[target][0]);
    tabRefs.current[target]?.focus();
  };

  return <div className="modal-backdrop" onClick={onClose}>
    <div className="modal game-editor" role="dialog" aria-modal="true" aria-label={`Edit ${game.name}`} onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => { if (event.key === "Escape" && !event.defaultPrevented) onClose(); }}>
      <div className="modal-header"><div><p className="eyebrow">{t("Library")}</p><h2>{t("Edit game")}</h2></div><button type="button" className="icon-button" aria-label={t("Close")} onClick={onClose}><X size={17} /></button></div>
      <div className="editor-tabs" role="tablist" aria-label={t("Game settings")}>
        {tabs.map(([id, label], index) => <button type="button" key={id} role="tab" id={`editor-tab-${id}`} aria-selected={tab === id} aria-controls={`editor-panel-${id}`} tabIndex={tab === id ? 0 : -1}
          ref={(node) => { tabRefs.current[index] = node; }} className={tab === id ? "active" : ""} onClick={() => setTab(id)} onKeyDown={(event) => onTabKey(event, index)}>{label === "General" ? t("General") : label === "Notes" ? t("Notes") : label}</button>)}
      </div>
      <div className="editor-panel" role="tabpanel" id={`editor-panel-${tab}`} aria-labelledby={`editor-tab-${tab}`}>
        {tab === "general" && <GeneralTab ctx={ctx} />}
        {tab === "launch" && <LaunchTab ctx={ctx} />}
        {tab === "notes" && <NotesTab ctx={ctx} />}
        {tab === "artwork" && <ArtworkTab ctx={ctx} />}
        {tab === "metadata" && <MetadataTab ctx={ctx} />}
      </div>
      {error && <p className="auth-error" role="alert">{error}</p>}
      <div className="editor-footer"><button type="button" className="secondary-button" onClick={onClose}>{t("Cancel")}</button><button className="play-button" type="button" onClick={() => void submit()} disabled={saving}>{saving ? t("Saving…") : t("Save changes")}</button></div>
    </div>
  </div>;
}
