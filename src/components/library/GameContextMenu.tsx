import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { FolderOpen, FolderPlus, Heart, Pencil, Play, Trash2 } from "lucide-react";
import type { Collection, Piko } from "../../models";
import { CollectionPicker } from "./CollectionPicker";
import { useDismiss } from "./useDismiss";

type Props = {
  game: Piko;
  x: number;
  y: number;
  collections: Collection[];
  canOpenFolder: boolean;
  onClose: () => void;
  onPlay: () => void;
  onFavorite: () => void;
  onToggleCollection: (collectionId: string, on: boolean) => void;
  onCreateCollection: (name: string) => Collection | null;
  onEdit: () => void;
  onOpenFolder: () => void;
  onRemove: () => void;
};

/** Right-click / long-press / menu-key menu for a game card. */
export function GameContextMenu({ game, x, y, collections, canOpenFolder, onClose, onPlay, onFavorite, onToggleCollection, onCreateCollection, onEdit, onOpenFolder, onRemove }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<"menu" | "collections">("menu");
  const [position, setPosition] = useState({ x, y });
  const close = useCallback(onClose, [onClose]);
  useDismiss(ref, true, close);

  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    if (box) setPosition({ x: Math.max(8, Math.min(x, window.innerWidth - box.width - 8)), y: Math.max(8, Math.min(y, window.innerHeight - box.height - 8)) });
  }, [x, y, view]);
  useEffect(() => { ref.current?.querySelector<HTMLElement>("button")?.focus(); }, [view]);

  const run = (action: () => void) => () => { onClose(); action(); };
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>("button:not(:disabled)") ?? []);
    const index = items.indexOf(document.activeElement as HTMLElement);
    items[(index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
  };

  return <div ref={ref} className="game-context-menu" role="menu" aria-label={`Actions for ${game.name}`} style={{ left: position.x, top: position.y }} onKeyDown={onKeyDown} onContextMenu={(event) => event.preventDefault()}>
    {view === "menu" ? <>
      <button type="button" role="menuitem" onClick={run(onPlay)}><Play size={14} /> Play</button>
      <button type="button" role="menuitem" onClick={run(onFavorite)}><Heart size={14} fill={game.favorite ? "currentColor" : "none"} /> {game.favorite ? "Remove from favourites" : "Add to favourites"}</button>
      <button type="button" role="menuitem" aria-haspopup="true" onClick={() => setView("collections")}><FolderPlus size={14} /> Add to collection…</button>
      <button type="button" role="menuitem" onClick={run(onEdit)}><Pencil size={14} /> Edit</button>
      {canOpenFolder && <button type="button" role="menuitem" onClick={run(onOpenFolder)}><FolderOpen size={14} /> Open folder</button>}
      <button type="button" role="menuitem" className="danger" onClick={run(onRemove)}><Trash2 size={14} /> Remove</button>
    </> : <>
      <button type="button" role="menuitem" onClick={() => setView("menu")}>← Back</button>
      <CollectionPicker collections={collections} games={[game]} onToggle={onToggleCollection} onCreate={onCreateCollection} />
    </>}
  </div>;
}
