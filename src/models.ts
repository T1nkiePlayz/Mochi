export type Tofu = {
  id: string;
  name: string;
  version: string;
  runtime: string;
  mods: number;
  status: "Ready" | "Needs attention";
};

export type Piko = {
  id: string;
  name: string;
  description: string;
  accent: string;
  artwork: string;
  artworkUrl?: string;
  executablePath?: string;
  source?: "built-in" | "custom";
  sourceId?: "flatpak" | "heroic" | "steam" | "lutris" | "bottles" | "itch";
  categories?: string[];
  tofus: Tofu[];
};

export type ThemeId = "mochi" | "minecraft" | "subnautica" | "dungeons";
