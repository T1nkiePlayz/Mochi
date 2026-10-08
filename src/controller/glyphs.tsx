import { actionToButton } from "./mapping";
import { useControllerSettings } from "./settings";
import { useControllerState } from "./manager";
import type { Action, Family, PadButton, PromptStyle } from "./types";

type Layout = Exclude<PromptStyle, "auto" | "keyboard">;

const FACE: Record<Layout, Record<"south" | "east" | "west" | "north", string>> = {
  xbox: { south: "A", east: "B", west: "X", north: "Y" },
  deck: { south: "A", east: "B", west: "X", north: "Y" },
  playstation: { south: "✕", east: "○", west: "□", north: "△" },
  switch: { south: "B", east: "A", west: "Y", north: "X" },
};

const OTHER: Record<Layout, Partial<Record<PadButton, string>>> = {
  xbox: { l1: "LB", r1: "RB", l2: "LT", r2: "RT", start: "Menu", select: "View", l3: "LS", r3: "RS" },
  deck: { l1: "L1", r1: "R1", l2: "L2", r2: "R2", start: "Menu", select: "View", l3: "L3", r3: "R3" },
  playstation: { l1: "L1", r1: "R1", l2: "L2", r2: "R2", start: "Options", select: "Create", l3: "L3", r3: "R3" },
  switch: { l1: "L", r1: "R", l2: "ZL", r2: "ZR", start: "+", select: "−", l3: "LS", r3: "RS" },
};

const KEYBOARD: Partial<Record<Action, string>> = {
  up: "↑", down: "↓", left: "←", right: "→", confirm: "Enter", back: "Esc", menu: "M", options: "/",
  tabPrev: "Q", tabNext: "E", triggerLeft: "PgUp", triggerRight: "PgDn", x: "X", y: "Y",
};

const DPAD: Record<string, string> = { dpadUp: "↑", dpadDown: "↓", dpadLeft: "←", dpadRight: "→" };

/** Which button layout to draw for a controller family. */
export function layoutForFamily(family: Family): Layout {
  return family === "steam" || family === "generic" ? "xbox" : family;
}

export type Glyph = { label: string; kind: "face" | "shoulder" | "pill" | "key"; button?: PadButton };

/** The label for an action under a given style. Pure so it can be tested and reused outside React. */
export function glyphFor(action: Action, family: Family, style: PromptStyle, swap: boolean, device: "controller" | "keyboard" | "pointer"): Glyph {
  const useKeyboard = style === "keyboard" || (style === "auto" && device !== "controller");
  if (useKeyboard) return { label: KEYBOARD[action] ?? action, kind: "key" };
  const layout: Layout = style === "auto" ? layoutForFamily(family) : style;
  // Swapping and the Nintendo layout depend on the real controller; a forced style only changes the glyphs.
  const button = actionToButton(action, style === "auto" ? family : layout === "switch" ? "switch" : "xbox", swap);
  if (!button) return { label: action, kind: "pill" };
  if (button === "south" || button === "east" || button === "west" || button === "north") return { label: FACE[layout][button], kind: "face", button };
  if (DPAD[button]) return { label: DPAD[button], kind: "pill", button };
  const label = OTHER[layout][button] ?? button;
  return { label, kind: button === "l1" || button === "r1" || button === "l2" || button === "r2" ? "shoulder" : "pill", button };
}

export function useGlyph(action: Action): Glyph {
  const [settings] = useControllerSettings();
  const { family, device } = useControllerState();
  return glyphFor(action, family, settings.promptStyle, settings.swapConfirmBack, device);
}

/** A single button prompt, drawn in the style of the connected controller. */
export function Prompt({ action }: { action: Action }) {
  const glyph = useGlyph(action);
  const [settings] = useControllerSettings();
  const { family } = useControllerState();
  const layout = settings.promptStyle === "auto" || settings.promptStyle === "keyboard" ? layoutForFamily(family) : settings.promptStyle;
  return <kbd className={`prompt-glyph prompt-${glyph.kind}`} data-button={glyph.button} data-layout={layout} aria-hidden="true">{glyph.label}</kbd>;
}
