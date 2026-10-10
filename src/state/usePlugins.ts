import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { register } from "../lib/commands";
import { toEntry, type PluginEntry, type PluginFiles } from "../lib/plugins/manifest";
import { startPlugin } from "../lib/plugins/host";
import type { Piko } from "../models";

type Params = { active: boolean; enabled: string[]; library: Piko[]; notify: (title: string, message: string) => void };

/** Lists installed plugins and runs the enabled ones as palette commands. Does nothing unless the experimental flag is on. */
export function usePlugins({ active, enabled, library, notify }: Params) {
  const [plugins, setPlugins] = useState<PluginEntry[]>([]);
  const libraryRef = useRef(library);
  libraryRef.current = library;
  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  const refresh = useCallback(async () => {
    try { setPlugins((await invoke<PluginFiles[]>("list_plugins")).map(toEntry)); } catch { setPlugins([]); }
  }, []);
  useEffect(() => { if (active) void refresh(); else setPlugins([]); }, [active, refresh]);

  const key = plugins.map((plugin) => plugin.dir).join(",") + "|" + enabled.join(",");
  useEffect(() => {
    if (!active) return;
    const cleanups: Array<() => void> = [];
    for (const plugin of plugins) {
      const { manifest, script } = plugin;
      if (!manifest || !script || plugin.error || !enabled.includes(manifest.id) || !manifest.commands.length) continue;
      try {
        const host = startPlugin(manifest, script, { notify: (title, message) => notifyRef.current(title, message), games: () => libraryRef.current },
          (message) => notifyRef.current(manifest.name, message));
        cleanups.push(() => host.stop());
        for (const command of manifest.commands) {
          cleanups.push(register(`plugin.${manifest.id}.${command.id}`, command.title, [manifest.name, ...command.keywords], "Plugins",
            async () => { try { await host.run(command.id); } catch (error) { notifyRef.current(manifest.name, error instanceof Error ? error.message : String(error)); } }));
        }
      } catch (error) { notifyRef.current(manifest.name, error instanceof Error ? error.message : "The plugin could not start."); }
    }
    return () => cleanups.forEach((cleanup) => cleanup());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` captures the plugin list and the enabled ids
  }, [active, key]);

  return { plugins, refresh };
}
