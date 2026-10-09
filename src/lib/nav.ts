/** Display names of the main navigation pages. The ids (`NavId`) stay stable because themes, icons and shortcuts use them. */
const labels: Record<string, string> = {
  // The page lists every Tofu's mods, disk use and updates, not "installed games", so it is named for what it shows.
  Installed: "Mods & Content",
};

export const navLabel = (id: string): string => labels[id] ?? id;
