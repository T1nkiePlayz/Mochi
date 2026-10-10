import type { LaunchSource, Piko } from "../models";

type WithSources = Pick<Piko, "executablePath"> & Partial<Pick<Piko, "launchSources" | "preferredSource" | "installPath">>;

/** The ways to start a merged game; empty for an ordinary one. */
export const launchSourcesOf = (piko: Pick<Piko, "launchSources">): LaunchSource[] => piko.launchSources ?? [];

/** The source "Play" uses: the preferred one if it still exists, else the first. Undefined for an ordinary game. */
export const activeSource = (piko: Pick<Piko, "launchSources" | "preferredSource">): LaunchSource | undefined => {
  const sources = launchSourcesOf(piko);
  return sources.find((source) => source.id === piko.preferredSource) ?? sources[0];
};

/** What to start: the chosen source's target for a merged game, else the Piko's own. */
export const sourceTargetFor = (piko: WithSources): string | undefined => activeSource(piko)?.executablePath || piko.executablePath;

/** Where the game lives on disk, following the chosen source. */
export const sourceInstallPathFor = (piko: WithSources): string | undefined => { const source = activeSource(piko); return source ? source.installPath : piko.installPath; };

/** Ids of every Piko folded into this one, nested merges included. */
export function mergedIds(piko: Pick<Piko, "mergedFrom">): string[] {
  return (piko.mergedFrom ?? []).flatMap((member) => [member.id, ...mergedIds(member)]);
}
