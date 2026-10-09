export type ImportSourceId = "flatpak" | "heroic" | "steam" | "lutris" | "bottles" | "itch" | "apps" | "epic" | "whisky" | "battlenet" | "gog" | "prism";

/** How a Tofu starts its Piko. Passed to the native launcher on every launch. */
export type TofuLaunchConfig = {
  /** Compatibility runtime id from `list_runtimes` (Wine, Proton, ...). */
  runtime?: string;
  /** Wrapper ids from `list_runtimes` (GameMode, MangoHud, ...). */
  wrappers: string[];
  /** Command-line arguments, one shell-style string. */
  args: string;
  /** Environment variables, one KEY=value per line. */
  env: string;
  workingDir?: string;
};

/** A saved set of enabled mods for a Tofu folder. */
export type ModProfile = {
  id: string;
  name: string;
  /** Mod file names (without `.disabled`) that are enabled in this profile. */
  files: string[];
};

/** Mod loader of a Minecraft Tofu. */
export type ModLoader = "vanilla" | "fabric" | "quilt" | "forge" | "neoforge";

export type Tofu = {
  id: string;
  name: string;
  version: string;
  runtime: string;
  mods: number;
  status: "Ready" | "Needs attention";
  path?: string;
  launch?: TofuLaunchConfig;
  profiles?: ModProfile[];
  activeProfileId?: string;
  /** Unpack .zip downloads into the folder (for games whose mods are archives, not single files). */
  extractArchives?: boolean;
  /** Minecraft: which loader this Tofu runs (the game version is `version`). */
  loader?: ModLoader;
  /**
   * The folder the game itself loads mods from. When it differs from `path` (the Tofu's own saved mods),
   * the Tofu's enabled mods are copied there when the game is launched; equal or unset means no sync.
   */
  gameDir?: string;
  /** Minecraft: the game folder holding `resourcepacks` and `shaderpacks`, synced like `gameDir`. */
  contentRoot?: string;
  /** Opt-in: at launch, replace same-named files in the game folder that Mochi did not put there (off: they are left alone). */
  syncReplaceExisting?: boolean;
  /** When Mochi last read this Tofu's mod folder after an import; `identified` is false when the sites could not be asked (offline). */
  modScan?: { at: number; identified: boolean };
  /** Minecraft instance: the launch target (`mc-instance://<launcher>/<id>`) that starts exactly this instance; overrides the Piko's. */
  launchTarget?: string;
  /** Minecraft instance: the instance folder on this device (used to follow its process). Never synced. */
  installPath?: string;
  /** Own cover of this Tofu (kept from a Minecraft instance that used to be a Piko of its own). */
  artwork?: string;
  artworkCacheKey?: string;
  /** Id of the Piko this Tofu was before the Minecraft instances were merged into one Piko; playtime of that id counts for the Minecraft Piko. */
  legacyPikoId?: string;
  /** Tofu id whose installed-mod records are copied into this Tofu once (then cleared); set by the Minecraft merge. */
  legacyTofuId?: string;
};

export type TrailerVideo = { name: string; thumbnail?: string; mp4?: string; webm?: string; hls?: string };

export type Piko = {
  id: string;
  name: string;
  description: string;
  accent: string;
  artwork: string;
  artworkUrl?: string;
  artworkCacheKey?: string;
  /** A game, or a launcher (Steam, Lutris, ...) kept in the library as a shortcut. */
  kind?: "game" | "launcher";
  /** Which known launcher a launcher entry is (`src/lib/launchers.ts`), for its artwork and company logo. */
  launcherId?: string;
  /** Id of the import item this entry came from (`ImportedGame.id`); keys the user's game/launcher override. */
  importKey?: string;
  igdbId?: number;
  screenshots?: string[];
  trailerId?: string;
  /** Steam store trailers a plain `<video>` can play (direct mp4/webm, or an HLS playlist). */
  trailerVideos?: TrailerVideo[];
  firstReleaseDate?: number;
  platformCategory?: string;
  executablePath?: string;
  /** Where the game is installed on this device; used to follow its process. Never synced. */
  installPath?: string;
  source?: "built-in" | "custom";
  sourceId?: ImportSourceId;
  categories?: string[];
  /** User-assigned labels, searchable and usable as filters. */
  tags?: string[];
  /** Pinned to the top of the library and the Favourites filter. */
  favorite?: boolean;
  /** Ids of the user's collections this game belongs to. */
  collectionIds?: string[];
  /** Where the artwork came from, so a refresh does not overwrite a user's own image. */
  artworkSource?: "igdb" | "steamgriddb" | "steam" | "custom" | "icon";
  /** Metadata the user edited by hand; automatic refreshes leave these alone. */
  lockedFields?: Array<"name" | "description" | "artwork" | "categories">;
  /** Which mod sites this game is linked to (ids and slugs only; user data, not cached site content). */
  modLinks?: {
    curseforge?: { gameId: number; slug: string; name: string };
    nexus?: { domain: string; name: string };
    minecraft?: boolean;
    source: "auto" | "user";
  };
  tofus: Tofu[];
};

export type Collection = { id: string; name: string; icon?: string };
