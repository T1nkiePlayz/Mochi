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
let soundGains = new Map<SoundEvent, number>();
let loadedKey = "";
let loading: Promise<void> | null = null;
let wantedKey = "";
const lastPlayed = new Map<SoundEvent, number>();
let voices = 0;
const MAX_VOICES = 8;

export type SoundScope = "bigpicture" | "launcher";

let warned = false;
const warnOnce = (message: string, error?: unknown) => { if (!warned) { warned = true; console.warn(`[sound] ${message}`, error ?? ""); } };

/** Why interface sounds cannot play on this system, or null when nothing is known to be wrong. */
export const AUDIO_UNAVAILABLE_MESSAGE = "Audio is unavailable on this system. On Linux, install the GStreamer plugins (gst-plugins-base and gst-plugins-good) and restart Mochi.";
let unavailable = false;
export const audioUnavailable = () => unavailable;

function ensureContext(): AudioContext | null {
  if (context) return context;
  const Ctor = AudioCtor();
  if (!Ctor) { unavailable = true; warnOnce("Web Audio is not available in this webview"); return null; }
  try {
    context = new Ctor({ latencyHint: "interactive" });
  } catch {
    try { context = new Ctor(); } catch (error) { unavailable = true; warnOnce("could not create an AudioContext (missing GStreamer audio plugins?)", error); return null; }
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

/** Waits (briefly) for the context to be running. Call right after `unlockAudio()` inside the gesture; false means it never started. */
export async function resumeAudio(timeoutMs = 1000): Promise<boolean> {
  const ctx = context;
  if (!ctx) return false;
  if (ctx.state !== "running") {
    try { await Promise.race([ctx.resume(), new Promise((resolve) => setTimeout(resolve, timeoutMs))]); } catch { /* ignore */ }
  }
  const running = (ctx.state as string) === "running";
  if (!running) warnOnce(`AudioContext did not start (state: ${ctx.state}); GStreamer audio plugins may be missing`);
  unavailable = !running;
  return running;
}

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

export type PackChoice = { id: string; installed?: SoundPackInfo };
export type LoadResult = { /** Installed packs in the chain that could not be loaded at all (fetch/decode errors). */ failed: string[] };

const packKey = (pack: PackChoice) => (pack.installed ? `user:${pack.installed.id}:${pack.installed.version}:${pack.installed.sizeBytes}` : `builtin:${isBuiltinPack(pack.id) ? pack.id : DEFAULT_PACK_ID}`);
let loadedResult: LoadResult = { failed: [] };

/**
 * Makes the first pack of `chain` the active one, with the rest as per-sound fallbacks: a sound the first pack lacks
 * (or cannot decode here: Ogg on older macOS, for one) comes from the next pack that has it, ending with Mochi's own
 * default. Later packs are only read for sounds still missing, so a complete first pack costs nothing extra.
 * A pack "fails" when it offers sounds this chain needed and none could be read or decoded. The result is cached per chain.
 */
export function loadChain(chain: readonly PackChoice[]): Promise<LoadResult> {
  const full = chain.some((pack) => !pack.installed && pack.id === DEFAULT_PACK_ID) ? [...chain] : [...chain, { id: DEFAULT_PACK_ID }];
  const key = full.map(packKey).join("|");
  wantedKey = key;
  if (key === loadedKey) return Promise.resolve(loadedResult);
  const ctx = ensureContext();
  if (!ctx) return Promise.resolve({ failed: [] });
  const run = (async (): Promise<LoadResult> => {
    const next = new Map<SoundEvent, AudioBuffer>();
    const gains = new Map<SoundEvent, number>();
    const failed: string[] = [];
    for (const pack of full) {
      const missing = SOUND_EVENTS.filter((event) => !next.has(event));
      if (missing.length === 0) break;
      if (!pack.installed) {
        let synthesised: Map<SoundEvent, AudioBuffer>;
        try { synthesised = synthesise(ctx, isBuiltinPack(pack.id) ? pack.id : DEFAULT_PACK_ID); }
        catch (error) { warnOnce("could not synthesise the sound pack", error); throw error; }
        for (const event of missing) next.set(event, synthesised.get(event)!);
        continue;
      }
      const wanted = missing.filter((event) => pack.installed!.events.includes(event));
      let loaded = 0;
      await Promise.all(wanted.map(async (event) => {
        try { next.set(event, await decode(ctx, await readSoundPackFile(pack.installed!.id, event))); gains.set(event, pack.installed!.volume); loaded += 1; } catch { /* the next pack in the chain covers it */ }
      }));
      if (wanted.length > 0 && loaded === 0) failed.push(pack.id);
    }
    if (wantedKey !== key) return { failed }; // a newer choice won
    buffers = next;
    soundGains = gains;
    loadedKey = key;
    loadedResult = { failed };
    return { failed };
  })();
  const tracked: Promise<void> = run.then(() => undefined).finally(() => { if (loading === tracked) loading = null; });
  loading = tracked;
  tracked.catch(() => {}); // callers handle `run`; don't leave a second unhandled rejection
  return run;
}

/** Single-pack form of `loadChain` (the pack, then Mochi's default). */
export const loadPack = (packId: string, installed?: SoundPackInfo): Promise<void> => loadChain([{ id: packId, installed }]).then(() => undefined);

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
  const ctx = context, out = master;
  const buffer = buffers.get(event);
  if (!ctx || !out || !buffer) return;
  const now = performance.now();
  if (!options.force && now - (lastPlayed.get(event) ?? -Infinity) < MIN_GAP_MS[event]) return;
  if (voices >= MAX_VOICES) return;
  lastPlayed.set(event, now);
  const start = () => {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = (soundGains.get(event) ?? 1) * (options.volume ?? 1);
    source.connect(gain).connect(out);
    voices += 1;
    source.onended = () => { voices = Math.max(0, voices - 1); source.disconnect(); gain.disconnect(); };
    source.start(0);
  };
  try {
    // WebKit can also report "interrupted", not only "suspended"; schedule once the context is actually running.
    if (ctx.state === "running") start();
    else void ctx.resume().then(start).catch(() => {});
  } catch { /* audio unavailable */ }
}

/** When `event` last played (ms, performance clock), to avoid stacking related sounds. */
export const lastPlayedAt = (event: SoundEvent) => lastPlayed.get(event) ?? -Infinity;
