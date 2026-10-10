//! Decides whether a discovered application is a game, a game launcher, or Mochi
//! itself / a system tool that should never be offered for import.
//!
//! Everything here is pure string matching so it behaves the same on every
//! platform and can be unit-tested with fixtures.

/// A well-known launcher. `ids` match desktop-entry ids, Flatpak ids and the
/// program an entry executes (exact match, or the last dotted segment); `names`
/// match the display name exactly; `bundles` are macOS bundle identifiers.
pub struct LauncherDef {
    pub id: &'static str,
    pub name: &'static str,
    pub ids: &'static [&'static str],
    pub names: &'static [&'static str],
    pub bundles: &'static [&'static str],
}

macro_rules! launcher {
    ($id:expr, $name:expr, [$($i:expr),*], [$($n:expr),*], [$($b:expr),*]) => {
        LauncherDef { id: $id, name: $name, ids: &[$($i),*], names: &[$($n),*], bundles: &[$($b),*] }
    };
}

pub const LAUNCHERS: &[LauncherDef] = &[
    launcher!("steam", "Steam", ["steam", "steam-native", "com.valvesoftware.steam"], ["steam"], ["com.valvesoftware.steam"]),
    launcher!("lutris", "Lutris", ["lutris", "net.lutris.lutris"], ["lutris"], []),
    launcher!("heroic", "Heroic Games Launcher", ["heroic", "heroicgameslauncher", "com.heroicgameslauncher.hgl"], ["heroic games launcher", "heroic"], ["com.heroicgameslauncher.hgl"]),
    launcher!("bottles", "Bottles", ["bottles", "com.usebottles.bottles"], ["bottles"], []),
    launcher!("itch", "itch", ["itch", "io.itch.itch", "itch-setup"], ["itch", "itch.io"], ["io.itch.mac"]),
    launcher!("epic", "Epic Games Launcher", ["epicgameslauncher", "com.epicgames.launcher"], ["epic games launcher"], ["com.epicgames.epicgameslauncher"]),
    launcher!("gog", "GOG Galaxy", ["gog-galaxy", "gogalaxy", "com.gog.galaxy"], ["gog galaxy"], ["com.gog.galaxy"]),
    launcher!("battlenet", "Battle.net", ["battle.net", "battlenet", "net.battle.app"], ["battle.net", "blizzard battle.net"], ["net.battle.app", "net.battle.bootstrapper"]),
    launcher!("ea", "EA app", ["ea-app", "eadesktop", "ea-desktop", "origin"], ["ea app", "ea desktop", "origin"], ["com.ea.eadesktop", "com.ea.origin"]),
    launcher!("ubisoft", "Ubisoft Connect", ["ubisoft-connect", "ubisoftconnect", "uplay"], ["ubisoft connect", "uplay"], ["com.ubisoft.uplay", "com.ubisoft.connect"]),
    launcher!("rockstar", "Rockstar Games Launcher", ["rockstar-games-launcher", "rockstargameslauncher"], ["rockstar games launcher"], ["com.rockstargames.launcher"]),
    launcher!("amazon", "Amazon Games", ["amazon-games", "amazongames"], ["amazon games"], ["com.amazon.games"]),
    launcher!("jagex", "Jagex Launcher", ["jagex-launcher", "jagexlauncher", "com.jagex.launcher", "com.adamcake.bolt", "bolt-launcher"], ["jagex launcher", "bolt launcher"], ["com.jagex.launcher"]),
    launcher!("minecraft-bedrock", "Minecraft Bedrock Launcher", ["mcpelauncher", "mcpelauncher-ui-qt", "io.mrarm.mcpelauncher"], ["minecraft bedrock launcher", "minecraft bedrock edition launcher", "mcpelauncher"], ["io.mrarm.mcpelauncher"]),
    launcher!("minecraft", "Minecraft Launcher", ["minecraft-launcher", "com.mojang.minecraft"], ["minecraft launcher"], ["com.mojang.minecraft", "com.mojang.minecraftlauncher"]),
    launcher!("prism", "Prism Launcher", ["prismlauncher", "prism-launcher", "org.prismlauncher.prismlauncher"], ["prism launcher"], ["org.prismlauncher.prismlauncher"]),
    launcher!("multimc", "MultiMC", ["multimc", "multimc5", "org.multimc.multimc"], ["multimc"], ["org.multimc.multimc"]),
    launcher!("polymc", "PolyMC", ["polymc", "org.polymc.polymc"], ["polymc"], ["org.polymc.polymc"]),
    launcher!("fjord", "Fjord Launcher", ["fjordlauncher", "fjord-launcher", "io.github.unmojang.fjordlauncher"], ["fjord launcher"], ["io.github.unmojang.fjordlauncher"]),
    launcher!("modrinth-app", "Modrinth App", ["modrinth-app", "modrinthapp", "theseus", "com.modrinth.modrinthapp", "com.modrinth.theseus"], ["modrinth app", "modrinth"], ["com.modrinth.theseus", "com.modrinth.modrinthapp"]),
    launcher!("curseforge", "CurseForge", ["curseforge", "com.overwolf.curseforge"], ["curseforge", "curseforge app"], ["com.overwolf.curseforge"]),
    launcher!("gdlauncher", "GDLauncher", ["gdlauncher", "gdlauncher-carbon", "io.gdl.gdlauncher"], ["gdlauncher", "gdlauncher carbon"], ["org.gorilladevs.gdlauncher"]),
    launcher!("hmcl", "Hello Minecraft! Launcher", ["hmcl", "org.jackhuang.hmcl"], ["hello minecraft! launcher", "hmcl"], ["org.jackhuang.hmcl"]),
    launcher!("xmcl", "X Minecraft Launcher", ["xmcl", "app.xmcl.voxelum"], ["x minecraft launcher", "xmcl"], ["xmcl"]),
    launcher!("lunar", "Lunar Client", ["lunarclient", "lunar-client", "com.moonsworth.client"], ["lunar client"], ["com.moonsworth.client"]),
    launcher!("hytale", "Hytale Launcher", ["hytale-launcher", "hytalelauncher", "com.hypixel.hytalelauncher", "com.hypixel.hytale-launcher"], ["hytale launcher"], ["com.hypixel.hytalelauncher"]),
    launcher!("gamejolt", "Game Jolt Client", ["game-jolt-client", "gamejolt", "com.gamejolt.client"], ["game jolt client", "game jolt"], ["com.gamejolt.client"]),
    launcher!("emudeck", "EmuDeck", ["emudeck"], ["emudeck"], []),
    launcher!("atlauncher", "ATLauncher", ["atlauncher", "com.atlauncher.atlauncher"], ["atlauncher"], ["com.atlauncher.atlauncher"]),
    launcher!("crossover", "CrossOver", ["crossover", "com.codeweavers.crossover"], ["crossover"], ["com.codeweavers.crossover"]),
    launcher!("whisky", "Whisky", ["whisky"], ["whisky"], ["com.isaacmarovitz.whisky"]),
    launcher!("retroarch", "RetroArch", ["retroarch", "org.libretro.retroarch"], ["retroarch"], ["com.libretro.retroarch"]),
    launcher!("esde", "ES-DE", ["es-de", "org.es_de.frontend"], ["es-de", "emulationstation desktop edition"], ["org.es-de.emulationstation"]),
    launcher!("pegasus", "Pegasus", ["pegasus-fe", "pegasus-frontend", "org.pegasus_frontend.pegasus"], ["pegasus"], []),
    launcher!("minigalaxy", "Minigalaxy", ["minigalaxy", "io.github.sharkwouter.minigalaxy"], ["minigalaxy"], []),
    launcher!("rare", "Rare", ["rare", "io.github.dummerle.rare"], ["rare"], []),
    launcher!("faugus", "Faugus Launcher", ["faugus-launcher", "io.github.faugus.faugus-launcher"], ["faugus launcher"], []),
    launcher!("cartridges", "Cartridges", ["cartridges", "hu.kramo.cartridges", "page.kramo.cartridges"], ["cartridges"], []),
    launcher!("playonlinux", "PlayOnLinux", ["playonlinux", "playonmac"], ["playonlinux", "playonmac"], []),
    launcher!("gamehub", "GameHub", ["gamehub", "com.github.tkashkin.gamehub"], ["gamehub"], []),
    launcher!("sober", "Sober (Roblox)", ["sober", "org.vinegarhq.sober"], ["sober"], []),
    launcher!("mocktail", "Mocktail (Roblox)", ["mocktail", "space.bigrat.mocktail"], ["mocktail"], []),
    launcher!("vinegar", "Vinegar (Roblox Studio)", ["vinegar", "org.vinegarhq.vinegar"], ["vinegar"], []),
];

/// Sources whose own scan already emits a launcher entry, so the generic
/// "applications" scan must not list them a second time.
pub const SOURCE_OWNED_LAUNCHERS: &[&str] = &["steam"];

fn matches_key(candidate: &str, key: &str) -> bool {
    candidate == key || (!key.contains('.') && candidate.rsplit_once('.').is_some_and(|(_, last)| last == key))
}

fn normalise(value: &str) -> String {
    let value = value.trim().to_lowercase();
    value.strip_suffix(".desktop").map(str::to_owned).unwrap_or(value)
}

pub fn launcher_def(id: &str) -> Option<&'static LauncherDef> { LAUNCHERS.iter().find(|def| def.id == id) }

/// Matches a desktop-entry id, Flatpak id, executed program or macOS bundle id.
pub fn classify_launcher(ids: &[&str], name: &str, bundle_id: Option<&str>) -> Option<&'static LauncherDef> {
    let ids: Vec<String> = ids.iter().map(|id| normalise(id)).filter(|id| !id.is_empty()).collect();
    let name = name.trim().to_lowercase();
    let name = name.strip_suffix(".app").unwrap_or(&name);
    let bundle = bundle_id.map(str::to_lowercase);
    LAUNCHERS.iter().find(|def| {
        ids.iter().any(|id| def.ids.iter().any(|key| matches_key(id, key)))
            || def.names.contains(&name)
            || bundle.as_deref().is_some_and(|b| def.bundles.contains(&b))
    })
}

/// Mochi's own identifiers, as used by the desktop entry, Flatpak and the bundle.
const MOCHI_IDS: &[&str] = &["mochi", "mochilauncher", "dev.sidequestgames.mochilauncher"];

/// True when an entry is Mochi itself (never offered as a game).
pub fn is_mochi(ids: &[&str], name: &str, bundle_id: Option<&str>, own_exe: Option<&std::path::Path>, exec_path: Option<&str>) -> bool {
    let ids_hit = ids.iter().map(|id| normalise(id)).any(|id| MOCHI_IDS.contains(&id.as_str()) || id.starts_with("dev.sidequestgames."));
    let name_hit = name.trim().eq_ignore_ascii_case("mochi") || name.trim().eq_ignore_ascii_case("mochi launcher");
    let bundle_hit = bundle_id.is_some_and(|b| b.to_lowercase().starts_with("dev.sidequestgames."));
    let exe_hit = match (own_exe, exec_path) {
        (Some(own), Some(path)) => {
            let path = std::path::Path::new(path);
            path == own || path.canonicalize().ok().zip(own.canonicalize().ok()).is_some_and(|(a, b)| a == b)
        }
        _ => false,
    };
    ids_hit || name_hit || bundle_hit || exe_hit
}

/// Helpers and compatibility tools that carry the Game category but are not games.
const NON_GAME_IDS: &[&str] = &[
    "protontricks", "protonup-qt", "net.davidotek.pupgui2", "com.github.matoking.protontricks", "goverlay", "io.github.benjamimgois.goverlay",
    "steamtinkerlaunch", "gamemode", "gamemoded", "mangohud", "wine", "winecfg", "winefile", "winetricks", "protonplus", "com.vysp3r.protonplus",
    "steam-runtime", "steamlink", "gamescope", "lutris-wine", "sc-controller", "antimicrox", "org.antimicrox.antimicrox", "jstest-gtk",
    "piper", "oversteer", "com.github.wwmm.easyeffects", "obs", "com.obsproject.studio", "discord", "com.discordapp.discord",
];

pub fn is_non_game(ids: &[&str], name: &str) -> bool {
    let lower = name.trim().to_lowercase();
    ids.iter().map(|id| normalise(id)).any(|id| id.starts_with("wine-") || NON_GAME_IDS.iter().any(|key| matches_key(&id, key)))
        || lower.starts_with("wine ") || lower.starts_with("proton ") || lower.contains("steam linux runtime")
}

/// The program an `Exec=` line runs, as a lowercase base name. Understands
/// `env VAR=x`, `flatpak run [--opt] APP-ID` and absolute paths.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub fn exec_program(exec: &str) -> Option<String> {
    let mut tokens = exec.split_whitespace().map(|t| t.trim_matches('"'));
    let mut first = tokens.next()?;
    if first.rsplit('/').next() == Some("env") {
        first = tokens.find(|t| !t.contains('=') && !t.starts_with('-'))?;
    }
    if first.rsplit('/').next() == Some("flatpak") {
        let id = tokens.skip_while(|t| *t == "run").find(|t| !t.starts_with('-'))?;
        return Some(id.to_lowercase());
    }
    first.rsplit('/').next().map(str::to_lowercase).filter(|p| !p.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn exec_program_handles_wrappers() {
        assert_eq!(exec_program("/usr/bin/steam %U").as_deref(), Some("steam"));
        assert_eq!(exec_program("env FOO=1 /opt/Game/start.sh").as_deref(), Some("start.sh"));
        assert_eq!(exec_program("flatpak run --branch=stable com.heroicgameslauncher.hgl @@u %U @@").as_deref(), Some("com.heroicgameslauncher.hgl"));
        assert_eq!(exec_program(""), None);
    }

    #[test]
    fn known_launchers_are_recognised_by_id_name_and_bundle() {
        let id = |ids: &[&str], name: &str, bundle: Option<&str>| classify_launcher(ids, name, bundle).map(|d| d.id);
        assert_eq!(id(&["steam.desktop"], "Steam", None), Some("steam"));
        assert_eq!(id(&["com.valvesoftware.Steam.desktop"], "Steam", None), Some("steam"));
        assert_eq!(id(&["net.lutris.Lutris"], "Lutris", None), Some("lutris"));
        assert_eq!(id(&["com.heroicgameslauncher.hgl"], "Heroic Games Launcher", None), Some("heroic"));
        assert_eq!(id(&["com.usebottles.bottles"], "Bottles", None), Some("bottles"));
        assert_eq!(id(&["io.mrarm.mcpelauncher"], "Minecraft Bedrock Launcher", None), Some("minecraft-bedrock"));
        assert_eq!(id(&["org.prismlauncher.PrismLauncher"], "Prism Launcher", None), Some("prism"));
        assert_eq!(id(&["com.jagex.Launcher"], "Jagex Launcher", None), Some("jagex"));
        assert_eq!(id(&[], "Epic Games Launcher.app", Some("com.epicgames.EpicGamesLauncher")), Some("epic"));
        assert_eq!(id(&[], "Whisky", Some("com.isaacmarovitz.Whisky")), Some("whisky"));
        assert_eq!(id(&["battle.net"], "Battle.net", None), Some("battlenet"));
        assert_eq!(id(&["com.hypixel.HytaleLauncher"], "Hytale Launcher", None), Some("hytale"));
        assert_eq!(id(&[], "Hytale Launcher", None), Some("hytale"));
        assert_eq!(id(&["com.modrinth.ModrinthApp"], "Modrinth App", None), Some("modrinth-app"));
        assert_eq!(id(&[], "GOG Galaxy.app", Some("com.gog.galaxy")), Some("gog"));
        assert_eq!(id(&["steam-native.desktop"], "Steam (Native)", None), Some("steam"));
        assert_eq!(id(&["io.github.unmojang.FjordLauncher"], "Fjord Launcher", None), Some("fjord"));
        assert_eq!(id(&["org.vinegarhq.Sober"], "Sober", None), Some("sober"));
        assert_eq!(id(&["org.vinegarhq.Vinegar"], "Vinegar", None), Some("vinegar"));
    }

    #[test]
    fn games_are_not_mistaken_for_launchers() {
        assert!(classify_launcher(&["steam_app_220"], "Half-Life 2", None).is_none());
        assert!(classify_launcher(&["org.supertuxproject.SuperTux"], "SuperTux", None).is_none());
        assert!(classify_launcher(&["minecraft"], "Minecraft", None).is_none());
        assert!(classify_launcher(&["rarefaction"], "Rarefaction", None).is_none());
        // The game itself is not its launcher.
        assert!(classify_launcher(&["hytale"], "Hytale", None).is_none());
    }

    #[test]
    fn mochi_is_excluded_in_every_form() {
        assert!(is_mochi(&["mochi.desktop"], "Mochi", None, None, None));
        assert!(is_mochi(&["dev.sidequestgames.Mochilauncher"], "Anything", None, None, None));
        assert!(is_mochi(&["x"], "Mochi", None, None, None));
        assert!(is_mochi(&["x"], "Other", Some("dev.sidequestgames.Mochilauncher"), None, None));
        assert!(is_mochi(&["x"], "Other", None, Some(Path::new("/opt/mochi/bin/mochi")), Some("/opt/mochi/bin/mochi")));
        assert!(!is_mochi(&["mochi-tea"], "Mochi Tea Simulator", None, None, None));
        assert!(!is_mochi(&["org.example.Game"], "Super Game", None, None, Some("/usr/bin/game")));
    }

    #[test]
    fn system_tools_are_not_games() {
        assert!(is_non_game(&["protontricks.desktop"], "Protontricks"));
        assert!(is_non_game(&["winecfg"], "Wine Configuration"));
        assert!(is_non_game(&["x"], "Steam Linux Runtime 3.0"));
        assert!(!is_non_game(&["org.supertuxproject.SuperTux"], "SuperTux"));
    }
}
