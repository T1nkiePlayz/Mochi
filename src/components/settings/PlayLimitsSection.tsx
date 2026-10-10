import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { useApp } from "../../state/AppContext";
import { Select, type SelectOption } from "../ui/Select";
import { formatClock, parseClock, type PlayLimits } from "../../lib/playLimits";
import { SettingsGroup, ToggleRow } from "./Section";

function NumberRow({ title, description, value, min, max, unit, disabled, onChange }: { title: string; description: string; value: number; min: number; max: number; unit: string; disabled: boolean; onChange: (value: number) => void }) {
  return <label className="setting-row"><span><strong>{title}</strong><small>{description}</small></span>
    <span className="settings-number-wrap"><input className="settings-number" type="number" inputMode="numeric" min={min} max={max} value={value} disabled={disabled} aria-label={title}
      onChange={(event) => { const next = Number(event.target.value); if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, Math.round(next)))); }} /> {unit}</span></label>;
}

/** Optional daily limits, break reminders, bedtime and per-game limits. Everything starts off. */
export function PlayLimitsSection() {
  const { behavior, setBehavior, lib } = useApp();
  const limits = behavior.playLimits;
  const set = (changes: Partial<PlayLimits>) => setBehavior((current) => ({ ...current, playLimits: { ...current.playLimits, ...changes } }));
  const off = !limits.enabled;
  const [gameId, setGameId] = useState("");
  const [minutes, setMinutes] = useState(60);
  const games = useMemo<Array<SelectOption<string>>>(() => lib.library.filter((piko) => piko.kind !== "launcher" && !(piko.id in limits.perGame)).map((piko) => ({ value: piko.id, label: piko.name })), [lib.library, limits.perGame]);
  const nameOf = (id: string) => lib.library.find((piko) => piko.id === id)?.name ?? id;
  const addGame = () => { if (gameId) { set({ perGame: { ...limits.perGame, [gameId]: minutes } }); setGameId(""); } };
  const removeGame = (id: string) => { const rest = { ...limits.perGame }; delete rest[id]; set({ perGame: rest }); };
  return <SettingsGroup title="Play limits" subtitle="Optional reminders to keep play time healthy. Off by default; nothing here blocks you unless you choose to be asked first" id="settings-playlimits">
    <ToggleRow title="Use play limits and break reminders" description="Notices appear while a game is running. Your play time stays on this device." checked={limits.enabled} onChange={(enabled) => set({ enabled })} />
    <NumberRow title="Daily limit" description="Minutes of play per day across all games. 0 means no daily limit." value={limits.dailyMinutes} min={0} max={1440} unit="min" disabled={off} onChange={(dailyMinutes) => set({ dailyMinutes })} />
    <NumberRow title="Break reminder" description="Remind me to take a break every this many minutes in one session. 0 turns it off." value={limits.breakEveryMinutes} min={0} max={720} unit="min" disabled={off} onChange={(breakEveryMinutes) => set({ breakEveryMinutes })} />
    <NumberRow title="Warn me at" description="Tell me when this much of a limit has been used." value={limits.warnAtPercent} min={10} max={100} unit="%" disabled={off} onChange={(warnAtPercent) => set({ warnAtPercent })} />
    <ToggleRow title="Bedtime (quiet hours)" description="Remind me when I am playing between these times." checked={limits.bedtimeEnabled} disabled={off} onChange={(bedtimeEnabled) => set({ bedtimeEnabled })} />
    {limits.bedtimeEnabled && <div className="setting-row"><span><strong>Bedtime window</strong><small>It may pass midnight, for example 22:00 to 07:00.</small></span>
      <span className="settings-number-wrap">
        <input type="time" aria-label="Bedtime starts" value={formatClock(limits.bedtimeStart)} disabled={off} onChange={(event) => { const next = parseClock(event.target.value); if (next !== null) set({ bedtimeStart: next }); }} /><span aria-hidden="true">–</span>
        <input type="time" aria-label="Bedtime ends" value={formatClock(limits.bedtimeEnd)} disabled={off} onChange={(event) => { const next = parseClock(event.target.value); if (next !== null) set({ bedtimeEnd: next }); }} />
      </span></div>}
    <div className="setting-row"><span><strong>When a limit is reached</strong><small>"Only remind me" shows a notice. "Ask before launching" also asks for confirmation when you start a game over a limit; you can always continue.</small></span>
      <Select value={limits.enforce} disabled={off} label="When a limit is reached" onChange={(enforce) => set({ enforce })} options={[{ value: "remind", label: "Only remind me" }, { value: "confirm", label: "Ask before launching" }]} /></div>
    <div className="setting-row"><span><strong>Limit for one game</strong><small>A daily limit for a single game, on top of the overall one.</small></span>
      <span className="settings-number-wrap"><Select value={gameId} disabled={off} searchable placeholder="Choose a game" label="Game" onChange={setGameId} options={games} />
        <input className="settings-number" type="number" min={5} max={1440} value={minutes} disabled={off} aria-label="Minutes per day for this game" onChange={(event) => { const next = Number(event.target.value); if (Number.isFinite(next)) setMinutes(Math.min(1440, Math.max(5, Math.round(next)))); }} /> min
        <button type="button" className="secondary-button" disabled={off || !gameId} onClick={addGame}>Add</button></span></div>
    {Object.keys(limits.perGame).length > 0 && <ul className="screenshot-folders" aria-label="Per-game limits">{Object.entries(limits.perGame).map(([id, value]) => <li key={id}><span>{nameOf(id)}: {value} min per day</span><button type="button" className="icon-button" aria-label={`Remove limit for ${nameOf(id)}`} onClick={() => removeGame(id)}><X size={14} /></button></li>)}</ul>}
  </SettingsGroup>;
}
