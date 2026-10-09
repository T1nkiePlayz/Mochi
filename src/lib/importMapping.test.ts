import { describe, expect, it } from "vitest";
import { importedGameToPiko, platformLabel } from "./importMapping";
import { isMinecraftJava } from "./mods/gameSupport";

describe("importedGameToPiko", () => {
  it("turns a Prism instance into the Minecraft game whose Tofu is the instance", () => {
    const piko = importedGameToPiko({
      id: "prism:Fabric", name: "Fabric Fun", source: "prism", launchTarget: "mc-instance://prism/Fabric", installPath: "/i/Fabric",
      kind: "game", minecraft: { version: "1.21.1", loader: "fabric", gameDir: "/i/Fabric/minecraft" },
    }, 1);
    expect(piko.platformCategory).toBe("Minecraft");
    expect(isMinecraftJava(piko)).toBe(true);
    expect(piko.id).toBe("minecraft");
    expect(piko.tofus[0]).toMatchObject({ id: "mc-prism-Fabric", name: "Fabric Fun", version: "1.21.1", loader: "fabric", path: "/i/Fabric/minecraft/mods", gameDir: "/i/Fabric/minecraft/mods", contentRoot: "/i/Fabric/minecraft", launchTarget: "mc-instance://prism/Fabric" });
  });

  it("falls back to vanilla for unknown loaders and keeps plain games simple", () => {
    const odd = importedGameToPiko({ id: "p", name: "Odd", source: "prism", launchTarget: "mc-instance://prism/Odd", minecraft: { loader: "liteloader", gameDir: "/g" } }, 1);
    expect(odd.tofus[0].loader).toBe("vanilla");
    const game = importedGameToPiko({ id: "battlenet:wow", name: "World of Warcraft", source: "battlenet", launchTarget: "battlenet://WoW" }, 1);
    expect(game.tofus[0].path).toBeUndefined();
    expect(game.modLinks).toBeUndefined();
    expect(game.platformCategory).toBe("Battle.net");
  });

  it("keeps the launcher id of launchers", () => {
    const steam = importedGameToPiko({ id: "launcher:steam", name: "Steam", source: "steam", launchTarget: "steam://open/main", kind: "launcher", launcherId: "steam" }, 1);
    expect(steam.launcherId).toBe("steam");
    expect(steam.kind).toBe("launcher");
    expect(platformLabel("gog")).toBe("GOG");
  });
});
