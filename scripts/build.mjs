#!/usr/bin/env node
// Release build pipeline, used by `npm run build` and therefore by `tauri build`'s
// beforeBuildCommand. Same steps and same results as the old
// `check-themes && check-token-usage && tsc --noEmit && vite build` chain, except that
// `tsc --noEmit` (type check only, emits nothing) and `vite build` (bundles dist/) are
// independent, so they run concurrently: the build takes max(tsc, vite) instead of their sum.
// Both always run, so a tsc failure no longer stops vite early; the script still exits
// non-zero if any step fails, printing which step failed.
import { spawn } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
// Resolve node_modules/.bin ourselves so the script also works outside `npm run`.
const env = { ...process.env, PATH: `${resolve(root, "node_modules/.bin")}:${process.env.PATH ?? ""}` };

/** Runs one shell command to completion, collecting (not streaming) its output. */
export function run(command) {
  return new Promise((resolveRun) => {
    const child = spawn(command, { cwd: root, env, shell: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("error", (error) => resolveRun({ code: 1, output: `${output}${error.message}\n` }));
    child.on("close", (code) => resolveRun({ code: code ?? 1, output }));
  });
}

function printBlock(label, { code, output }) {
  if (!output) return;
  process.stdout.write(`--- ${label} ---\n${output}`);
  if (!output.endsWith("\n")) process.stdout.write("\n");
}

// Entry JS chunk budget, documented next to manualChunks in vite.config.ts. The entry is whatever
// dist/index.html loads, not any `index-*.js` in dist/assets — the others there are lazy import chunks.
const ENTRY_CHUNK_BUDGET_BYTES = 500 * 1024;

function checkEntryChunkBudget() {
  try {
    const html = readFileSync(resolve(root, "dist/index.html"), "utf8");
    const src = html.match(/<script[^>]*src="([^"]+\.js)"/)?.[1];
    if (!src) return { ok: false, message: "entry-chunk budget: no <script src=\"*.js\"> found in dist/index.html" };
    const file = resolve(root, "dist", src.replace(/^\.?\//, ""));
    const size = statSync(file).size;
    if (size > ENTRY_CHUNK_BUDGET_BYTES) {
      return { ok: false, message: `entry-chunk budget: ${basename(file)} is ${size} bytes, over the ${ENTRY_CHUNK_BUDGET_BYTES}-byte (500 kB) budget from vite.config.ts manualChunks. Split more code out of the entry.` };
    }
    return { ok: true, message: `entry chunk ${basename(file)} is ${(size / 1024).toFixed(1)} kB of the ${ENTRY_CHUNK_BUDGET_BYTES / 1024} kB budget.` };
  } catch (error) {
    return { ok: false, message: `entry-chunk budget: ${error.message}` };
  }
}

export async function main() {
  // Fast validations first: they fail in well under a second, exactly like the old chain.
  const checks = [
    ["check:themes", "node scripts/check-themes.mjs"],
    ["check:tokens", "node scripts/check-token-usage.mjs"],
  ];
  for (const [label, command] of checks) {
    const result = await run(command);
    if (result.code !== 0) {
      printBlock(label, result);
      console.error(`✗ ${label} failed.`);
      process.exit(result.code);
    }
  }

  const started = Date.now();
  const [tsc, vite] = await Promise.all([run("tsc --noEmit"), run("vite build")]);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  printBlock("tsc --noEmit", tsc);
  printBlock("vite build", vite);

  const failed = [
    ["tsc --noEmit", tsc],
    ["vite build", vite],
  ].filter(([, result]) => result.code !== 0);
  if (failed.length) {
    console.error(`✗ ${failed.map(([label]) => label).join(", ")} failed (parallel step, ${seconds}s).`);
    process.exit(failed[0][1].code);
  }
  const budget = checkEntryChunkBudget();
  if (!budget.ok) {
    console.error(`✗ ${budget.message}`);
    process.exit(1);
  }
  console.log(`✓ themes, tokens, types and bundle OK (tsc + vite in parallel, ${seconds}s).`);
  console.log(`✓ ${budget.message}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
