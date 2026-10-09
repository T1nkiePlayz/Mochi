import { useState, type ReactNode } from "react";
import { Check, ChevronLeft, Download, Gamepad2, LayoutGrid, Library, LogOut, Maximize, Minimize2, Moon, Music, Palette, Power, PowerOff, RotateCcw, Volume1, Volume2, VolumeX } from "lucide-react";
import type { ThemeDescriptor } from "../lib/theme";
import { BUILTIN_PACKS, type SoundSettings } from "../lib/sound";
import type { SoundPackInfo } from "../lib/sound/packs";
import { DISPLAY_OPTIONS, type DisplaySettings } from "./display";
import type { PowerAction, PowerCapabilities } from "./native";

export type MenuView = "closed" | "main" | "themes" | "display" | "sound" | "power";

type Props = {
  view: Exclude<MenuView, "closed">;
  themes: ThemeDescriptor[];
  theme: string;
  sound: SoundSettings;
  soundPacks: SoundPackInfo[];
  display: DisplaySettings;
  power: PowerCapabilities | null;
  macos: boolean;
  /** Window controls do nothing inside gamescope (Steam Gaming Mode), so they are hidden there. */
  windowControls: boolean;
  activeDownloads: number;
  onView: (view: Exclude<MenuView, "closed">) => void;
  onTheme: (id: string) => void;
  onSound: (patch: Partial<SoundSettings>) => void;
  onDisplay: (patch: Partial<DisplaySettings>) => void;
  onLibrary: () => void;
  onDownloads: () => void;
  onControllerSettings: () => void;
  onPower: (action: PowerAction) => void;
  onMinimize: () => void;
  onFullscreen: () => void;
  onExit: () => void;
  onQuit: () => void;
  onClose: () => void;
};

function Item({ icon, label, detail, danger, onClick, selected, navDefault }: { icon: ReactNode; label: string; detail?: string; danger?: boolean; selected?: boolean; navDefault?: boolean; onClick: () => void }) {
  return <button type="button" className={`bp-menu-item ${danger ? "bp-danger" : ""}`} aria-pressed={selected} data-nav-default={navDefault ? "" : undefined} onClick={onClick}>
    <span className="bp-menu-icon" aria-hidden="true">{icon}</span><span className="bp-menu-label">{label}</span>{detail && <small>{detail}</small>}
  </button>;
}

/** A row of mutually exclusive choices that works with a controller (left/right) and a pointer. */
function Choice<T extends string>({ label, value, options, onChange, first }: { label: string; value: T; options: ReadonlyArray<{ value: T; label: string }>; onChange: (value: T) => void; first?: boolean }) {
  return <div className="bp-choice">
    <span className="bp-choice-label" id={`bp-choice-${label}`}>{label}</span>
    <div className="bp-choice-options" role="radiogroup" aria-labelledby={`bp-choice-${label}`}>
      {options.map((option) => <button type="button" role="radio" key={option.value} aria-checked={option.value === value} className="bp-choice-option"
        data-nav-default={first && option.value === value ? "" : undefined} onClick={() => onChange(option.value)}>{option.label}</button>)}
    </div>
  </div>;
}

function Back({ onClick }: { onClick: () => void }) {
  return <button type="button" className="bp-menu-back" onClick={onClick}><ChevronLeft size={20} aria-hidden="true" /> Menu</button>;
}

export function SideMenu(props: Props) {
  // Power actions need a second press so a stray button never suspends, restarts or quits.
  const [armed, setArmed] = useState("");
  const confirmable = (id: string, action: () => void) => () => { if (armed === id) { setArmed(""); action(); } else setArmed(id); };
  const main = () => props.onView("main");
  const { sound, display } = props;
  const volume = Math.round(sound.volume * 100);
  const VolumeIcon = sound.muted || volume === 0 ? VolumeX : volume < 50 ? Volume1 : Volume2;
  const sleepLabel = props.macos ? "Sleep" : "Suspend";

  let body: ReactNode;
  if (props.view === "themes") {
    body = <>
      <Back onClick={main} />
      <h2 className="bp-menu-title">Theme</h2>
      <div className="bp-menu-list" role="radiogroup" aria-label="Theme">
        {props.themes.map((option) => <button type="button" role="radio" aria-checked={option.id === props.theme} className="bp-menu-item" key={option.id} data-nav-default={option.id === props.theme ? "" : undefined} onClick={() => props.onTheme(option.id)}>
          <span className="bp-menu-icon" aria-hidden="true">{option.id === props.theme ? <Check size={22} /> : <Palette size={22} />}</span><span className="bp-menu-label">{option.name}</span>
        </button>)}
      </div>
    </>;
  } else if (props.view === "display") {
    body = <>
      <Back onClick={main} />
      <h2 className="bp-menu-title">Display</h2>
      <div className="bp-menu-list">
        <Choice label="Layout" value={display.layout} options={DISPLAY_OPTIONS.layout} onChange={(layout) => props.onDisplay({ layout })} first />
        <Choice label="Tile shape" value={display.shape} options={DISPLAY_OPTIONS.shape} onChange={(shape) => props.onDisplay({ shape })} />
        <Choice label="Tile size" value={display.size} options={DISPLAY_OPTIONS.size} onChange={(size) => props.onDisplay({ size })} />
        <Choice label="Game titles" value={display.titles} options={DISPLAY_OPTIONS.titles} onChange={(titles) => props.onDisplay({ titles })} />
      </div>
    </>;
  } else if (props.view === "sound") {
    const packs = [{ value: "theme", label: "Match theme" }, ...BUILTIN_PACKS.map((pack) => ({ value: pack.id, label: pack.name })), ...props.soundPacks.map((pack) => ({ value: pack.id, label: pack.name }))];
    body = <>
      <Back onClick={main} />
      <h2 className="bp-menu-title">Sound</h2>
      <div className="bp-menu-list">
        <Item icon={sound.bigPicture ? <Volume2 size={24} /> : <VolumeX size={24} />} label="Interface sounds" detail={sound.bigPicture ? "On" : "Off"} selected={sound.bigPicture} navDefault onClick={() => props.onSound({ bigPicture: !sound.bigPicture })} />
        <Item icon={<VolumeIcon size={24} />} label="Mute" detail={sound.muted ? "Muted" : "Off"} selected={sound.muted} onClick={() => props.onSound({ muted: !sound.muted })} />
        <div className="bp-choice">
          <span className="bp-choice-label" id="bp-volume-label">Volume <strong>{volume}%</strong></span>
          <div className="bp-choice-options" role="group" aria-labelledby="bp-volume-label">
            <button type="button" className="bp-choice-option" aria-label="Volume down" disabled={volume <= 0} onClick={() => props.onSound({ volume: Math.max(0, sound.volume - 0.1), muted: false })}>−</button>
            <span className="bp-volume-meter" role="meter" aria-label="Volume" aria-valuemin={0} aria-valuemax={100} aria-valuenow={volume}><i style={{ width: `${volume}%` }} /></span>
            <button type="button" className="bp-choice-option" aria-label="Volume up" disabled={volume >= 100} onClick={() => props.onSound({ volume: Math.min(1, sound.volume + 0.1), muted: false })}>+</button>
          </div>
        </div>
        <Choice label="Movement sounds" value={sound.movement} options={[{ value: "always", label: "Always" }, { value: "auto", label: "Auto" }, { value: "never", label: "Never" }] as const} onChange={(movement) => props.onSound({ movement })} />
        <div className="bp-menu-subtitle" id="bp-pack-label"><Music size={18} aria-hidden="true" /> Sound pack</div>
        <div className="bp-menu-list" role="radiogroup" aria-labelledby="bp-pack-label">
          {packs.map((pack) => <button type="button" role="radio" key={pack.value} aria-checked={sound.pack === pack.value} className="bp-menu-item" onClick={() => props.onSound({ pack: pack.value })}>
            <span className="bp-menu-icon" aria-hidden="true">{sound.pack === pack.value ? <Check size={22} /> : <Music size={22} />}</span><span className="bp-menu-label">{pack.label}</span>
          </button>)}
        </div>
      </div>
    </>;
  } else if (props.view === "power") {
    const power = props.power;
    body = <>
      <Back onClick={main} />
      <h2 className="bp-menu-title">Power</h2>
      <div className="bp-menu-list">
        {power?.suspend && <Item icon={<Moon size={24} />} label={armed === "suspend" ? `Press again to ${sleepLabel.toLowerCase()}` : sleepLabel} navDefault onClick={confirmable("suspend", () => props.onPower("suspend"))} />}
        {power?.restart && <Item icon={<RotateCcw size={24} />} label={armed === "restart" ? "Press again to restart" : "Restart"} onClick={confirmable("restart", () => props.onPower("restart"))} />}
        {power?.shutdown && <Item icon={<PowerOff size={24} />} label={armed === "shutdown" ? "Press again to shut down" : "Shut down"} danger onClick={confirmable("shutdown", () => props.onPower("shutdown"))} />}
        {props.windowControls && <>
          <Item icon={<Minimize2 size={24} />} label="Minimise Mochi" onClick={props.onMinimize} />
          <Item icon={<Maximize size={24} />} label="Toggle full screen" onClick={props.onFullscreen} />
        </>}
        <Item icon={<LogOut size={24} />} label="Exit Big Picture" navDefault={!power?.suspend} onClick={props.onExit} />
        <Item icon={<Power size={24} />} label={armed === "quit" ? "Press again to quit" : "Quit Mochi"} danger onClick={confirmable("quit", props.onQuit)} />
      </div>
    </>;
  } else {
    body = <>
      <h2 className="bp-menu-title">Menu</h2>
      <div className="bp-menu-list">
        <Item icon={<Library size={24} />} label="Library" detail="Back to the desktop view" onClick={props.onLibrary} />
        <Item icon={<Download size={24} />} label="Downloads" detail={props.activeDownloads ? `${props.activeDownloads} active` : "Nothing active"} onClick={props.onDownloads} />
        <Item icon={<LayoutGrid size={24} />} label="Display" detail="Tiles and layout" onClick={() => props.onView("display")} />
        <Item icon={<Palette size={24} />} label="Theme" onClick={() => props.onView("themes")} />
        <Item icon={<VolumeIcon size={24} />} label="Sound" detail={!sound.bigPicture ? "Off" : sound.muted ? "Muted" : `${volume}%`} onClick={() => props.onView("sound")} />
        <Item icon={<Gamepad2 size={24} />} label="Controller settings" onClick={props.onControllerSettings} />
        <Item icon={<Power size={24} />} label="Power" detail={props.power?.suspend ? `${sleepLabel}, restart, quit` : "Exit and quit"} onClick={() => props.onView("power")} />
        <Item icon={<LogOut size={24} />} label="Exit Big Picture" onClick={props.onExit} />
      </div>
    </>;
  }

  return <div className="bp-menu-backdrop" onClick={props.onClose}>
    <nav className="bp-menu" data-nav-scope aria-label="Big Picture menu" onClick={(event) => event.stopPropagation()}>{body}</nav>
  </div>;
}
