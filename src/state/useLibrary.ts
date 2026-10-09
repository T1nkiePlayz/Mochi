import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import type { Piko, Tofu } from "../models";
import { readJson, storageKeys, writeJson, writeString, readString } from "../lib/storage";
import { pikoSearchMatcher } from "../lib/search";
import type { PlaytimeEntry } from "../lib/platform";
import { sanitizeFilter, sanitizeLibrary, matchesFilter, mostPlayedIds, smartFilters, sourceLabel, sourceOf, toggleInList, withTag, type FilterContext, type LibraryFilter, type SmartFilterId } from "../lib/library";
import { placeholdersLast } from "../lib/fallbackArt";
import { foldLegacyPlaytime } from "../lib/minecraftPiko";
import { copyInstanceRecords } from "../lib/mods/instances";
import { useInstalledStatus } from "./useInstalledStatus";

export type LibrarySort = "category" | "name" | "recent" | "playtime";

const emptyPiko: Piko = {
  id: "__empty",
  name: "No Pikos yet",
  description: "Add a game to start building your library.",
  accent: "#a99ad6",
  artwork: "",
  tofus: [{ id: "default", name: "Default", version: "Local", runtime: "Native", mods: 0, status: "Ready" }],
};

export const newTofu = (name: string): Tofu => ({ id: `tofu-${crypto.randomUUID()}`, name, version: "Local", runtime: "Native", mods: 0, status: "Ready" });

/** The Pikos (games) and Tofus (environments) in the library, plus what is selected and how it is searched/sorted. */
export function useLibrary(playtime: PlaytimeEntry[], isRunning: (gameId: string) => boolean = () => false) {
  const [library, setLibrary] = useState<Piko[]>(() => {
    return sanitizeLibrary(readJson<unknown>(storageKeys.pikos, []));
  });
  const [selectedPikoId, setSelectedPikoId] = useState("");
  const [selectedTofuId, setSelectedTofuId] = useState("");
  const [gameDetailsId, setGameDetailsId] = useState("");
  const [search, setSearch] = useState("");
  const [librarySort, setLibrarySort] = useState<LibrarySort>(() => {
    const stored = readString(storageKeys.librarySort);
    return stored === "name" || stored === "recent" || stored === "playtime" ? stored : "category";
  });
  useEffect(() => writeString(storageKeys.librarySort, librarySort), [librarySort]);
  const [filter, setFilter] = useState<LibraryFilter>(() => {
    return sanitizeFilter(readJson<unknown>(storageKeys.libraryFilter, null));
  });
  useEffect(() => { writeJson(storageKeys.libraryFilter, filter); }, [filter]);
  const [tagFilters, setTagFilters] = useState<string[]>([]);
  const toggleTagFilter = useCallback((tag: string) => setTagFilters((current) => (current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag])), []);
  const installed = useInstalledStatus(library);

  const selectedPiko = library.find((piko) => piko.id === selectedPikoId) ?? library[0] ?? emptyPiko;
  const selectedTofu = selectedPiko.tofus.find((tofu) => tofu.id === selectedTofuId) ?? selectedPiko.tofus[0];

  // One-time: a Minecraft instance that used to be its own Piko keeps its installed-mod records under its old Tofu id; copy them to the new Tofu id (nothing is deleted).
  useEffect(() => {
    const pending = library.flatMap((piko) => piko.tofus.filter((tofu) => tofu.legacyTofuId).map((tofu) => ({ pikoId: piko.id, id: tofu.id, from: tofu.legacyTofuId! })));
    if (!pending.length) return;
    void Promise.all(pending.map((item) => copyInstanceRecords(item.from, item.id).then(() => true, () => false).then((ok) => ({ ...item, ok })))).then((results) => {
      const done = new Set(results.filter((item) => item.ok).map((item) => `${item.pikoId}/${item.id}`));
      if (done.size) setLibrary((current) => current.map((piko) => ({ ...piko, tofus: piko.tofus.map((tofu) => (done.has(`${piko.id}/${tofu.id}`) ? { ...tofu, legacyTofuId: undefined } : tofu)) })));
    });
  }, [library]);

  const playtimeById = useMemo(() => new Map(foldLegacyPlaytime(playtime, library).map((entry) => [entry.gameId, entry])), [playtime, library]);
  const filterContext: FilterContext = useMemo(() => ({ playtime: playtimeById, installed, isRunning }), [playtimeById, installed, isRunning]);
  const mostPlayed = useMemo(() => mostPlayedIds(library, playtimeById), [library, playtimeById]);

  const deferredSearch = useDeferredValue(search);
  /** Search and tag filters applied; the primary filter is applied on top (chips show counts for this base). */
  const searchedPikos = useMemo(() => {
    const query = deferredSearch.trim();
    const matches = query ? pikoSearchMatcher(query) : null;
    const wanted = tagFilters.map((tag) => tag.toLowerCase());
    return library.filter((piko) => {
      if (wanted.length && !wanted.every((tag) => piko.tags?.some((item) => item.toLowerCase() === tag))) return false;
      return !matches || matches(piko);
    });
  }, [library, deferredSearch, tagFilters]);

  const visiblePikos = useMemo(() => searchedPikos.filter((piko) => matchesFilter(piko, filter, filterContext, mostPlayed)), [searchedPikos, filter, filterContext, mostPlayed]);

  const filterCounts = useMemo(() => {
    const smart = Object.fromEntries(smartFilters.map(({ id }) => [id, searchedPikos.filter((piko) => matchesFilter(piko, { kind: "smart", id }, filterContext, mostPlayed)).length])) as Record<SmartFilterId, number>;
    const sources = new Map<string, { label: string; count: number }>();
    const collections = new Map<string, number>();
    searchedPikos.forEach((piko) => {
      const id = sourceOf(piko);
      sources.set(id, { label: sourceLabel(piko), count: (sources.get(id)?.count ?? 0) + 1 });
      piko.collectionIds?.forEach((collectionId) => collections.set(collectionId, (collections.get(collectionId) ?? 0) + 1));
    });
    return { smart, sources: [...sources.entries()].map(([id, value]) => ({ id, ...value })).sort((a, b) => a.label.localeCompare(b.label)), collections };
  }, [searchedPikos, filterContext, mostPlayed]);

  const groupedPikos = useMemo(() => {
    const byId = playtimeById;
    if (librarySort !== "category") {
      const sorted = [...visiblePikos].sort((a, b) =>
        librarySort === "name" ? a.name.localeCompare(b.name)
          : librarySort === "recent" ? (byId.get(b.id)?.lastPlayed ?? 0) - (byId.get(a.id)?.lastPlayed ?? 0)
          : (byId.get(b.id)?.seconds ?? 0) - (byId.get(a.id)?.seconds ?? 0));
      return [[librarySort === "name" ? "All games" : librarySort === "recent" ? "Recently played" : "Most played", placeholdersLast(sorted)] as [string, Piko[]]];
    }
    const groups = new Map<string, Piko[]>();
    visiblePikos.forEach((piko) => {
      const category = piko.platformCategory || "Other";
      const group = groups.get(category);
      if (group) group.push(piko); else groups.set(category, [piko]);
    });
    // Favourites are pinned to the top of their category, then games with metadata before placeholder-art games (both stable).
    return [...groups.entries()].sort(([x], [y]) => x.localeCompare(y))
      .map(([category, games]) => [category, [...placeholdersLast(games.filter((game) => game.favorite)), ...placeholdersLast(games.filter((game) => !game.favorite))]] as [string, Piko[]]);
  }, [visiblePikos, librarySort, playtimeById]);

  const continuePlaying = useMemo(() => {
    const byId = new Map(library.map((piko) => [piko.id, piko]));
    return foldLegacyPlaytime(playtime, library)
      .filter((entry) => entry.lastPlayed > 0 && byId.has(entry.gameId))
      .sort((a, b) => b.lastPlayed - a.lastPlayed)
      .slice(0, 3)
      .map((entry) => ({ piko: byId.get(entry.gameId)!, entry }));
  }, [library, playtime]);

  const selectPiko = useCallback((piko: Piko) => {
    setSelectedPikoId(piko.id);
    setSelectedTofuId(piko.tofus[0]?.id ?? "");
  }, []);

  const updateGame = useCallback((gameId: string, changes: Partial<Piko>) =>
    setLibrary((current) => current.map((piko) => (piko.id === gameId ? { ...piko, ...changes } : piko))), []);

  const toggleFavorite = useCallback((gameId: string) =>
    setLibrary((current) => current.map((piko) => (piko.id === gameId ? { ...piko, favorite: !piko.favorite } : piko))), []);

  const setFavorites = useCallback((gameIds: string[], on: boolean) => {
    const ids = new Set(gameIds);
    setLibrary((current) => current.map((piko) => (ids.has(piko.id) ? { ...piko, favorite: on } : piko)));
  }, []);

  const setCollectionMembership = useCallback((gameIds: string[], collectionId: string, on: boolean) => {
    const ids = new Set(gameIds);
    setLibrary((current) => current.map((piko) => (ids.has(piko.id) ? { ...piko, collectionIds: toggleInList(piko.collectionIds, collectionId, on) } : piko)));
  }, []);

  const addTagToGames = useCallback((gameIds: string[], tag: string) => {
    const ids = new Set(gameIds);
    setLibrary((current) => current.map((piko) => (ids.has(piko.id) ? { ...piko, tags: withTag(piko.tags, tag) } : piko)));
  }, []);

  const removeGames = useCallback((gameIds: string[]) => {
    const ids = new Set(gameIds);
    setLibrary((current) => current.filter((piko) => !ids.has(piko.id)));
    setGameDetailsId((current) => (ids.has(current) ? "" : current));
  }, []);

  const updateSelectedTofu = (patch: Partial<Tofu>) =>
    setLibrary((current) => current.map((piko) => piko.id === selectedPiko.id
      ? { ...piko, tofus: piko.tofus.map((tofu) => (tofu.id === selectedTofu.id ? { ...tofu, ...patch } : tofu)) }
      : piko));

  const createTofu = () => {
    const tofu = newTofu(`Tofu ${selectedPiko.tofus.length + 1}`);
    updateGame(selectedPiko.id, { tofus: [...selectedPiko.tofus, tofu] });
    setSelectedTofuId(tofu.id);
    return tofu;
  };

  return {
    library, setLibrary, selectedPikoId, setSelectedPikoId, selectedTofuId, setSelectedTofuId, gameDetailsId, setGameDetailsId,
    search, setSearch, librarySort, setLibrarySort, selectedPiko, selectedTofu, visiblePikos, groupedPikos, continuePlaying,
    selectPiko, updateGame, updateSelectedTofu, createTofu,
    filter, setFilter, tagFilters, setTagFilters, toggleTagFilter, filterCounts, installed, searchedPikos,
    toggleFavorite, setFavorites, setCollectionMembership, addTagToGames, removeGames,
  };
}

export type LibraryState = ReturnType<typeof useLibrary>;
