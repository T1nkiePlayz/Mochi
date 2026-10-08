import { useApp } from "./AppContext";
import { experimentalFeatures, type ExperimentalFeature } from "../lib/experimental";

/** True when the user has switched the experimental feature `id` on. Unknown ids are always off. */
export function useExperimental(id: string): boolean {
  const { behavior } = useApp();
  return experimentalFeatures.some((feature) => feature.id === id) && behavior.experimental.includes(id);
}

export type ExperimentalStatus = {
  features: ExperimentalFeature[];
  enabled: string[];
  /** Registered features the user has not been shown yet. */
  unseen: string[];
  unseenCount: number;
  setEnabled: (id: string, enabled: boolean) => void;
  markSeen: () => void;
};

/** Registry plus the user's choices; drives Settings > Experimental and the "New" dot on the nav. */
export function useExperimentalStatus(): ExperimentalStatus {
  const { behavior, setBehavior } = useApp();
  const known = new Set(experimentalFeatures.map((feature) => feature.id));
  const enabled = behavior.experimental.filter((id) => known.has(id));
  const unseen = experimentalFeatures.filter((feature) => !behavior.experimentalSeen.includes(feature.id)).map((feature) => feature.id);
  return {
    features: experimentalFeatures,
    enabled,
    unseen,
    unseenCount: unseen.length,
    setEnabled: (id, on) => setBehavior({ ...behavior, experimental: on ? [...new Set([...behavior.experimental, id])] : behavior.experimental.filter((item) => item !== id) }),
    markSeen: () => {
      if (!unseen.length) return;
      setBehavior({ ...behavior, experimentalSeen: [...new Set([...behavior.experimentalSeen, ...experimentalFeatures.map((feature) => feature.id)])] });
    },
  };
}
