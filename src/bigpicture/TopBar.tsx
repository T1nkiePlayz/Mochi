import { Battery, BatteryCharging, BatteryLow, Download, Gamepad2, Menu, Search, Square, Undo2 } from "lucide-react";
import { useControllerState } from "../controller/manager";
import type { Piko } from "../models";
import { useClock, useSystemStatus } from "./hooks";

type Props = {
  onMenu: () => void;
  onSearch: () => void;
  query: string;
  nowPlaying: Piko | null;
  onReturn: (piko: Piko) => void;
  onStop: (piko: Piko) => void;
  activeDownloads: number;
};

export function TopBar({ onMenu, onSearch, query, nowPlaying, onReturn, onStop, activeDownloads }: Props) {
  const time = useClock();
  const status = useSystemStatus();
  const { pads } = useControllerState();
  const percent = status?.batteryPercent ?? null;
  const BatteryIcon = status?.charging ? BatteryCharging : percent !== null && percent <= 20 ? BatteryLow : Battery;
  return <header className="bp-topbar">
    <div className="bp-topbar-left">
      <button type="button" className="bp-icon-button" aria-label="Open menu" onClick={onMenu}><Menu size={26} aria-hidden="true" /></button>
      <button type="button" className="bp-icon-button" aria-label={query ? `Search: ${query}` : "Search games"} onClick={onSearch}><Search size={26} aria-hidden="true" /></button>
      {query && <span className="bp-chip">“{query}”</span>}
    </div>
    {nowPlaying && <div className="bp-nowplaying" role="status">
      <span className="bp-nowplaying-pulse" aria-hidden="true" />
      <span className="bp-nowplaying-text"><small>Now playing</small><strong>{nowPlaying.name}</strong></span>
      <button type="button" className="bp-pill-button" onClick={() => onReturn(nowPlaying)}><Undo2 size={18} aria-hidden="true" /> Return</button>
      <button type="button" className="bp-pill-button bp-danger" onClick={() => onStop(nowPlaying)}><Square size={16} aria-hidden="true" /> Stop</button>
    </div>}
    <div className="bp-topbar-right">
      {activeDownloads > 0 && <span className="bp-status" title="Downloads in progress"><Download size={22} aria-hidden="true" /><span>{activeDownloads}</span></span>}
      {pads.length > 0 && <span className="bp-status" title={pads.map((pad) => pad.name).join(", ")}><Gamepad2 size={24} aria-hidden="true" /><span className="bp-visually-hidden">{pads.length} controller{pads.length === 1 ? "" : "s"} connected</span></span>}
      {status?.hasBattery && percent !== null && <span className={`bp-status ${percent <= 20 && !status.charging ? "bp-low" : ""}`} title={status.charging ? "Charging" : "On battery"}><BatteryIcon size={24} aria-hidden="true" /><span>{percent}%</span></span>}
      <time className="bp-clock">{time}</time>
    </div>
  </header>;
}
