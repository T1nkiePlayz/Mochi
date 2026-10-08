import type { Collection, Piko } from "../../../models";
import type { PlatformCapabilities } from "../../../lib/platform";
import type { ArtworkSelection } from "../../artwork/ArtworkPicker";

export type LockedField = NonNullable<Piko["lockedFields"]>[number];

export type EditorContext = {
  game: Piko;
  draft: Piko;
  capabilities: PlatformCapabilities | null;
  collections: Collection[];
  tagSuggestions: string[];
  /** Apply changes to the draft. `lock` marks a hand-edited field so automatic refreshes keep it. */
  patch: (changes: Partial<Piko>, lock?: LockedField) => void;
  unlock: (field: LockedField) => void;
  createCollection: (name: string) => Collection | null;
  artwork: ArtworkSelection | null;
  setArtwork: (selection: ArtworkSelection | null) => void;
  artworkReset: boolean;
  setArtworkReset: (value: boolean) => void;
  hasIgdb: boolean;
  refreshGame?: (piko: Piko) => Promise<unknown> | unknown;
};
