import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { normalizeTag } from "../../lib/library";

type Props = { tags: string[]; suggestions: string[]; onChange: (tags: string[]) => void; label?: string };

/** Chip input with autocomplete from tags already used in the library. */
export function TagEditor({ tags, suggestions, onChange, label = "Tags" }: Props) {
  const [text, setText] = useState("");
  const [active, setActive] = useState(-1);
  const [focused, setFocused] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const has = (tag: string) => tags.some((item) => item.toLowerCase() === tag.toLowerCase());

  const matches = useMemo(() => {
    const needle = text.trim().toLowerCase();
    return suggestions.filter((tag) => !has(tag) && (!needle || tag.toLowerCase().includes(needle))).slice(0, 6);
  }, [suggestions, tags, text]); // eslint-disable-line react-hooks/exhaustive-deps

  const add = (value: string) => {
    const tag = normalizeTag(value);
    setText(""); setActive(-1);
    if (tag && !has(tag)) onChange([...tags, tag]);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === ",") { event.preventDefault(); add(active >= 0 && matches[active] ? matches[active] : text); }
    else if (event.key === "Backspace" && !text && tags.length) onChange(tags.slice(0, -1));
    else if (event.key === "ArrowDown") { event.preventDefault(); setActive((value) => Math.min(matches.length - 1, value + 1)); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActive((value) => Math.max(-1, value - 1)); }
    else if (event.key === "Escape" && matches.length && active >= 0) { event.stopPropagation(); setActive(-1); }
  };

  return <div className="tag-editor">
    <div className="tag-editor-box" onClick={() => input.current?.focus()}>
      {tags.map((tag) => <span className="tag-chip" key={tag}>{tag}<button type="button" aria-label={`Remove tag ${tag}`} onClick={() => onChange(tags.filter((item) => item !== tag))}><X size={11} /></button></span>)}
      <input ref={input} value={text} aria-label={label} placeholder={tags.length ? "" : "Add a tag…"} role="combobox" aria-expanded={focused && matches.length > 0} aria-controls={listId} aria-autocomplete="list"
        onChange={(event) => { setText(event.target.value); setActive(-1); }} onKeyDown={onKeyDown} onFocus={() => setFocused(true)} onBlur={() => { setFocused(false); if (text.trim()) add(text); }} />
    </div>
    {focused && matches.length > 0 && <ul className="tag-suggestions" id={listId} role="listbox" aria-label="Tag suggestions">
      {matches.map((tag, index) => <li key={tag} role="option" aria-selected={index === active} className={index === active ? "active" : ""} onMouseDown={(event) => { event.preventDefault(); add(tag); }}>{tag}</li>)}
    </ul>}
  </div>;
}
