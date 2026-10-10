/** A game that ends this soon after starting most likely failed to launch rather than being played. */
export const QUICK_EXIT_SECONDS = 15;

type Rule = { test: RegExp; hint: string };

const rules: Rule[] = [
  { test: /error while loading shared libraries|cannot open shared object file|GLIBC_[\d.]+' not found/i, hint: "A system library is missing or too old. Install the library named in the log, or run the game with a Proton/Wine runtime." },
  { test: /exec format error|cannot execute binary file|bad cpu type/i, hint: "The file was built for a different system or CPU. Pick a launch runtime (Wine/Proton) or the right build for this machine." },
  { test: /permission denied/i, hint: "The game file is not allowed to run. Make it executable (chmod +x) or check the folder permissions." },
  { test: /no such file or directory|cannot find the (file|path)|file not found/i, hint: "A file the game needs was not found. Check that the executable path in the game's settings still exists and the drive is mounted." },
  { test: /wine: (could not load|cannot find)|wineserver|err:module|c0000135|c000007b/i, hint: "Wine could not start the game. Try another Wine/Proton version, recreate the Wine prefix, or install the runtime it names (vcredist, DirectX, .NET)." },
  { test: /vulkan|vkcreateinstance|vk_error|libvulkan|no (suitable )?(gpu|graphics)/i, hint: "Vulkan graphics failed to start. Update your graphics driver and install the 32-bit and 64-bit Vulkan packages." },
  { test: /libgl|glx|opengl|egl|failed to (create|initialize) (a )?(gl|opengl|window|display)/i, hint: "Graphics failed to initialise. Update your graphics driver, or try launching with a different display mode." },
  { test: /cannot open display|no protocol specified|wayland|xcb/i, hint: "The game could not open a window. On Wayland, try an X11 session or set the game to use XWayland." },
  { test: /java\.lang|unsupportedclassversion|could not create the java virtual machine|jvm/i, hint: "Java problem. Use the Java version the game or modpack asks for (Minecraft 1.20.5+ needs Java 21)." },
  { test: /out of memory|cannot allocate memory|std::bad_alloc|outofmemoryerror/i, hint: "The game ran out of memory. Close other programs, or lower its memory setting." },
  { test: /steam.*(not running|must be running)|steamapi_init|steam_api/i, hint: "The game needs Steam running. Start Steam and sign in, then launch again." },
  { test: /anti-?cheat|easyanticheat|battleye/i, hint: "Anti-cheat blocked the game. Many anti-cheat games do not run under Wine/Proton." },
];

/** Plain-language likely causes for a game that closed quickly. `log` is the end of the captured output, if any was captured. */
export function launchHints(log: string | null, platform: string, limit = 3): string[] {
  const found: string[] = [];
  const text = log ?? "";
  for (const rule of rules) if (rule.test.test(text) && !found.includes(rule.hint)) found.push(rule.hint);
  if (found.length) return found.slice(0, limit);
  if (log === null) return [platform === "macos"
    ? "Mochi cannot see this game's output. Check the Console app, or launch it once from its own launcher to see the error."
    : "Mochi cannot see this game's output (started through Steam, Flatpak or another launcher). Launch it once from that launcher to see the error."];
  return ["No known cause found in the output. Open the game's logs from its details page, and check the executable path, runtime and launch options."];
}

/** Which games ended a session within the quick-exit window, from the previous and current running sets. */
export function quickExits(previous: ReadonlyMap<string, number>, current: ReadonlySet<string>, nowSeconds: number, window = QUICK_EXIT_SECONDS): string[] {
  const out: string[] = [];
  for (const [id, startedAt] of previous) if (!current.has(id) && nowSeconds - startedAt < window) out.push(id);
  return out;
}
