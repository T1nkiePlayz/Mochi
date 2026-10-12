#!/usr/bin/env node
// Release build pipeline, used by `npm run build` and therefore by `tauri build`'s
// beforeBuildCommand. Same steps and same results as the old
// `check-themes && check-token-usage && tsc --noEmit && vite build` chain, except that
// `tsc --noEmit` (type check only, emits nothing) and `vite build` (bundles dist/) are
// independent, so they run concurrently: the build takes max(tsc, vite) instead of their sum.
// Both always run, so a tsc failure no longer stops vite early; the script still exits
// non-zero if any step fails, printing which step failed.
import { spawn } from "node:child_process";
import { resolve } from "node:path";
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
  console.log(`✓ themes, tokens, types and bundle OK (tsc + vite in parallel, ${seconds}s).`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
