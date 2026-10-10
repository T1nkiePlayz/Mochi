import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import type { Piko } from "../models";
import { dismissPairs, findDuplicates, mergeGame, pickPrimary, readDismissed, unmergeGame, writeDismissed, type DuplicateGroup } from "../lib/duplicates";
import { mergedIds } from "../lib/launchSources";

/** Duplicate detection over the library plus the merge / "not the same" / unmerge actions. Never deletes anything. */
export function useDuplicates(library: Piko[], setLibrary: Dispatch<SetStateAction<Piko[]>>) {
  const [dismissed, setDismissed] = useState<Set<string>>(readDismissed);
  const groups = useMemo(() => findDuplicates(library, dismissed), [library, dismissed]);
  const remember = useCallback((ids: string[]) => setDismissed((current) => { const next = dismissPairs(current, ids); writeDismissed(next); return next; }), []);

  /** Merges the chosen members of a group (at least two) into the one with the best metadata. */
  const merge = useCallback((group: DuplicateGroup, memberIds: string[]) => {
    const chosen = group.members.filter((piko) => memberIds.includes(piko.id));
    if (chosen.length < 2) return;
    const primary = pickPrimary(chosen).id;
    setLibrary((current) => mergeGame(current, primary, chosen.map((piko) => piko.id)));
  }, [setLibrary]);

  const dismiss = useCallback((group: DuplicateGroup) => remember(group.members.map((piko) => piko.id)), [remember]);

  /** Restores the folded games (one, or all); they are not offered for merging again. */
  const unmerge = useCallback((primaryId: string, sourceId?: string) => {
    const primary = library.find((piko) => piko.id === primaryId);
    if (!primary?.mergedFrom) return;
    const restored = (sourceId ? primary.mergedFrom.filter((piko) => piko.id === sourceId) : primary.mergedFrom).flatMap((piko) => [piko.id, ...mergedIds(piko)]);
    remember([primaryId, ...restored]);
    setLibrary((current) => unmergeGame(current, primaryId, sourceId));
  }, [library, setLibrary, remember]);

  return { groups, merge, dismiss, unmerge };
}

export type DuplicatesState = ReturnType<typeof useDuplicates>;
