import { useEffect, useState } from "react";
import { X } from "lucide-react";

const OPEN_EVENT = "mochi:open-shortcuts";
/** Opens the keyboard shortcuts dialog (used by the Settings button and the `?` key). */
export const openShortcuts = () => window.dispatchEvent(new Event(OPEN_EVENT));

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);
const MOD = isMac ? "⌘" : "Ctrl";

const groups: Array<{ title: string; items: Array<{ label: string; keys: string[] }> }> = [
  { title: "General", items: [
    { label: "Search your library", keys: [MOD, "K"] },
    { label: "Show this shortcuts list", keys: ["?"] },
    { label: "Skip to main content", keys: ["Tab", "Enter"] },
  ] },
  { title: "Moving around", items: [
    { label: "Next control", keys: ["Tab"] },
    { label: "Previous control", keys: ["Shift", "Tab"] },
    { label: "Activate button or link", keys: ["Enter"] },
    { label: "Toggle a switch or checkbox", keys: ["Space"] },
    { label: "Scroll the page", keys: ["Space"] },
  ] },
  { title: "Dialogs", items: [
    { label: "Close the open dialog", keys: ["Esc"] },
    { label: "Keep focus inside the dialog", keys: ["Tab"] },
  ] },
];

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return Boolean(el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)));
}

export function ShortcutsHelp() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = () => setOpen(true);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "?" && !event.ctrlKey && !event.metaKey && !event.altKey && !isTyping(event.target)) { event.preventDefault(); setOpen((v) => !v); }
    };
    window.addEventListener(OPEN_EVENT, show);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener(OPEN_EVENT, show); window.removeEventListener("keydown", onKey); };
  }, []);
  if (!open) return null;
  const close = () => setOpen(false);
  return <div className="modal-backdrop" onClick={close}>
    <div className="modal shortcuts-modal" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title" onClick={(event) => event.stopPropagation()}>
      <div className="modal-header">
        <div><p className="eyebrow">Keyboard</p><h2 id="shortcuts-title">Keyboard shortcuts</h2></div>
        <button type="button" className="icon-button" aria-label="Close shortcuts" onClick={close}><X size={16} aria-hidden="true" /></button>
      </div>
      <p className="modal-description">Everything in Mochi can be used without a mouse. Press <span className="shortcut-key">?</span> any time to open this list.</p>
      {groups.map((group) => <div key={group.title}>
        <h3 className="shortcuts-group">{group.title}</h3>
        <dl className="shortcuts-list">
          {group.items.map((item) => <div className="shortcut-row" key={item.label}><dt>{item.label}</dt><dd>{item.keys.map((key) => <kbd className="shortcut-key" key={key}>{key}</kbd>)}</dd></div>)}
        </dl>
      </div>)}
    </div>
  </div>;
}
