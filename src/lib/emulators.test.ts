import { describe, expect, it } from "vitest";
import { addRomFolder, removeRomFolder, setFolderSystem, setSystemChoice, type EmulatorSettings } from "./emulators";

const empty: EmulatorSettings = { folders: [], systems: {} };

describe("emulator settings helpers", () => {
  it("adds folders once, maps them and removes them", () => {
    const added = addRomFolder(addRomFolder(empty, "/roms"), "/roms");
    expect(added.folders).toEqual([{ path: "/roms", system: "auto" }]);
    const mapped = setFolderSystem(addRomFolder(added, "/more"), "/roms", "snes");
    expect(mapped.folders).toEqual([{ path: "/roms", system: "snes" }, { path: "/more", system: "auto" }]);
    expect(removeRomFolder(mapped, "/roms").folders).toEqual([{ path: "/more", system: "auto" }]);
    expect(empty.folders).toEqual([]);
  });

  it("keeps the other fields of a system and resets the core when the emulator changes", () => {
    const first = setSystemChoice(empty, "gba", { emulator: "retroarch", core: "mgba", args: "-f" });
    expect(first.systems.gba).toEqual({ emulator: "retroarch", core: "mgba", args: "-f" });
    expect(setSystemChoice(first, "gba", { args: "-g" }).systems.gba).toEqual({ emulator: "retroarch", core: "mgba", args: "-g" });
    expect(setSystemChoice(first, "gba", { emulator: "mgba" }).systems.gba).toEqual({ emulator: "mgba", core: "", args: "-f" });
    expect(setSystemChoice(first, "gba", { emulator: "mgba", core: "x" }).systems.gba?.core).toBe("x");
    expect(first.systems.snes).toBeUndefined();
  });
});
