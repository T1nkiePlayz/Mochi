import type { Piko } from "../models";

/**
 * Known game launchers, mirrored from `src-tauri/src/sources/classify.rs` (`LAUNCHERS`) so entries
 * imported before a launcher was known are re-classified when the library loads. `launchers.test.ts`
 * fails when the two tables drift apart.
 */
export type LauncherDef = { id: string; name: string; ids: string[]; names: string[]; bundles: string[] };

export const LAUNCHERS: LauncherDef[] = [
  { id: "steam", name: "Steam", ids: ["steam", "steam-native", "com.valvesoftware.steam"], names: ["steam"], bundles: ["com.valvesoftware.steam"] },
  { id: "lutris", name: "Lutris", ids: ["lutris", "net.lutris.lutris"], names: ["lutris"], bundles: [] },
  { id: "heroic", name: "Heroic Games Launcher", ids: ["heroic", "heroicgameslauncher", "com.heroicgameslauncher.hgl"], names: ["heroic games launcher", "heroic"], bundles: ["com.heroicgameslauncher.hgl"] },
  { id: "bottles", name: "Bottles", ids: ["bottles", "com.usebottles.bottles"], names: ["bottles"], bundles: [] },
  { id: "itch", name: "itch", ids: ["itch", "io.itch.itch", "itch-setup"], names: ["itch", "itch.io"], bundles: ["io.itch.mac"] },
  { id: "epic", name: "Epic Games Launcher", ids: ["epicgameslauncher", "com.epicgames.launcher"], names: ["epic games launcher"], bundles: ["com.epicgames.epicgameslauncher"] },
  { id: "gog", name: "GOG Galaxy", ids: ["gog-galaxy", "gogalaxy", "com.gog.galaxy"], names: ["gog galaxy"], bundles: ["com.gog.galaxy"] },
  { id: "battlenet", name: "Battle.net", ids: ["battle.net", "battlenet", "net.battle.app"], names: ["battle.net", "blizzard battle.net"], bundles: ["net.battle.app", "net.battle.bootstrapper"] },
  { id: "ea", name: "EA app", ids: ["ea-app", "eadesktop", "ea-desktop", "origin"], names: ["ea app", "ea desktop", "origin"], bundles: ["com.ea.eadesktop", "com.ea.origin"] },
  { id: "ubisoft", name: "Ubisoft Connect", ids: ["ubisoft-connect", "ubisoftconnect", "uplay"], names: ["ubisoft connect", "uplay"], bundles: ["com.ubisoft.uplay", "com.ubisoft.connect"] },
  { id: "rockstar", name: "Rockstar Games Launcher", ids: ["rockstar-games-launcher", "rockstargameslauncher"], names: ["rockstar games launcher"], bundles: ["com.rockstargames.launcher"] },
  { id: "amazon", name: "Amazon Games", ids: ["amazon-games", "amazongames"], names: ["amazon games"], bundles: ["com.amazon.games"] },
  { id: "jagex", name: "Jagex Launcher", ids: ["jagex-launcher", "jagexlauncher", "com.jagex.launcher", "com.adamcake.bolt", "bolt-launcher"], names: ["jagex launcher", "bolt launcher"], bundles: ["com.jagex.launcher"] },
  { id: "minecraft-bedrock", name: "Minecraft Bedrock Launcher", ids: ["mcpelauncher", "mcpelauncher-ui-qt", "io.mrarm.mcpelauncher"], names: ["minecraft bedrock launcher", "minecraft bedrock edition launcher", "mcpelauncher"], bundles: ["io.mrarm.mcpelauncher"] },
  { id: "minecraft", name: "Minecraft Launcher", ids: ["minecraft-launcher", "com.mojang.minecraft"], names: ["minecraft launcher"], bundles: ["com.mojang.minecraft", "com.mojang.minecraftlauncher"] },
  { id: "prism", name: "Prism Launcher", ids: ["prismlauncher", "prism-launcher", "org.prismlauncher.prismlauncher"], names: ["prism launcher"], bundles: ["org.prismlauncher.prismlauncher"] },
  { id: "multimc", name: "MultiMC", ids: ["multimc", "multimc5", "org.multimc.multimc"], names: ["multimc"], bundles: ["org.multimc.multimc"] },
  { id: "polymc", name: "PolyMC", ids: ["polymc", "org.polymc.polymc"], names: ["polymc"], bundles: ["org.polymc.polymc"] },
  { id: "fjord", name: "Fjord Launcher", ids: ["fjordlauncher", "fjord-launcher", "io.github.unmojang.fjordlauncher"], names: ["fjord launcher"], bundles: ["io.github.unmojang.fjordlauncher"] },
  { id: "modrinth-app", name: "Modrinth App", ids: ["modrinth-app", "modrinthapp", "theseus", "com.modrinth.modrinthapp", "com.modrinth.theseus"], names: ["modrinth app", "modrinth"], bundles: ["com.modrinth.theseus", "com.modrinth.modrinthapp"] },
  { id: "curseforge", name: "CurseForge", ids: ["curseforge", "com.overwolf.curseforge"], names: ["curseforge", "curseforge app"], bundles: ["com.overwolf.curseforge"] },
  { id: "gdlauncher", name: "GDLauncher", ids: ["gdlauncher", "gdlauncher-carbon", "io.gdl.gdlauncher"], names: ["gdlauncher", "gdlauncher carbon"], bundles: ["org.gorilladevs.gdlauncher"] },
  { id: "hmcl", name: "Hello Minecraft! Launcher", ids: ["hmcl", "org.jackhuang.hmcl"], names: ["hello minecraft! launcher", "hmcl"], bundles: ["org.jackhuang.hmcl"] },
  { id: "xmcl", name: "X Minecraft Launcher", ids: ["xmcl", "app.xmcl.voxelum"], names: ["x minecraft launcher", "xmcl"], bundles: ["xmcl"] },
  { id: "lunar", name: "Lunar Client", ids: ["lunarclient", "lunar-client", "com.moonsworth.client"], names: ["lunar client"], bundles: ["com.moonsworth.client"] },
  { id: "hytale", name: "Hytale Launcher", ids: ["hytale-launcher", "hytalelauncher", "com.hypixel.hytalelauncher", "com.hypixel.hytale-launcher"], names: ["hytale launcher"], bundles: ["com.hypixel.hytalelauncher"] },
  { id: "gamejolt", name: "Game Jolt Client", ids: ["game-jolt-client", "gamejolt", "com.gamejolt.client"], names: ["game jolt client", "game jolt"], bundles: ["com.gamejolt.client"] },
  { id: "emudeck", name: "EmuDeck", ids: ["emudeck"], names: ["emudeck"], bundles: [] },
  { id: "atlauncher", name: "ATLauncher", ids: ["atlauncher", "com.atlauncher.atlauncher"], names: ["atlauncher"], bundles: ["com.atlauncher.atlauncher"] },
  { id: "crossover", name: "CrossOver", ids: ["crossover", "com.codeweavers.crossover"], names: ["crossover"], bundles: ["com.codeweavers.crossover"] },
  { id: "whisky", name: "Whisky", ids: ["whisky"], names: ["whisky"], bundles: ["com.isaacmarovitz.whisky"] },
  { id: "retroarch", name: "RetroArch", ids: ["retroarch", "org.libretro.retroarch"], names: ["retroarch"], bundles: ["com.libretro.retroarch"] },
  { id: "esde", name: "ES-DE", ids: ["es-de", "org.es_de.frontend"], names: ["es-de", "emulationstation desktop edition"], bundles: ["org.es-de.emulationstation"] },
  { id: "pegasus", name: "Pegasus", ids: ["pegasus-fe", "pegasus-frontend", "org.pegasus_frontend.pegasus"], names: ["pegasus"], bundles: [] },
  { id: "minigalaxy", name: "Minigalaxy", ids: ["minigalaxy", "io.github.sharkwouter.minigalaxy"], names: ["minigalaxy"], bundles: [] },
  { id: "rare", name: "Rare", ids: ["rare", "io.github.dummerle.rare"], names: ["rare"], bundles: [] },
  { id: "faugus", name: "Faugus Launcher", ids: ["faugus-launcher", "io.github.faugus.faugus-launcher"], names: ["faugus launcher"], bundles: [] },
  { id: "cartridges", name: "Cartridges", ids: ["cartridges", "hu.kramo.cartridges", "page.kramo.cartridges"], names: ["cartridges"], bundles: [] },
  { id: "playonlinux", name: "PlayOnLinux", ids: ["playonlinux", "playonmac"], names: ["playonlinux", "playonmac"], bundles: [] },
  { id: "gamehub", name: "GameHub", ids: ["gamehub", "com.github.tkashkin.gamehub"], names: ["gamehub"], bundles: [] },
  { id: "sober", name: "Sober (Roblox)", ids: ["sober", "org.vinegarhq.sober"], names: ["sober"], bundles: [] },
  { id: "mocktail", name: "Mocktail (Roblox)", ids: ["mocktail", "space.bigrat.mocktail"], names: ["mocktail"], bundles: [] },
  { id: "vinegar", name: "Vinegar (Roblox Studio)", ids: ["vinegar", "org.vinegarhq.vinegar"], names: ["vinegar"], bundles: [] },
];

const byId = new Map(LAUNCHERS.map((def) => [def.id, def]));
export const launcherDef = (id?: string | null) => (id ? byId.get(id) : undefined);

const normalise = (value: string) => value.trim().toLowerCase().replace(/\.desktop$/, "");
const matchesKey = (candidate: string, key: string) =>
  candidate === key || (!key.includes(".") && candidate.includes(".") && candidate.slice(candidate.lastIndexOf(".") + 1) === key);

/** Same rules as the Rust `classify_launcher`: ids (exact or last dotted segment), exact display name, macOS bundle id. */
export function classifyLauncher(ids: string[], name: string, bundleId?: string): LauncherDef | undefined {
  const candidates = ids.map(normalise).filter(Boolean);
  const lower = name.trim().toLowerCase().replace(/\.app$/, "");
  const bundle = bundleId?.toLowerCase();
  return LAUNCHERS.find((def) => candidates.some((id) => def.ids.some((key) => matchesKey(id, key)))
    || def.names.includes(lower) || (bundle !== undefined && def.bundles.includes(bundle)));
}

/** Launch targets that start a game through its launcher (so the entry is a game, never the launcher itself). */
const GAME_TARGET = /^(steam:\/\/rungameid\/|mc-instance:\/\/|heroic:\/\/launch|lutris:rungameid\/|bottles:run\/|itch:\/\/(games|run-game)\/|legendary:\/\/launch\/|nile:\/\/launch\/|com\.epicgames\.launcher:\/\/apps\/|battlenet:|goggalaxy:)/i;

/** Ids a stored launch target says about the program: a desktop-entry stem, Flatpak id, bundle name or program name. */
export function targetIds(target: string | undefined): string[] {
  const value = (target ?? "").trim();
  if (!value) return [];
  if (/^steam:\/\/open\//i.test(value)) return ["steam"];
  const flatpak = /^flatpak:\/\/([\w.-]+)/i.exec(value) ?? /^flatpak\s+run\s+(?:--\S+\s+)*([\w.-]+)/i.exec(value);
  if (flatpak) return [flatpak[1]];
  if (/^[a-z][\w+.-]*:/i.test(value)) return [];
  const file = value.split(/\s+/)[0].replace(/\/+$/, "").split("/").pop() ?? "";
  return [file.replace(/\.(desktop|app|AppImage|sh)$/i, "")].filter(Boolean);
}

/** The launcher a library entry is, if any. Games started through a launcher (rungameid, ...) never match. */
export function launcherForPiko(piko: Pick<Piko, "name" | "executablePath" | "sourceId">): LauncherDef | undefined {
  const target = piko.executablePath ?? "";
  if (GAME_TARGET.test(target.trim())) return undefined;
  return classifyLauncher(targetIds(target), piko.name);
}
