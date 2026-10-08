import { useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";
import { lookupIgdbGames, type IgdbGame } from "../lib/igdb";
import { applyIgdbMetadata, sanitizeKey } from "../lib/metadata";
import { cacheArtwork } from "./useMetadata";
import { listInstalledFlatpaks, normalizeLaunchTarget, chooseGameAppBundle, chooseGameTarget, type FlatpakApp, type LaunchMethodId } from "../lib/platform";
import type { ImportedGame } from "../lib/sources";
import type { Piko } from "../models";
import type { LibraryState } from "./useLibrary";
import type { MetadataState } from "./useMetadata";

type PendingGame = { name: string; executablePath: string; platformCategory: string; candidates: IgdbGame[] };

const platformLabels: Record<string, string> = { steam: "Steam", heroic: "Heroic", lutris: "Lutris", bottles: "Bottles", itch: "itch.io", apps: "Applications", flatpak: "Flatpak" };
export const platformLabel = (source: string) => platformLabels[source] ?? "Other";

/** The "Add a Piko" flows: custom games, importing from other launchers and picking a Flatpak. */
export function useAddGame(lib: LibraryState, metadata: MetadataState, hasIgdb: boolean, igdbConfigured: boolean, setLaunchError: (message: string) => void) {
  const [showAddPiko, setShowAddPiko] = useState(false);
  const [showCustomGame, setShowCustomGame] = useState(false);
  const [showImportPicker, setShowImportPicker] = useState(false);
  const [step, setStep] = useState<"form" | "igdb">("form");
  const [pendingGame, setPendingGame] = useState<PendingGame | null>(null);
  const [launchType, setLaunchType] = useState<LaunchMethodId>("file");
  const [launchTarget, setLaunchTarget] = useState("");
  const [igdbBusy, setIgdbBusy] = useState(false);
  const [flatpakPickerOpen, setFlatpakPickerOpen] = useState(false);
  const [flatpaks, setFlatpaks] = useState<FlatpakApp[]>([]);
  const [flatpakBusy, setFlatpakBusy] = useState(false);

  const reset = () => { setPendingGame(null); setStep("form"); setShowCustomGame(false); setShowAddPiko(false); setLaunchTarget(""); };
  const openCustom = () => { setShowCustomGame(true); setStep("form"); setPendingGame(null); setLaunchType("file"); setLaunchTarget(""); };

  const addToLibrary = (name: string, executablePath: string, metadataMatch: IgdbGame | null, category = "Custom") => {
    const piko: Piko = {
      id: `custom-${crypto.randomUUID()}`, name, executablePath, source: "custom", platformCategory: category,
      categories: [], description: "Custom game added to your local library.", accent: "#a99ad6", artwork: "",
      tofus: [{ id: "default", name: "Default", version: "Local", runtime: "Native", mods: 0, status: "Ready" }],
    };
    const enriched = applyIgdbMetadata(piko, metadataMatch);
    lib.setLibrary((current) => [...current, enriched]);
    void cacheArtwork(enriched);
    lib.setSelectedPikoId(piko.id);
    lib.setSelectedTofuId("default");
    reset();
  };

  const submitCustom = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") || "").trim();
    const executablePath = normalizeLaunchTarget(launchTarget, launchType);
    if (!name || !executablePath) return;
    const category = String(form.get("platformCategory") || "Custom").trim() || "Custom";
    if (!hasIgdb) { addToLibrary(name, executablePath, null, category); return; }
    setIgdbBusy(true);
    try {
      setPendingGame({ name, executablePath, platformCategory: category, candidates: await lookupIgdbGames(supabase!, name) });
    } catch (error) {
      console.warn("IGDB lookup failed", error);
      setPendingGame({ name, executablePath, platformCategory: category, candidates: [] });
    } finally { setIgdbBusy(false); setStep("igdb"); }
  };

  const approveIgdbGame = (match: IgdbGame | null) => {
    if (pendingGame) addToLibrary(pendingGame.name, pendingGame.executablePath, match, pendingGame.platformCategory);
  };

  const importGames = (games: ImportedGame[]) => {
    const now = Date.now();
    const known = new Set(lib.library.map((piko) => piko.name.trim().toLowerCase()));
    const created = games.filter((game) => !known.has(game.name.trim().toLowerCase())).map((game): Piko => ({
      id: `imported-${game.source}-${sanitizeKey(game.id)}-${now}`,
      name: game.name,
      description: `Imported from ${game.source}. The original launcher remains responsible for the installation and runtime.`,
      accent: "#a99ad6",
      artwork: "",
      artworkCacheKey: sanitizeKey(`${game.source}-${game.id}`),
      executablePath: game.launchTarget,
      installPath: game.installPath ?? undefined,
      source: "custom",
      sourceId: game.source,
      platformCategory: platformLabel(game.source),
      categories: [],
      tofus: [{ id: "default", name: "Default", version: "Imported", runtime: game.source, mods: 0, status: "Ready" }],
    }));
    lib.setLibrary((current) => [...current, ...created.filter((piko) => !current.some((item) => item.id === piko.id))]);
    if (created.length && igdbConfigured) void metadata.enrich(created);
    if (created[0]) { lib.setSelectedPikoId(created[0].id); lib.setSelectedTofuId("default"); }
    setShowAddPiko(false);
    setShowImportPicker(false);
  };

  const loadFlatpaks = async () => {
    setFlatpakBusy(true);
    try { setFlatpaks(await listInstalledFlatpaks()); setFlatpakPickerOpen(true); }
    catch (error) { setLaunchError(error instanceof Error ? error.message : String(error)); }
    finally { setFlatpakBusy(false); }
  };

  const chooseFile = async () => {
    try {
      const selected = launchType === "app" ? await chooseGameAppBundle() : await chooseGameTarget();
      if (selected) setLaunchTarget(selected);
    } catch (error) { setLaunchError(error instanceof Error ? error.message : String(error)); }
  };

  return {
    showAddPiko, setShowAddPiko, showCustomGame, setShowCustomGame, showImportPicker, setShowImportPicker, step, setStep,
    pendingGame, setPendingGame, launchType, setLaunchType, launchTarget, setLaunchTarget, igdbBusy, hasIgdb,
    flatpakPickerOpen, setFlatpakPickerOpen, flatpaks, flatpakBusy, loadFlatpaks, chooseFile,
    openCustom, reset, submitCustom, approveIgdbGame, importGames, addToLibrary,
  };
}

export type AddGameState = ReturnType<typeof useAddGame>;
