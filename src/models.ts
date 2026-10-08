export type Tofu = {
  id: string;
  name: string;
  version: string;
  runtime: string;
  mods: number;
  status: "Ready" | "Needs attention";
  path?: string;
};

export type Piko = {
  id: string;
  name: string;
  description: string;
  accent: string;
  artwork: string;
  artworkUrl?: string;
  artworkCacheKey?: string;
  igdbId?: number;
  screenshots?: string[];
  trailerId?: string;
  firstReleaseDate?: number;
  platformCategory?: string;
  executablePath?: string;
  source?: "built-in" | "custom";
  sourceId?: "flatpak" | "heroic" | "steam" | "lutris" | "bottles" | "itch";
  categories?: string[];
  tofus: Tofu[];
};
