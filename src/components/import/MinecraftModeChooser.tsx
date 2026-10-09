import type { MinecraftMode } from "../../lib/minecraftCopy";

const options: Array<{ id: MinecraftMode; title: string; text: string }> = [
  { id: "copy", title: "Copy instances (recommended)", text: "Mochi makes its own copy of each selected instance; your originals are never changed." },
  { id: "in-place", title: "Use existing instances in place", text: "Mochi manages mods directly in your current instances." },
];

/** The one choice for every selected Minecraft instance: import a copy, or work on the originals. */
export function MinecraftModeChooser({ value, onChange }: { value: MinecraftMode; onChange: (mode: MinecraftMode) => void }) {
  return (
    <div className="sgp-mcmode" role="radiogroup" aria-label="How to import Minecraft instances">
      {options.map((option) => (
        <label key={option.id} className={"sgp-mcmode-option" + (value === option.id ? " selected" : "")}>
          <input type="radio" name="minecraft-mode" checked={value === option.id} onChange={() => onChange(option.id)} />
          <span><strong>{option.title}</strong><small>{option.text}</small></span>
        </label>
      ))}
    </div>
  );
}
