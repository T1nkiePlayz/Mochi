import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { Collection, Piko } from "../models";
import { profileStorageKey, readJson, storageKeys, writeJson } from "../lib/storage";

/** Collections live next to the library: shared on this device, or per account when profiles are separate. */
export const collectionsKeyFor = (ownerKey: string) => (ownerKey.startsWith("profiles:") ? profileStorageKey(ownerKey.slice("profiles:".length), "collections") : storageKeys.collections);

const clean = (value: unknown): Collection[] => Array.isArray(value)
  ? value.filter((item): item is Collection => Boolean(item) && typeof (item as Collection).id === "string" && typeof (item as Collection).name === "string")
  : [];

/** User collections (name, optional emoji, order = array order), stored locally per profile. */
export function useCollections(ownerKey: string, ready: boolean, setLibrary: Dispatch<SetStateAction<Piko[]>>) {
  const storeKey = collectionsKeyFor(ownerKey);
  const [state, setState] = useState<{ key: string; items: Collection[] }>({ key: "", items: [] });

  useEffect(() => { if (ready) setState({ key: storeKey, items: clean(readJson<unknown>(storeKey, [])) }); }, [ready, storeKey]);
  useEffect(() => { if (ready && state.key === storeKey) writeJson(storeKey, state.items); }, [state, ready, storeKey]);

  const collections = state.key === storeKey ? state.items : [];
  const update = useCallback((change: (items: Collection[]) => Collection[]) => setState((current) => ({ ...current, items: change(current.items) })), []);

  const createCollection = useCallback((name: string, icon?: string): Collection | null => {
    const trimmed = name.trim().slice(0, 40);
    if (!trimmed) return null;
    const collection: Collection = { id: `col-${crypto.randomUUID()}`, name: trimmed, ...(icon?.trim() ? { icon: icon.trim() } : {}) };
    update((items) => [...items, collection]);
    return collection;
  }, [update]);

  const renameCollection = useCallback((id: string, name: string, icon?: string) => {
    const trimmed = name.trim().slice(0, 40);
    if (trimmed) update((items) => items.map((item) => (item.id === id ? { ...item, name: trimmed, icon: icon?.trim() || undefined } : item)));
  }, [update]);

  const moveCollection = useCallback((id: string, direction: -1 | 1) => update((items) => {
    const index = items.findIndex((item) => item.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= items.length) return items;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  }), [update]);

  const deleteCollection = useCallback((id: string) => {
    update((items) => items.filter((item) => item.id !== id));
    setLibrary((library) => library.map((piko) => (piko.collectionIds?.includes(id) ? { ...piko, collectionIds: piko.collectionIds.filter((value) => value !== id) } : piko)));
  }, [update, setLibrary]);

  return { collections, createCollection, renameCollection, moveCollection, deleteCollection };
}

export type CollectionsState = ReturnType<typeof useCollections>;
