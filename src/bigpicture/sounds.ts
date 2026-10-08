import { getControllerSettings } from "../controller/settings";

type Kind = "move" | "confirm" | "back" | "open";

let context: AudioContext | null = null;
let lastMove = 0;

const TONES: Record<Kind, { from: number; to: number; length: number; gain: number }> = {
  move: { from: 520, to: 600, length: 0.05, gain: 0.035 },
  confirm: { from: 660, to: 990, length: 0.11, gain: 0.06 },
  back: { from: 520, to: 330, length: 0.1, gain: 0.05 },
  open: { from: 392, to: 784, length: 0.16, gain: 0.05 },
};

/** Tiny synthesized UI sounds; off by default, never throws, no audio files to ship. */
export function playUiSound(kind: Kind) {
  if (!getControllerSettings().uiSounds) return;
  const now = performance.now();
  if (kind === "move") { if (now - lastMove < 45) return; lastMove = now; }
  try {
    context ??= new AudioContext();
    if (context.state === "suspended") void context.resume();
    const tone = TONES[kind];
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const start = context.currentTime;
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(tone.from, start);
    oscillator.frequency.exponentialRampToValueAtTime(tone.to, start + tone.length);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(tone.gain, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + tone.length);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + tone.length + 0.02);
  } catch { /* audio unavailable */ }
}
