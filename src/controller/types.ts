/** Controller families the UI draws different button prompts for (mirrors `gamepad.rs`). */
export type Family = "xbox" | "playstation" | "switch" | "steam" | "deck" | "generic";

/** Physical buttons named by position, identical to the names the native side emits. */
export type PadButton =
  | "south" | "east" | "west" | "north" | "l1" | "r1" | "l2" | "r2" | "select" | "start" | "guide"
  | "l3" | "r3" | "dpadUp" | "dpadDown" | "dpadLeft" | "dpadRight";

export type PadAxis = "leftX" | "leftY" | "rightX" | "rightY" | "dpadX" | "dpadY";

/** What the UI cares about, independent of the controller layout. */
export type Action =
  | "up" | "down" | "left" | "right"
  | "confirm" | "back" | "menu" | "options"
  | "tabPrev" | "tabNext" | "triggerLeft" | "triggerRight"
  | "x" | "y"
  /** Start + Select held together. */
  | "chord";

export type Direction = "up" | "down" | "left" | "right";

export type PadInfo = {
  /** Stable key: `n<id>` for native pads, `w<index>` for the web Gamepad API. */
  key: string;
  name: string;
  family: Family;
  source: "native" | "web";
  rumble: boolean;
};

/** Where the last input came from; drives prompt glyphs and cursor visibility. */
export type InputDevice = "controller" | "keyboard" | "pointer";

export type ActionEvent = {
  action: Action;
  /** True for auto-repeat while a direction is held. */
  repeat: boolean;
  source: InputDevice;
  family: Family;
};

export type RepeatSpeed = "slow" | "normal" | "fast";
export type PromptStyle = "auto" | "xbox" | "playstation" | "switch" | "deck" | "keyboard";
