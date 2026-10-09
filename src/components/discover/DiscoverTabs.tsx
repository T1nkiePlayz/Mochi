import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { GameAvatar } from "./GameAvatar";

export type DiscoverTabItem = { id: string; label: string; iconUrl?: string; icon?: ReactNode; hint?: string };

type Props = { tabs: DiscoverTabItem[]; active: string; onSelect: (id: string) => void; onAdd?: () => void; label?: string };

/**
 * The game strip. Every tab always shows its icon and its name at a fixed height, so nothing changes size on hover or focus
 * (no reflow, no jumping). Arrow keys, Home and End move between tabs; the selected one is the only tab stop.
 */
export function DiscoverTabs({ tabs, active, onSelect, onAdd, label = "Game discovery" }: Props) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { root.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" }); }, [active]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const keys = ["ArrowRight", "ArrowLeft", "Home", "End"];
    if (!keys.includes(event.key)) return;
    const index = Math.max(0, tabs.findIndex((tab) => tab.id === active));
    const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    event.preventDefault();
    onSelect(tabs[next].id);
    window.requestAnimationFrame(() => root.current?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus());
  };

  return <div className="discover-game-strip">
    <div ref={root} className="discover-game-tabs" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {tabs.map((tab) => {
        const selected = tab.id === active;
        return <button key={tab.id} type="button" role="tab" id={`discover-tab-${tab.id}`} aria-selected={selected} tabIndex={selected ? 0 : -1} title={tab.hint ?? tab.label} className={selected ? "discover-game-tab active" : "discover-game-tab"} onClick={() => onSelect(tab.id)}>
          {tab.icon ? <span className="game-avatar game-avatar-glyph" aria-hidden="true">{tab.icon}</span> : <GameAvatar src={tab.iconUrl} name={tab.label} />}
          <span className="discover-game-name">{tab.label}</span>
        </button>;
      })}
    </div>
    {onAdd && <button className="discover-game-add" type="button" title="Add a game" aria-label="Add a game" onClick={onAdd}><Plus size={17} aria-hidden="true" /><span>Add game</span></button>}
  </div>;
}
