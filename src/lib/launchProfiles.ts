import type { LaunchOptions, LaunchProfile, Piko } from "../models";

export const MAX_LAUNCH_PROFILES = 10;

type WithProfiles = Pick<Piko, "launchOptions" | "launchProfiles" | "activeLaunchProfile">;

export const activeLaunchProfile = (piko: WithProfiles): LaunchProfile | undefined => piko.launchProfiles?.find((profile) => profile.id === piko.activeLaunchProfile);

/** The launch options a start uses: the active profile when there is one, otherwise the game's own options. */
export const effectiveLaunchOptions = (piko: WithProfiles): LaunchOptions | undefined => activeLaunchProfile(piko)?.options ?? piko.launchOptions;

const cleanName = (name: string) => name.trim().slice(0, 40);
const unique = (name: string, profiles: LaunchProfile[]) => {
  let candidate = name, count = 2;
  while (profiles.some((profile) => profile.name.toLowerCase() === candidate.toLowerCase())) candidate = `${name} ${count++}`;
  return candidate;
};

/** Adds a profile that starts as a copy of what the game uses now, and makes it the active one. */
export function addLaunchProfile(piko: WithProfiles, name: string, id: string = `lp-${crypto.randomUUID()}`): Pick<Piko, "launchProfiles" | "activeLaunchProfile"> {
  const profiles = piko.launchProfiles ?? [];
  const trimmed = cleanName(name);
  if (!trimmed || profiles.length >= MAX_LAUNCH_PROFILES) return { launchProfiles: piko.launchProfiles, activeLaunchProfile: piko.activeLaunchProfile };
  const options = structuredClone(effectiveLaunchOptions(piko) ?? { env: [], args: [] });
  return { launchProfiles: [...profiles, { id, name: unique(trimmed, profiles), options }], activeLaunchProfile: id };
}

export function renameLaunchProfile(piko: WithProfiles, id: string, name: string): LaunchProfile[] | undefined {
  const trimmed = cleanName(name);
  if (!trimmed) return piko.launchProfiles;
  const others = (piko.launchProfiles ?? []).filter((profile) => profile.id !== id);
  return piko.launchProfiles?.map((profile) => (profile.id === id ? { ...profile, name: unique(trimmed, others) } : profile));
}

/** Removes a profile; the game goes back to its own options when the active one was removed. Nothing stored when no profile is left. */
export function removeLaunchProfile(piko: WithProfiles, id: string): Pick<Piko, "launchProfiles" | "activeLaunchProfile"> {
  const left = (piko.launchProfiles ?? []).filter((profile) => profile.id !== id);
  return { launchProfiles: left.length ? left : undefined, activeLaunchProfile: piko.activeLaunchProfile === id ? undefined : piko.activeLaunchProfile };
}

/** Switches the active profile (`undefined` = the game's own options). An unknown id is ignored. */
export const selectLaunchProfile = (piko: WithProfiles, id: string | undefined): string | undefined => (id && piko.launchProfiles?.some((profile) => profile.id === id) ? id : undefined);

/** Writes new options into the active profile (or the game itself when none is active). */
export function withLaunchOptions(piko: WithProfiles, options: LaunchOptions | undefined): Pick<Piko, "launchOptions" | "launchProfiles"> {
  const active = activeLaunchProfile(piko);
  if (!active) return { launchOptions: options, launchProfiles: piko.launchProfiles };
  return { launchOptions: piko.launchOptions, launchProfiles: piko.launchProfiles!.map((profile) => (profile.id === active.id ? { ...profile, options: options ?? { env: [], args: [] } } : profile)) };
}
