// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** A minimal Web Audio fake that records source starts. */
function installFake(options: { state?: string; throwOnCreate?: boolean; neverRuns?: boolean } = {}) {
  const starts: number[] = [];
  const instances: Array<{ state: string; resume: ReturnType<typeof vi.fn> }> = [];
  class FakeContext {
    state = options.state ?? "suspended";
    sampleRate = 22050;
    currentTime = 0;
    destination = {};
    resume = vi.fn(async () => { if (!options.neverRuns) this.state = "running"; else await new Promise(() => {}); });
    constructor() { if (options.throwOnCreate) throw new Error("no audio"); instances.push(this); }
    createGain() { return { gain: { value: 1, setTargetAtTime() {} }, connect(next: unknown) { return next; }, disconnect() {} }; }
    createBuffer(_c: number, length: number) { const data = new Float32Array(length); return { getChannelData: () => data }; }
    createBufferSource() { return { buffer: null, connect(next: unknown) { return next; }, disconnect() {}, onended: null, start: () => { starts.push(1); } }; }
  }
  vi.stubGlobal("AudioContext", FakeContext);
  (window as unknown as { AudioContext: unknown }).AudioContext = FakeContext;
  return { starts, instances };
}

const load = async () => (await import("./engine")) as typeof import("./engine");

beforeEach(() => { vi.resetModules(); vi.spyOn(console, "warn").mockImplementation(() => {}); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("sound engine", () => {
  it("resumes a non-running context (suspended or interrupted) before starting a sound", async () => {
    for (const state of ["suspended", "interrupted"]) {
      vi.resetModules();
      const { starts, instances } = installFake({ state });
      const engine = await load();
      engine.unlockAudio();
      await engine.loadPack("mochi");
      starts.length = 0;
      instances[0].state = state; // WebKit dropped the context again after unlock
      engine.play("select", { force: true });
      await Promise.resolve(); await Promise.resolve();
      expect(starts.length).toBeGreaterThan(0);
    }
  });

  it("plays after unlock and load, and does nothing before the pack is loaded", async () => {
    const { starts } = installFake();
    const engine = await load();
    engine.unlockAudio();
    engine.play("select", { force: true });
    expect(starts.length).toBe(1); // only the silent unlock buffer
    await engine.loadPack("mochi");
    engine.play("select", { force: true });
    await Promise.resolve();
    expect(starts.length).toBe(2);
  });

  it("creates and resumes the context synchronously in unlockAudio, before any await", () => {
    const { instances } = installFake();
    return load().then((engine) => {
      engine.unlockAudio();
      expect(instances).toHaveLength(1);
      expect(instances[0].resume).toHaveBeenCalledTimes(1);
    });
  });

  it("reports unavailable audio once when the context cannot be created", async () => {
    installFake({ throwOnCreate: true });
    const engine = await load();
    expect(engine.unlockAudio()).toBe(false);
    await engine.loadPack("mochi");
    expect(engine.audioUnavailable()).toBe(true);
    expect(await engine.resumeAudio()).toBe(false);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("resumeAudio gives up when the context never starts", async () => {
    installFake({ neverRuns: true });
    const engine = await load();
    engine.unlockAudio();
    expect(await engine.resumeAudio(20)).toBe(false);
    expect(engine.audioUnavailable()).toBe(true);
  });

  it("surfaces a loadPack failure instead of swallowing it silently", async () => {
    installFake();
    const engine = await load();
    const synth = await import("./synth");
    vi.spyOn(synth, "renderBuiltin").mockImplementation(() => { throw new Error("boom"); });
    await expect(engine.loadPack("mochi")).rejects.toThrow("boom");
    expect(console.warn).toHaveBeenCalled();
  });
});
