import { useState, type ReactNode } from "react";
import { Check, Download, Gamepad2, Library, LogOut, Moon, Palette, Power, Volume2, VolumeX } from "lucide-react";
import type { ThemeDescriptor } from "../lib/theme";

export type MenuView = "closed" | "main" | "themes";

type Props = {
  view: Exclude<MenuView, "closed">;
  themes: ThemeDescriptor[];
  theme: string;
  sounds: boolean;
  canSuspend: boolean;
  activeDownloads: number;
  onTheme: (id: string) => void;
  onShowThemes: () => void;
  onSounds: () => void;
  onLibrary: () => void;
  onDownloads: () => void;
  onControllerSettings: () => void;
  onSuspend: () => void;
  onExit: () => void;
  onQuit: () => void;
  onClose: () => void;
};

function Item({ icon, label, detail, danger, onClick, selected }: { icon: ReactNode; label: string; detail?: string; danger?: boolean; selected?: boolean; onClick: () => void }) {
  return <button type="button" className={`bp-menu-item ${danger ? "bp-danger" : ""}`} aria-pressed={selected} onClick={onClick}>
    <span className="bp-menu-icon" aria-hidden="true">{icon}</span><span className="bp-menu-label">{label}</span>{detail && <small>{detail}</small>}
  </button>;
}

export function SideMenu(props: Props) {
  // Power actions need a second press so a stray button never suspends or quits.
  const [armed, setArmed] = useState("");
  const confirmable = (id: string, action: () => void) => () => { if (armed === id) { setArmed(""); action(); } else setArmed(id); };
  return <div className="bp-menu-backdrop" onClick={props.onClose}>
    <nav className="bp-menu" data-nav-scope aria-label="Big Picture menu" onClick={(event) => event.stopPropagation()}>
      {props.view === "themes" ? <>
        <h2 className="bp-menu-title">Theme</h2>
        <div className="bp-menu-list" role="radiogroup" aria-label="Theme">
          {props.themes.map((option) => <button type="button" role="radio" aria-checked={option.id === props.theme} className="bp-menu-item" key={option.id} data-nav-default={option.id === props.theme ? "" : undefined} onClick={() => props.onTheme(option.id)}>
            <span className="bp-menu-icon" aria-hidden="true">{option.id === props.theme ? <Check size={22} /> : <Palette size={22} />}</span><span className="bp-menu-label">{option.name}</span>
          </button>)}
        </div>
      </> : <>
        <h2 className="bp-menu-title">Menu</h2>
        <div className="bp-menu-list">
          <Item icon={<Library size={24} />} label="Library" detail="Back to the desktop view" onClick={props.onLibrary} />
          <Item icon={<Download size={24} />} label="Downloads" detail={props.activeDownloads ? `${props.activeDownloads} active` : "Nothing active"} onClick={props.onDownloads} />
          <Item icon={<Palette size={24} />} label="Theme" onClick={props.onShowThemes} />
          <Item icon={props.sounds ? <Volume2 size={24} /> : <VolumeX size={24} />} label="Interface sounds" detail={props.sounds ? "On" : "Off"} onClick={props.onSounds} />
          <Item icon={<Gamepad2 size={24} />} label="Controller settings" onClick={props.onControllerSettings} />
          {props.canSuspend && <Item icon={<Moon size={24} />} label={armed === "suspend" ? "Press again to suspend" : "Suspend"} onClick={confirmable("suspend", props.onSuspend)} />}
          <Item icon={<LogOut size={24} />} label="Exit Big Picture" onClick={props.onExit} />
          <Item icon={<Power size={24} />} label={armed === "quit" ? "Press again to quit" : "Quit Mochi"} danger onClick={confirmable("quit", props.onQuit)} />
        </div>
      </>}
    </nav>
  </div>;
}
