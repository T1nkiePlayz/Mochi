import { describe, expect, it } from "vitest";
import { LAUNCHERS, classifyLauncher, launcherForPiko, targetIds } from "./launchers";
import { classifyLauncherEntry, matchesSmartFilter, sanitizeLibrary } from "./library";
import type { Piko } from "../models";
import rust from "../../src-tauri/src/sources/classify.rs?raw";

const piko = (fields: Partial<Piko>): Piko => ({ id: "x", name: "X", description: "", accent: "", artwork: "", tofus: [], ...fields });
const context = { playtime: new Map(), installed: new Map(), isRunning: () => false };

describe("launcher table", () => {
  it("matches the Rust classification table exactly", () => {
    const list = (text: string) => [...text.matchAll(/"([^"]*)"/g)].map((match) => match[1]);
    const rows = [...rust.matchAll(/launcher!\("([^"]+)", "([^"]+)", \[([^\]]*)\], \[([^\]]*)\], \[([^\]]*)\]\)/g)]
      .map(([, id, name, ids, names, bundles]) => ({ id, name, ids: list(ids), names: list(names), bundles: list(bundles) }));
    expect(rows.length).toBeGreaterThan(30);
    expect(LAUNCHERS).toEqual(rows);
  });

  it("recognises launchers by id, name and bundle like the native scanner", () => {
    expect(classifyLauncher(["com.valvesoftware.Steam.desktop"], "Steam")?.id).toBe("steam");
    expect(classifyLauncher([], "Hytale Launcher")?.id).toBe("hytale");
    expect(classifyLauncher(["org.prismlauncher.PrismLauncher"], "Prism")?.id).toBe("prism");
    expect(classifyLauncher([], "GOG Galaxy.app", "com.gog.galaxy")?.id).toBe("gog");
    expect(classifyLauncher(["minecraft"], "Minecraft")).toBeUndefined();
    expect(classifyLauncher(["rarefaction"], "Rarefaction")).toBeUndefined();
  });

  it("reads ids out of stored launch targets", () => {
    expect(targetIds("steam://open/main")).toEqual(["steam"]);
    expect(targetIds("flatpak://com.heroicgameslauncher.hgl")).toEqual(["com.heroicgameslauncher.hgl"]);
    expect(targetIds("/usr/share/applications/net.lutris.Lutris.desktop")).toEqual(["net.lutris.Lutris"]);
    expect(targetIds("/Applications/Battle.net.app")).toEqual(["Battle.net"]);
    expect(targetIds("/usr/bin/prismlauncher --foo")).toEqual(["prismlauncher"]);
    expect(targetIds("https://example.com")).toEqual([]);
  });

  it("never treats a game started through a launcher as the launcher", () => {
    expect(launcherForPiko({ name: "Steam", executablePath: "steam://rungameid/220" })).toBeUndefined();
    expect(launcherForPiko({ name: "Lutris", executablePath: "lutris:rungameid/4" })).toBeUndefined();
    expect(launcherForPiko({ name: "Battle.net", executablePath: "/Applications/Battle.net.app" })?.id).toBe("battlenet");
  });
});

describe("launcher migration on load", () => {
  it("moves old entries into Game launchers with art and without a trailer", () => {
    const old = piko({ name: "Heroic Games Launcher", executablePath: "flatpak://com.heroicgameslauncher.hgl", trailerId: "abc", platformCategory: "Flatpak" });
    const migrated = classifyLauncherEntry(old);
    expect(migrated.kind).toBe("launcher");
    expect(migrated.launcherId).toBe("heroic");
    expect(migrated.trailerId).toBeUndefined();
    expect(migrated.platformCategory).toBe("Launchers");
    expect(migrated.categories).toEqual(["Launcher"]);
    expect(matchesSmartFilter(migrated, "launchers", context)).toBe(true);
  });

  it("keeps user artwork and leaves games alone", () => {
    const custom = classifyLauncherEntry(piko({ name: "Prism Launcher", executablePath: "prismlauncher", artworkSource: "custom", artworkCacheKey: "k" }));
    expect(custom.kind).toBe("launcher");
    expect(custom.artwork).toBe("");
    const game = piko({ name: "SuperTux", executablePath: "/usr/share/applications/supertux2.desktop" });
    expect(classifyLauncherEntry(game)).toBe(game);
  });

  it("fills a missing launcher id and drops launcher trailers", () => {
    const launcher = classifyLauncherEntry(piko({ name: "Steam", kind: "launcher", executablePath: "steam://open/main", trailerId: "t" }));
    expect(launcher.launcherId).toBe("steam");
    expect(launcher.trailerId).toBeUndefined();
    const unknown = classifyLauncherEntry(piko({ name: "Some Launcher", kind: "launcher", trailerId: "t" }));
    expect(unknown.trailerId).toBeUndefined();
  });

  it("runs as part of sanitizeLibrary", () => {
    const [entry] = sanitizeLibrary([{ id: "a", name: "Jagex Launcher", executablePath: "/usr/share/applications/com.jagex.Launcher.desktop", tofus: [] }]);
    expect(entry.kind).toBe("launcher");
    expect(entry.launcherId).toBe("jagex");
  });
});
