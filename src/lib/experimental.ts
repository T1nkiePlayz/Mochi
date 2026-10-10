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
  { id: "game-news", name: "Game news", description: "A News tab in the notification centre with the latest Steam news for your Steam games and updates for your installed mods. Checks at most every 6 hours while Mochi is open.", since: "0.1.0" },
  { id: "deal-alerts", name: "Deal alerts", description: "Free games and sales for the stores you use (Epic, CheapShark), plus price-watch alerts for wishlist games. Metadata only, checked at most every 6 hours.", since: "0.1.0" },
];

export const experimentalIds = () => experimentalFeatures.map((feature) => feature.id);
