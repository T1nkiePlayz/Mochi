import { useRef, useState } from "react";
import { useTranslation } from "../../lib/useTranslation";
import { MonitorUp } from "lucide-react";
import { shortcutMenuItems, type ShortcutMenuItem, type ShortcutTargets } from "../../lib/shortcuts";
import { useDismiss } from "./useDismiss";

type Props = {
  loadTargets: () => Promise<ShortcutTargets>;
  onLocation: (location: string) => void;
  onSteam: (userId: string) => void;
};

/** "Shortcuts" popover on the game page: desktop / app-menu launchers and Add to Steam. */
export function ShortcutMenu({ loadTargets, onLocation, onSteam }: Props) {
  const t = useTranslation();
  const [open, setOpen] = useState(false);
  const [targets, setTargets] = useState<ShortcutTargets | null>(null);
  const [failed, setFailed] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  useDismiss(anchor, open, () => setOpen(false));
  // Looked up on every open: Steam may have been started or an account added since last time.
  const toggle = () => {
    if (open) { setOpen(false); return; }
    setOpen(true);
    setFailed(false);
    loadTargets().then(setTargets).catch(() => setFailed(true));
  };
  const items = shortcutMenuItems(targets);
  const run = (item: ShortcutMenuItem) => { setOpen(false); if (item.kind === "location") onLocation(item.location); else onSteam(item.userId); };
  return <div className="details-popover-anchor" ref={anchor}>
    <button type="button" className="secondary-button" aria-haspopup="menu" aria-expanded={open} onClick={toggle}><MonitorUp size={14}/> Shortcuts…</button>
    {open && <div className="library-popover"><div className="collection-picker">
      {items.length ? <ul role="menu" aria-label={t("Shortcuts")}>{items.map((item) => <li key={item.key} role="none"><button type="button" role="menuitem" title={item.hint} onClick={() => run(item)}><span>{item.label}</span></button></li>)}</ul>
        : <p className="metadata-note" role="status">{failed ? "Could not look up shortcut locations." : targets ? "No shortcut locations found." : "Looking…"}</p>}
      {targets && !targets.steamUsers.length && <p className="metadata-note">Steam was not found, so Add to Steam is unavailable.</p>}
    </div></div>}
  </div>;
}
