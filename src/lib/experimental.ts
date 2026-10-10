/**
 * Experimental feature registry.
 *
 * To ship something unfinished, add an entry here and gate the UI with
 * `useExperimental("your-id")`. Settings > Experimental lists every registered
 * feature with its own toggle and marks features the user has not seen yet as
 * "New". When a feature graduates, delete its entry and remove the gate: nothing
 * else needs to change. With an empty registry the whole section is hidden.
 */
export type ExperimentalFeature = {
  id: string;
  name: string;
  description: string;
  /** Mochi version that introduced the flag; shown in the settings list. */
  since: string;
};

export const experimentalFeatures: ExperimentalFeature[] = [];

export const experimentalIds = () => experimentalFeatures.map((feature) => feature.id);
