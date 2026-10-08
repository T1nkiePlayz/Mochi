import { useEffect, useRef, useState } from "react";
import { Delete } from "lucide-react";
import { subscribeActions } from "./manager";
import { Prompt } from "./glyphs";

type Props = {
  initial?: string;
  label?: string;
  password?: boolean;
  onChange?: (value: string) => void;
  onSubmit: (value: string) => void;
  onCancel: () => void;
};

const LETTERS = ["1234567890", "qwertyuiop", "asdfghjkl'", "zxcvbnm,.-"];
const SYMBOLS = ["1234567890", "!@#$%^&*()", "~`_=+[]{}\\", "|;:\"<>/?€£"];

/**
 * Built-in keyboard for controller and touch use. It is plain focusable buttons, so the normal
 * spatial navigation moves around it; Y inserts a space, X deletes, R1 toggles shift, Start submits.
 */
export function OnScreenKeyboard({ initial = "", label, password, onChange, onSubmit, onCancel }: Props) {
  const [text, setText] = useState(initial);
  const [shift, setShift] = useState(false);
  const [symbols, setSymbols] = useState(false);
  const textRef = useRef(text);
  const root = useRef<HTMLDivElement>(null);

  const update = (next: string) => { textRef.current = next; setText(next); onChange?.(next); };
  const type = (char: string) => { update(textRef.current + (shift && !symbols ? char.toUpperCase() : char)); if (shift) setShift(false); };
  const backspace = () => update(Array.from(textRef.current).slice(0, -1).join(""));
  const submit = () => onSubmit(textRef.current);

  useEffect(() => { root.current?.querySelector<HTMLElement>("[data-nav-default]")?.focus({ preventScroll: true }); }, []);

  useEffect(() => subscribeActions((event) => {
    switch (event.action) {
      case "back": onCancel(); return true;
      case "x": backspace(); return true;
      case "y": update(`${textRef.current} `); return true;
      case "tabNext": setShift((value) => !value); return true;
      case "tabPrev": setSymbols((value) => !value); return true;
      case "menu": submit(); return true;
      default: return false;
    }
  }, 100));

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.isTrusted || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "Escape") { event.preventDefault(); onCancel(); }
      else if (event.key === "Enter") { event.preventDefault(); submit(); }
      else if (event.key === "Backspace") { event.preventDefault(); backspace(); }
      else if (event.key.length === 1) { event.preventDefault(); update(textRef.current + event.key); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const rows = symbols ? SYMBOLS : LETTERS;
  const shown = password ? "•".repeat(Array.from(text).length) : text;
  return <div className="osk-backdrop" data-nav-scope>
    <div className="osk" ref={root} role="dialog" aria-modal="true" aria-label={label ? `On-screen keyboard: ${label}` : "On-screen keyboard"}>
      <div className="osk-display" aria-live="polite">
        {label && <span className="osk-label">{label}</span>}
        <div className="osk-text">{shown}<span className="osk-caret" aria-hidden="true" /></div>
      </div>
      <div className="osk-keys">
        {rows.map((row, rowIndex) => <div className="osk-row" key={row}>
          {Array.from(row).map((char) => {
            const shown = shift && !symbols ? char.toUpperCase() : char;
            return <button type="button" className="osk-key" key={char} onClick={() => type(char)} data-nav-default={rowIndex === 1 && char === "q" ? "" : undefined} aria-label={shown}>{shown}</button>;
          })}
        </div>)}
        <div className="osk-row">
          <button type="button" className={`osk-key osk-wide ${shift ? "active" : ""}`} aria-pressed={shift} onClick={() => setShift(!shift)}>Shift</button>
          <button type="button" className={`osk-key osk-wide ${symbols ? "active" : ""}`} aria-pressed={symbols} onClick={() => setSymbols(!symbols)}>{symbols ? "ABC" : "123"}</button>
          <button type="button" className="osk-key osk-space" onClick={() => update(`${textRef.current} `)} aria-label="Space">Space</button>
          <button type="button" className="osk-key osk-wide" onClick={backspace} aria-label="Backspace"><Delete size={20} aria-hidden="true" /></button>
          <button type="button" className="osk-key osk-wide" onClick={onCancel}>Cancel</button>
          <button type="button" className="osk-key osk-wide osk-done" onClick={submit}>Done</button>
        </div>
      </div>
      <div className="osk-legend" aria-hidden="true">
        <span><Prompt action="confirm" /> Type</span><span><Prompt action="x" /> Delete</span><span><Prompt action="y" /> Space</span>
        <span><Prompt action="tabNext" /> Shift</span><span><Prompt action="tabPrev" /> 123</span><span><Prompt action="menu" /> Done</span><span><Prompt action="back" /> Cancel</span>
      </div>
    </div>
  </div>;
}
