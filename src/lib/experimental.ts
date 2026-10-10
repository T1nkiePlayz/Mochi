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

export const experimentalFeatures: ExperimentalFeature[] = [
  { id: "plugins", name: "Plugins", description: "Run small plugins from the plugins folder that add command palette commands. Plugins run in a restricted sandbox without network access, but only install plugins you trust.", since: "1.0" },
];

export const experimentalIds = () => experimentalFeatures.map((feature) => feature.id);
