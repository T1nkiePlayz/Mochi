export type ImportSourceId = "flatpak" | "heroic" | "steam" | "lutris" | "bottles" | "itch" | "apps";

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
};

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
  igdbId?: number;
  screenshots?: string[];
  trailerId?: string;
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
  artworkSource?: "igdb" | "steamgriddb" | "steam" | "custom";
  /** Metadata the user edited by hand; automatic refreshes leave these alone. */
  lockedFields?: Array<"name" | "description" | "artwork" | "categories">;
  tofus: Tofu[];
};

export type Collection = { id: string; name: string; icon?: string };
