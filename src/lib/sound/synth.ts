import type { SoundEvent } from "./events";

/**
 * Mochi's built-in sound packs, synthesised from a few lines of note data: no audio files are shipped and every
 * sound is original. `renderSound` is pure (deterministic, no Web Audio needed) so it is unit-tested directly.
 */

export type Wave = "sine" | "triangle" | "square" | "saw" | "noise";

/** One note. Times are seconds, pitch is semitones above the pack's base note. */
export type Tone = { at: number; dur: number; note: number; to?: number; gain?: number; wave?: Wave };

export type Timbre = {
  wave: Wave;
  /** Base note in Hz. */
  base: number;
  /** Adds an inharmonic partial for a bell/glass character (0 = none). */
  bell: number;
  /** Feedback echo amount (0 = dry). */
  echo: number;
  /** Multiplies note lengths: < 1 is snappier. */
  length: number;
};

export type BuiltinPack = { id: string; name: string; description: string; timbre: Timbre };

export const BUILTIN_PACKS: BuiltinPack[] = [
  { id: "mochi", name: "Mochi", description: "Soft, rounded clicks and chimes.", timbre: { wave: "triangle", base: 880, bell: 0.18, echo: 0, length: 1 } },
  { id: "chiptune", name: "Chiptune", description: "Crunchy 8-bit bleeps.", timbre: { wave: "square", base: 523.25, bell: 0, echo: 0, length: 0.8 } },
  { id: "glass", name: "Glass", description: "Airy bells with a short shimmer.", timbre: { wave: "sine", base: 1046.5, bell: 0.55, echo: 0.28, length: 1.15 } },
];

export const DEFAULT_PACK_ID = "mochi";
export const isBuiltinPack = (id: string) => BUILTIN_PACKS.some((pack) => pack.id === id);

/** Peak level per sound, so every pack is equally loud and movement ticks stay quiet. */
export const SOUND_LEVELS: Record<SoundEvent, number> = {
  navigate: 0.2, tab: 0.28, select: 0.42, back: 0.36, open: 0.4, close: 0.34, launch: 0.6, error: 0.5, notification: 0.45, toggleOn: 0.36, toggleOff: 0.32, achievement: 0.62, download: 0.5,
};

export const RECIPES: Record<SoundEvent, Tone[]> = {
  navigate: [{ at: 0, dur: 0.035, note: 7 }],
  tab: [{ at: 0, dur: 0.045, note: 5 }, { at: 0.03, dur: 0.05, note: 9 }],
  select: [{ at: 0, dur: 0.06, note: 0 }, { at: 0.035, dur: 0.09, note: 7 }],
  back: [{ at: 0, dur: 0.09, note: 7, to: 0 }],
  open: [{ at: 0, dur: 0.06, note: 0 }, { at: 0.04, dur: 0.06, note: 4 }, { at: 0.08, dur: 0.11, note: 7 }],
  close: [{ at: 0, dur: 0.06, note: 7 }, { at: 0.04, dur: 0.06, note: 4 }, { at: 0.08, dur: 0.1, note: 0 }],
  launch: [{ at: 0, dur: 0.32, note: -12, to: 12, gain: 0.7 }, { at: 0.2, dur: 0.45, note: 12 }, { at: 0.2, dur: 0.45, note: 16, gain: 0.7 }, { at: 0.2, dur: 0.5, note: 19, gain: 0.6 }],
  error: [{ at: 0, dur: 0.12, note: -12, wave: "square", gain: 0.8 }, { at: 0.13, dur: 0.17, note: -18, wave: "square", gain: 0.8 }],
  notification: [{ at: 0, dur: 0.14, note: 4 }, { at: 0.09, dur: 0.32, note: 11 }],
  toggleOn: [{ at: 0, dur: 0.07, note: 0, to: 7 }],
  toggleOff: [{ at: 0, dur: 0.07, note: 7, to: 0 }],
  achievement: [{ at: 0, dur: 0.1, note: 0 }, { at: 0.08, dur: 0.1, note: 4 }, { at: 0.16, dur: 0.1, note: 7 }, { at: 0.24, dur: 0.6, note: 12 }, { at: 0.24, dur: 0.6, note: 16, gain: 0.7 }, { at: 0.3, dur: 0.18, note: 24, gain: 0.25, wave: "noise" }],
  download: [{ at: 0, dur: 0.13, note: 7 }, { at: 0.1, dur: 0.36, note: 12 }],
};

const TAU = Math.PI * 2;
const ECHO_DELAY = 0.085;

function oscillate(wave: Wave, phase: number, noise: () => number): number {
  switch (wave) {
    case "sine": return Math.sin(phase);
    case "triangle": return (2 / Math.PI) * Math.asin(Math.sin(phase));
    // A softened square: the hard edges of a perfect one sound harsh through laptop speakers.
    case "square": return Math.tanh(3.5 * Math.sin(phase)) * 0.75;
    case "saw": return (Math.sin(phase) + Math.sin(2 * phase) / 2 + Math.sin(3 * phase) / 3 + Math.sin(4 * phase) / 4) * 0.6;
    case "noise": return noise();
  }
}

/** Renders one sound to mono samples, normalised to its level. Deterministic for a given input. */
export function renderSound(tones: Tone[], timbre: Timbre, level: number, sampleRate: number): Float32Array {
  const scaled = tones.map((tone) => ({ ...tone, at: tone.at * timbre.length, dur: tone.dur * timbre.length }));
  const end = Math.max(...scaled.map((tone) => tone.at + tone.dur), 0.01);
  const tail = timbre.echo > 0 ? ECHO_DELAY * 4 : 0;
  const out = new Float32Array(Math.ceil((end + tail + 0.01) * sampleRate));
  let seed = 0x2f6b;
  const noise = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x3fffffff - 1; };

  for (const tone of scaled) {
    const wave = tone.wave ?? timbre.wave;
    const from = timbre.base * 2 ** (tone.note / 12);
    const to = timbre.base * 2 ** ((tone.to ?? tone.note) / 12);
    const start = Math.floor(tone.at * sampleRate);
    const length = Math.max(1, Math.floor(tone.dur * sampleRate));
    const attack = Math.min(length / 4, Math.floor(0.004 * sampleRate));
    const release = Math.min(length / 4, Math.floor(0.006 * sampleRate));
    let phase = 0, bellPhase = 0, low = 0;
    for (let i = 0; i < length && start + i < out.length; i += 1) {
      const progress = i / length;
      const freq = from * (to / from) ** progress;
      phase += (TAU * freq) / sampleRate;
      bellPhase += (TAU * freq * 2.76) / sampleRate;
      let sample = oscillate(wave, phase, noise);
      if (wave === "noise") { low += (sample - low) * 0.25; sample = low * 2; }
      if (timbre.bell > 0 && wave !== "noise") sample += Math.sin(bellPhase) * timbre.bell * Math.exp(-progress * 9);
      const envelope = Math.min(1, i / Math.max(1, attack)) * Math.exp(-progress * 4.2) * Math.min(1, (length - i) / Math.max(1, release));
      out[start + i] += sample * envelope * (tone.gain ?? 1);
    }
  }

  if (timbre.echo > 0) {
    const delay = Math.floor(ECHO_DELAY * sampleRate);
    for (let i = delay; i < out.length; i += 1) out[i] += out[i - delay] * timbre.echo;
  }

  let peak = 0;
  for (let i = 0; i < out.length; i += 1) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0) { const gain = level / peak; for (let i = 0; i < out.length; i += 1) out[i] *= gain; }
  return out;
}

export function renderBuiltin(packId: string, event: SoundEvent, sampleRate: number): Float32Array {
  const pack = BUILTIN_PACKS.find((item) => item.id === packId) ?? BUILTIN_PACKS[0];
  return renderSound(RECIPES[event], pack.timbre, SOUND_LEVELS[event], sampleRate);
}
