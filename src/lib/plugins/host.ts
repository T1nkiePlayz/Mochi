import type { Piko } from "../../models";
import type { PluginManifest } from "./manifest";

/**
 * Runs one plugin in a dedicated Worker with no network or storage APIs. This is a best-effort sandbox
 * (the page CSP also blocks network from workers), so the UI still tells people to install trusted plugins only.
 * The plugin talks to Mochi only through `mochi.command / notify / games`; permissions are enforced here, not in the worker.
 */
const PRELUDE = `
"use strict";
const post = self.postMessage.bind(self);
const handlers = new Map();
const pending = new Map();
let seq = 0;
for (const name of ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "importScripts", "indexedDB", "caches", "BroadcastChannel", "SharedWorker", "Worker", "WebTransport", "navigator"]) {
  try { Object.defineProperty(self, name, { value: undefined, configurable: false, writable: false }); } catch (e) {}
}
const ask = (type, payload) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); post({ type, id, payload }); });
const mochi = Object.freeze({
  command: (id, handler) => { if (typeof handler === "function") handlers.set(String(id), handler); },
  notify: (title, message) => ask("notify", { title: String(title), message: String(message) }),
  games: () => ask("games"),
});
self.onmessage = async (event) => {
  const data = event.data || {};
  if (data.type === "reply") { const p = pending.get(data.id); if (p) { pending.delete(data.id); data.error ? p.reject(new Error(data.error)) : p.resolve(data.result); } return; }
  if (data.type === "run") {
    const handler = handlers.get(data.command);
    try { if (handler) await handler(); post({ type: "done", id: data.id }); } catch (e) { post({ type: "done", id: data.id, error: String((e && e.message) || e) }); }
  }
};
`;

export type PluginHostApi = { notify: (title: string, message: string) => void; games: () => Piko[] };
export type PluginHost = { run: (commandId: string) => Promise<void>; stop: () => void };

const RUN_TIMEOUT_MS = 10_000;
const MAX_NOTIFICATIONS_PER_MINUTE = 5;

export function startPlugin(manifest: PluginManifest, script: string, api: PluginHostApi, onError: (message: string) => void): PluginHost {
  const source = `${PRELUDE}\n;(function(mochi){\n${script}\n})(mochi);`;
  const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  const worker = new Worker(url);
  URL.revokeObjectURL(url);
  const runs = new Map<number, { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  let seq = 0;
  let sent: number[] = [];

  const reply = (id: number, result?: unknown, error?: string) => worker.postMessage({ type: "reply", id, result, error });
  worker.onmessage = (event: MessageEvent) => {
    const data = event.data as { type?: string; id?: number; payload?: { title?: string; message?: string }; error?: string };
    if (typeof data?.id !== "number") return;
    if (data.type === "notify") {
      const now = Date.now();
      sent = sent.filter((time) => now - time < 60_000);
      if (!manifest.permissions.includes("notify")) return reply(data.id, undefined, "Missing permission: notify");
      if (sent.length >= MAX_NOTIFICATIONS_PER_MINUTE) return reply(data.id, undefined, "Too many notifications");
      sent.push(now);
      api.notify(`${manifest.name}: ${String(data.payload?.title ?? "").slice(0, 80)}`, String(data.payload?.message ?? "").slice(0, 300));
      reply(data.id, true);
    } else if (data.type === "games") {
      if (!manifest.permissions.includes("games.read")) return reply(data.id, undefined, "Missing permission: games.read");
      // Only what a command needs; no paths, launch targets or notes.
      reply(data.id, api.games().slice(0, 2000).map((game) => ({ id: game.id, name: game.name, tags: game.tags ?? [] })));
    } else if (data.type === "done") {
      const run = runs.get(data.id);
      if (!run) return;
      runs.delete(data.id); clearTimeout(run.timer);
      data.error ? run.reject(new Error(data.error)) : run.resolve();
    }
  };
  worker.onerror = (event) => { event.preventDefault(); onError(event.message || "The plugin crashed."); };

  return {
    run: (commandId) => new Promise<void>((resolve, reject) => {
      const id = ++seq;
      // A plugin that hangs is stopped for good rather than left spinning.
      const timer = setTimeout(() => { runs.delete(id); worker.terminate(); reject(new Error("The command took too long and the plugin was stopped.")); }, RUN_TIMEOUT_MS);
      runs.set(id, { resolve, reject, timer });
      worker.postMessage({ type: "run", id, command: commandId });
    }),
    stop: () => { worker.terminate(); runs.forEach((run) => { clearTimeout(run.timer); run.reject(new Error("Plugin stopped.")); }); runs.clear(); },
  };
}
