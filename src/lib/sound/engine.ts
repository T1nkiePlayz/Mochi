import { MIN_GAP_MS, MOVEMENT_EVENTS, SOUND_EVENTS, type SoundEvent } from "./events";
import { readSoundPackFile, type SoundPackInfo } from "./packs";
import { getSoundSettings, prefersReducedMotion, type SoundSettings } from "./settings";
import { DEFAULT_PACK_ID, isBuiltinPack, renderBuiltin } from "./synth";

/**
 * Low-latency interface sounds on Web Audio. Every sound of the active pack is decoded (or synthesised) into an
 * AudioBuffer ahead of time, so playing one is a single buffer-source start. Works in WebKitGTK and WKWebView:
 * the context is created lazily, resumed on the first real input (autoplay policy), and never throws.
 */

type Ctor = typeof AudioContext;
const AudioCtor = (): Ctor | undefined => (typeof window === "undefined" ? undefined : window.AudioContext ?? (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext);

let context: AudioContext | null = null;
let master: GainNode | null = null;
let buffers = new Map<SoundEvent, AudioBuffer>();
let packGain = 1;
let loadedKey = "";
let loading: Promise<void> | null = null;
let wantedKey = "";
const lastPlayed = new Map<SoundEvent, number>();
let voices = 0;
const MAX_VOICES = 8;

export type SoundScope = "bigpicture" | "launcher";

function ensureContext(): AudioContext | null {
  if (context) return context;
  const Ctor = AudioCtor();
  if (!Ctor) return null;
  try {
    context = new Ctor({ latencyHint: "interactive" });
  } catch {
    try { context = new Ctor(); } catch { return null; }
  }
  master = context.createGain();
  master.gain.value = effectiveVolume(getSoundSettings());
  master.connect(context.destination);
  return context;
}

const effectiveVolume = (settings: SoundSettings) => (settings.muted ? 0 : settings.volume ** 1.6); // perceptual curve

export function applyVolume(settings: SoundSettings = getSoundSettings()) {
  if (!context || !master) return;
  try { master.gain.setTargetAtTime(effectiveVolume(settings), context.currentTime, 0.015); } catch { master.gain.value = effectiveVolume(settings); }
}

/** Resumes audio after a real user input; WebKit also wants one (silent) sound started inside that gesture. */
export function unlockAudio(): boolean {
  const ctx = ensureContext();
  if (!ctx) return false;
  if (ctx.state === "running") return true;
  try {
    void ctx.resume().catch(() => {});
    const source = ctx.createBufferSource();
    source.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    source.connect(ctx.destination);
    source.start(0);
  } catch { /* ignore */ }
  return (ctx.state as string) === "running";
}

export const isAudioUnlocked = () => context?.state === "running";

function decode(ctx: AudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  // Older WebKit only has the callback form and returns undefined.
  return new Promise((resolve, reject) => {
    const result = ctx.decodeAudioData(data, resolve, reject) as Promise<AudioBuffer> | undefined;
    result?.then(resolve, reject);
  });
}

function synthesise(ctx: AudioContext, packId: string): Map<SoundEvent, AudioBuffer> {
  const map = new Map<SoundEvent, AudioBuffer>();
  for (const event of SOUND_EVENTS) {
    const samples = renderBuiltin(packId, event, ctx.sampleRate);
    const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
    buffer.getChannelData(0).set(samples);
    map.set(event, buffer);
  }
  return map;
}

/**
 * Makes `packId` the active pack: a built-in id, or an installed pack (`installed` describes it). Sounds a user pack
 * does not provide, or cannot be decoded here (Ogg on older macOS, for one), fall back to Mochi's own.
 */
export function loadPack(packId: string, installed?: SoundPackInfo): Promise<void> {
  const key = installed ? `user:${installed.id}:${installed.version}:${installed.sizeBytes}` : `builtin:${isBuiltinPack(packId) ? packId : DEFAULT_PACK_ID}`;
  wantedKey = key;
  if (key === loadedKey) return Promise.resolve();
  const ctx = ensureContext();
  if (!ctx) return Promise.resolve();
  const run = (async () => {
    const fallback = synthesise(ctx, installed ? DEFAULT_PACK_ID : isBuiltinPack(packId) ? packId : DEFAULT_PACK_ID);
    let gain = 1;
    if (installed) {
      gain = installed.volume;
      await Promise.all(installed.events.map(async (event) => {
        try { fallback.set(event, await decode(ctx, await readSoundPackFile(installed.id, event))); } catch { /* keep the built-in sound */ }
      }));
    }
    if (wantedKey !== key) return; // a newer choice won
    buffers = fallback;
    packGain = gain;
    loadedKey = key;
  })();
  loading = run.finally(() => { if (loading === run) loading = null; });
  return run;
}

export const soundsReady = () => loadedKey !== "" && !loading;

/** Whether `event` should play right now in `scope`, given the user's settings. */
export function soundAllowed(event: SoundEvent, scope: SoundScope, settings: SoundSettings = getSoundSettings(), reducedMotion = prefersReducedMotion()): boolean {
  if (settings.muted || settings.volume <= 0) return false;
  if (scope === "bigpicture" ? !settings.bigPicture : !settings.launcher) return false;
  if (MOVEMENT_EVENTS.has(event)) {
    if (settings.movement === "never") return false;
    if (settings.movement === "auto" && reducedMotion) return false;
  }
  return true;
}

/** Plays a sound now. Never throws; quietly does nothing before the pack is ready or audio is unlocked. */
export function play(event: SoundEvent, options: { force?: boolean; volume?: number } = {}): void {
  const ctx = context;
  const buffer = buffers.get(event);
  if (!ctx || !master || !buffer) return;
  const now = performance.now();
  if (!options.force && now - (lastPlayed.get(event) ?? -Infinity) < MIN_GAP_MS[event]) return;
  if (voices >= MAX_VOICES) return;
  lastPlayed.set(event, now);
  try {
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = packGain * (options.volume ?? 1);
    source.connect(gain).connect(master);
    voices += 1;
    source.onended = () => { voices = Math.max(0, voices - 1); source.disconnect(); gain.disconnect(); };
    source.start(0);
  } catch { /* audio unavailable */ }
}

/** When `event` last played (ms, performance clock), to avoid stacking related sounds. */
export const lastPlayedAt = (event: SoundEvent) => lastPlayed.get(event) ?? -Infinity;
