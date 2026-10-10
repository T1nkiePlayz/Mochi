import { useMemo, useState } from "react";
import { Download, FolderOpen, Play, Trash2, Upload } from "lucide-react";
import { Select, type SelectOption } from "../ui/Select";
import { useApp } from "../../state/AppContext";
import { BUILTIN_PACKS, SOUND_EVENTS, SOUND_LABELS, useSoundSettings, type MovementSounds, type SoundEvent } from "../../lib/sound";
import { AUDIO_UNAVAILABLE_MESSAGE, loadChain, play, resumeAudio, unlockAudio } from "../../lib/sound/engine";
import { announceSoundPacksChanged, exportSoundPack, importSoundPack, removeSoundPack, type SoundPackInfo } from "../../lib/sound/packs";
import { resolveSoundPack, type ResolvedPack } from "../../lib/sound/resolve";
import { useSoundPacks } from "../../lib/sound/useSoundPacks";
import { useSoundChain } from "../../lib/sound/useSoundChain";
import { SoundFallbacks } from "./SoundFallbacks";
import { confirmAction } from "../../lib/confirm";
import { formatBytes } from "../../lib/format";
import { SettingsGroup, ToggleRow } from "./Section";

const MOVEMENT: Array<SelectOption<MovementSounds>> = [
  { value: "auto", label: "Unless motion is reduced", description: "Off while reduced motion is on in Accessibility or your system." },
  { value: "always", label: "Always" },
  { value: "never", label: "Never" },
];

const packName = (pack: ResolvedPack) => pack.installed?.name ?? BUILTIN_PACKS.find((item) => item.id === pack.id)?.name ?? "Mochi";
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

function PackRow({ pack, onExport, onRemove }: { pack: SoundPackInfo; onExport: () => void; onRemove: () => void }) {
  return <li className="sound-pack">
    <span className="sound-pack-info">
      <strong>{pack.name}</strong>
      <small>{[pack.author && `by ${pack.author}`, `v${pack.version}`, `${pack.events.length} of ${SOUND_EVENTS.length} sounds`, formatBytes(pack.sizeBytes)].filter(Boolean).join(" · ")}</small>
      {pack.description && <small>{pack.description}</small>}
    </span>
    <span className="sound-pack-actions">
      <button type="button" className="secondary-button" onClick={onExport}><Download size={15} aria-hidden="true" /> Export</button>
      <button type="button" className="secondary-button danger-outline" aria-label={`Remove ${pack.name}`} onClick={() => void confirmAction({ title: "Remove sound pack?", message: `${pack.name} will be deleted. Themes using it fall back to the Mochi sounds.`, confirmLabel: "Remove", danger: true }).then((ok) => ok && onRemove())}><Trash2 size={15} aria-hidden="true" /> Remove</button>
    </span>
  </li>;
}

export function SoundSection() {
  const { themeEngine } = useApp();
  const [settings, update] = useSoundSettings();
  const { packs, loaded } = useSoundPacks();
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const theme = themeEngine.themes.find((option) => option.id === themeEngine.theme);
  const { chain } = useSoundChain(theme);
  const resolved = chain[0];
  const resolvedName = packName(resolved);

  const packOptions = useMemo<Array<SelectOption<string>>>(() => [
    { value: "theme", label: "Match theme", description: theme ? `${theme.name} suggests ${packName(resolveSoundPack("theme", theme.soundPack, packs))}` : undefined },
    ...BUILTIN_PACKS.map((pack) => ({ value: pack.id, label: pack.name, description: pack.description, group: "Built in" })),
    ...packs.map((pack) => ({ value: pack.id, label: pack.name, description: pack.description || undefined, group: "Installed" })),
  ], [packs, theme]);

  const [audioProblem, setAudioProblem] = useState(false);
  const preview = async (event: SoundEvent) => {
    unlockAudio(); // this click is the user gesture that lets audio start; it must run before any await
    const [running] = await Promise.all([resumeAudio(), loadChain(chain).catch(() => {})]);
    setAudioProblem(!running);
    play(event, { force: true });
  };

  const run = async (task: () => Promise<string | null>) => {
    setBusy(true);
    try { const text = await task(); if (text) setStatus({ tone: "ok", text }); }
    catch (error) { setStatus({ tone: "error", text: errorText(error) }); play("error", { force: true }); }
    finally { setBusy(false); }
  };

  const doImport = (kind: "zip" | "folder") => run(async () => {
    const pack = await importSoundPack(kind);
    if (!pack) return null;
    announceSoundPacksChanged();
    update({ pack: pack.id });
    return `Installed “${pack.name}” and switched to it.`;
  });

  const volume = Math.round(settings.volume * 100);
  return <>
    <SettingsGroup title="Sound" subtitle="Interface sounds for Big Picture and the launcher" id="settings-sound">
      <ToggleRow title="Sounds in Big Picture" description="Play sounds when you move, select, go back, launch a game and more." checked={settings.bigPicture} onChange={(bigPicture) => update({ bigPicture })} />
      <ToggleRow title="Sounds in the launcher" description="Also play them in the regular window: clicks, switches, dialogs, downloads and notifications." checked={settings.launcher} onChange={(launcher) => update({ launcher })} />
      <ToggleRow title="Mute" description="Silence every interface sound without changing the settings above." checked={settings.muted} onChange={(muted) => update({ muted })} />
      <label className="setting-row">
        <span><strong>Volume</strong><small>Interface sounds only; game audio is unaffected. Now {volume}%.</small></span>
        <input type="range" min={0} max={100} step={5} value={volume} aria-label="Interface sound volume" aria-valuetext={`${volume}%`} disabled={settings.muted}
          onChange={(event) => update({ volume: Number(event.target.value) / 100 })} onPointerUp={() => void preview("select")} onKeyUp={(event) => { if (event.key.startsWith("Arrow")) void preview("navigate"); }} />
      </label>
      <div className="setting-row"><span><strong>Movement sounds</strong><small>The soft tick when focus moves with a controller or the arrow keys.</small></span>
        <Select<MovementSounds> label="Movement sounds" value={settings.movement} options={MOVEMENT} onChange={(movement) => update({ movement })} align="end" /></div>
      <div className="setting-row"><span><strong>Sound pack</strong><small>Now playing: {resolvedName}. Themes can suggest a pack; “Match theme” follows it.</small></span>
        <Select<string> label="Sound pack" value={settings.pack} options={packOptions} onChange={(pack) => update({ pack })} align="end" /></div>
      <SoundFallbacks fallbacks={settings.fallbacks} packs={packs} loaded={loaded} onChange={(fallbacks) => update({ fallbacks })} />
      {audioProblem && <p className="sound-pack-status is-error" role="alert">{AUDIO_UNAVAILABLE_MESSAGE}</p>}
      <div className="setting-row sound-preview-row"><span><strong>Preview</strong><small>Hear each sound of {resolvedName}.</small></span>
        <div className="sound-preview" role="group" aria-label="Preview sounds" data-sound="none">
          {SOUND_EVENTS.map((event) => <button type="button" key={event} className="secondary-button sound-preview-button" onClick={() => void preview(event)}><Play size={13} aria-hidden="true" /> {SOUND_LABELS[event]}</button>)}
        </div>
      </div>
    </SettingsGroup>
    <SettingsGroup title="Sound packs" subtitle="A .zip or folder with a manifest.json that maps events to .wav, .ogg or .mp3 files" id="settings-sound-packs">
      <div className="setting-row"><span><strong>Install a pack</strong><small>Up to 2 MiB per sound and 16 MiB per pack. WAV and MP3 work everywhere; Ogg may not play on older macOS, where Mochi's own sound is used instead.</small></span>
        <span className="sound-pack-actions">
          <button type="button" className="secondary-button" disabled={busy} onClick={() => void doImport("zip")}><Upload size={15} aria-hidden="true" /> Import .zip</button>
          <button type="button" className="secondary-button" disabled={busy} onClick={() => void doImport("folder")}><FolderOpen size={15} aria-hidden="true" /> Import folder</button>
        </span>
      </div>
      {status && <p className={`sound-pack-status ${status.tone === "error" ? "is-error" : ""}`} role={status.tone === "error" ? "alert" : "status"}>{status.text}</p>}
      {loaded && packs.length === 0 && <p className="metadata-note sound-pack-empty">No packs installed. Mochi's built-in packs (Mochi, Chiptune and Glass) are always available.</p>}
      {packs.length > 0 && <ul className="sound-pack-list" aria-label="Installed sound packs">
        {packs.map((pack) => <PackRow key={pack.id} pack={pack}
          onExport={() => void run(async () => ((await exportSoundPack(pack)) ? `Exported “${pack.name}”.` : null))}
          onRemove={() => void run(async () => {
            await removeSoundPack(pack.id);
            if (settings.pack === pack.id) update({ pack: "theme" });
            announceSoundPacksChanged();
            return `Removed “${pack.name}”.`;
          })} />)}
      </ul>}
    </SettingsGroup>
  </>;
}
