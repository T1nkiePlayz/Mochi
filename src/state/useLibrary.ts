import { useCallback, useEffect, useMemo, useState } from "react";
import type { Piko, Tofu } from "../models";
import { readJson, storageKeys, writeString, readString } from "../lib/storage";
import { gameSearchMatches } from "../lib/search";
import type { PlaytimeEntry } from "../lib/platform";

export type LibrarySort = "category" | "name" | "recent" | "playtime";

const emptyPiko: Piko = {
  id: "__empty",
  name: "No Pikos yet",
  description: "Add a game to start building your library.",
  accent: "#a99ad6",
  artwork: "",
  tofus: [{ id: "default", name: "Default", version: "Local", runtime: "Native", mods: 0, status: "Ready" }],
};

export const newTofu = (name: string): Tofu => ({ id: `tofu-${Date.now()}`, name, version: "Local", runtime: "Native", mods: 0, status: "Ready" });

/** The Pikos (games) and Tofus (environments) in the library, plus what is selected and how it is searched/sorted. */
export function useLibrary(playtime: PlaytimeEntry[]) {
  const [library, setLibrary] = useState<Piko[]>(() => {
    const stored = readJson<unknown>(storageKeys.pikos, []);
    return Array.isArray(stored) ? (stored as Piko[]) : [];
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

  const selectedPiko = library.find((piko) => piko.id === selectedPikoId) ?? library[0] ?? emptyPiko;
  const selectedTofu = selectedPiko.tofus.find((tofu) => tofu.id === selectedTofuId) ?? selectedPiko.tofus[0];

  const visiblePikos = useMemo(() => {
    const query = search.trim();
    if (!query) return library;
    return library.filter((piko) => [piko.name, piko.description, piko.platformCategory || "", piko.sourceId || "", ...(piko.categories ?? []), ...(piko.tags ?? [])]
      .some((value) => gameSearchMatches(query, value)));
  }, [library, search]);

  const groupedPikos = useMemo(() => {
    const byId = new Map(playtime.map((entry) => [entry.gameId, entry]));
    if (librarySort !== "category") {
      const sorted = [...visiblePikos].sort((a, b) =>
        librarySort === "name" ? a.name.localeCompare(b.name)
          : librarySort === "recent" ? (byId.get(b.id)?.lastPlayed ?? 0) - (byId.get(a.id)?.lastPlayed ?? 0)
          : (byId.get(b.id)?.seconds ?? 0) - (byId.get(a.id)?.seconds ?? 0));
      return [[librarySort === "name" ? "All games" : librarySort === "recent" ? "Recently played" : "Most played", sorted] as [string, Piko[]]];
    }
    const groups = new Map<string, Piko[]>();
    visiblePikos.forEach((piko) => {
      const category = piko.platformCategory || "Other";
      groups.set(category, [...(groups.get(category) ?? []), piko]);
    });
    return [...groups.entries()].sort(([x], [y]) => x.localeCompare(y));
  }, [visiblePikos, librarySort, playtime]);

  const continuePlaying = useMemo(() => {
    const byId = new Map(library.map((piko) => [piko.id, piko]));
    return playtime
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
  };
}

export type LibraryState = ReturnType<typeof useLibrary>;
