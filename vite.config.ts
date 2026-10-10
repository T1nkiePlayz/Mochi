import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

/**
 * Puts every launcher stylesheet into a cascade layer so themes (which load in the later `theme` / `user` layers)
 * always win over launcher defaults, while src/styles/layout.css (layer `layout`, !important guards) protects the shell.
 * Order is declared in index.html and src/styles/layers.css: reset < tokens < base < layout < theme < user.
 */
function layerPlugin() {
  return {
    postcssPlugin: "mochi-layers",
    Once(root: { source?: { input?: { file?: string } }; nodes: unknown[]; removeAll(): void; append(node: unknown): void }, { AtRule }: { AtRule: new (init: { name: string; params: string }) => { append(nodes: unknown[]): void } }) {
      const file = (root.source?.input?.file ?? "").replace(/\\/g, "/");
      if (!file.includes("/src/") || /fonts\.generated\.css$|\/layout\.css$|\/layers\.css$/.test(file)) return;
      const layer = new AtRule({ name: "layer", params: /\/tokens\.css$/.test(file) ? "tokens" : "base" });
      const nodes = [...root.nodes];
      root.removeAll();
      layer.append(nodes);
      root.append(layer);
    },
  };
}
layerPlugin.postcss = true;

export default defineConfig({
  plugins: [react()],
  css: { postcss: { plugins: [layerPlugin()] } },
  test: { include: ["src/**/*.test.{ts,tsx}"] },
  define: { __APP_VERSION__: JSON.stringify(version) },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("/node_modules/@supabase/")) return "supabase";
          if (id.includes("/node_modules/lucide-react/")) return "icons";
          if (id.includes("/node_modules/react-dom/") || id.includes("/node_modules/react/")) return "react";
          // App code that is large and only needed once a game or mod is involved: keeps the entry chunk under the 500 kB limit.
          if (id.includes("/src/assets/launchers")) return "launcher-art";
          if (id.includes("/src/lib/mods/") || id.includes("/src/lib/nexus") || id.includes("/src/lib/modrinth") || id.includes("/src/lib/curseforge")) return "mods-core";
        },
      },
    },
  },
});
