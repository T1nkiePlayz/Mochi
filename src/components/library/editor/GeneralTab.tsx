import { normalizeTag } from "../../../lib/library";
import { CollectionPicker } from "../CollectionPicker";
import { TagEditor } from "../TagEditor";
import { applyPikoKindOverride, overrideKeyForPiko, setOverride, type KindOverride } from "../../../lib/launcherOverrides";
import type { EditorContext } from "./types";

const COMMON_CATEGORIES = ["Custom", "Steam", "Heroic", "Lutris", "Bottles", "itch.io", "Flatpak", "Applications", "Emulator"];

export function GeneralTab({ ctx }: { ctx: EditorContext }) {
  const { draft, patch, unlock } = ctx;
  const locked = (field: "name" | "description") => draft.lockedFields?.includes(field);
  const kind: KindOverride = draft.kind === "launcher" ? "launcher" : "game";
  // Saved as a persistent correction so the next scan and every library load agree with the user.
  const setKind = (next: KindOverride) => {
    if (next === kind) return;
    const key = overrideKeyForPiko(draft);
    setOverride(key, next);
    const { kind: k, launcherId, platformCategory, categories, artwork, trailerId } = applyPikoKindOverride(draft, { [key]: next });
    patch({ kind: k, launcherId, platformCategory, categories, artwork, trailerId });
  };
  return <div className="form-fields editor-fields">
    <label>Game name
      <input value={draft.name} onChange={(event) => patch({ name: event.target.value }, "name")} required autoFocus />
    </label>
    {locked("name") && <p className="metadata-note editor-locked">Edited by you, so automatic updates keep it. <button type="button" className="text-button" onClick={() => unlock("name")}>Reset to automatic</button></p>}
    <label>Description
      <textarea rows={4} value={draft.description} onChange={(event) => patch({ description: event.target.value }, "description")} />
    </label>
    {locked("description") && <p className="metadata-note editor-locked">Edited by you. <button type="button" className="text-button" onClick={() => unlock("description")}>Reset to automatic</button></p>}
    <div className="editor-field"><span className="editor-field-label" id="editor-kind-label">Type</span>
      <div className="a11y-segmented" role="group" aria-labelledby="editor-kind-label">
        {(["game", "launcher"] as const).map((option) => <button type="button" key={option} aria-pressed={kind === option} onClick={() => setKind(option)}>{option === "game" ? "Game" : "Launcher"}</button>)}
      </div>
      <p className="metadata-note">Wrong detection? Choose what this really is. Mochi remembers your choice.</p>
    </div>
    <label>Platform category
      <input value={draft.platformCategory ?? ""} onChange={(event) => patch({ platformCategory: event.target.value || undefined })} placeholder="e.g. Steam, Heroic, Custom" maxLength={40} />
    </label>
    <div className="editor-suggestions" role="group" aria-label="Common categories">{COMMON_CATEGORIES.map((category) => <button type="button" key={category} className={`filter-chip ${draft.platformCategory === category ? "active" : ""}`} aria-pressed={draft.platformCategory === category} onClick={() => patch({ platformCategory: category })}>{category}</button>)}</div>
    <div className="editor-field"><span className="editor-field-label">Tags</span>
      <TagEditor tags={draft.tags ?? []} suggestions={ctx.tagSuggestions} onChange={(tags) => patch({ tags: tags.map(normalizeTag).filter(Boolean) })} />
    </div>
    <div className="editor-field"><span className="editor-field-label">Collections</span>
      <CollectionPicker collections={ctx.collections} games={[draft]} onCreate={ctx.createCollection}
        onToggle={(id, on) => patch({ collectionIds: on ? [...new Set([...(draft.collectionIds ?? []), id])] : (draft.collectionIds ?? []).filter((item) => item !== id) })} />
    </div>
  </div>;
}
