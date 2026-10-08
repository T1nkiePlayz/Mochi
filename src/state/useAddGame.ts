import { useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { supabase } from "../lib/supabase";
import { lookupIgdbGames, type IgdbGame } from "../lib/igdb";
import { applyIgdbMetadata, sanitizeKey } from "../lib/metadata";
import { cacheArtwork } from "./useMetadata";
import { saveCustomArtwork } from "../lib/artwork";
import type { ArtworkSelection } from "../components/artwork/ArtworkPicker";
import { listInstalledFlatpaks, normalizeLaunchTarget, chooseGameAppBundle, chooseGameTarget, type FlatpakApp, type LaunchMethodId } from "../lib/platform";
import type { ImportedGame } from "../lib/sources";
import type { Piko } from "../models";
import type { LibraryState } from "./useLibrary";
import type { MetadataState } from "./useMetadata";

type PendingGame = { name: string; executablePath: string; platformCategory: string; candidates: IgdbGame[]; match?: IgdbGame | null };
export type AddStep = "form" | "igdb" | "cover";

const platformLabels: Record<string, string> = { steam: "Steam", heroic: "Heroic", lutris: "Lutris", bottles: "Bottles", itch: "itch.io", apps: "Applications", flatpak: "Flatpak" };
export const platformLabel = (source: string) => platformLabels[source] ?? "Other";

/** The "Add a Piko" flows: custom games, importing from other launchers and picking a Flatpak. */
export function useAddGame(lib: LibraryState, metadata: MetadataState, hasIgdb: boolean, igdbConfigured: boolean, setLaunchError: (message: string) => void, showLibrary: () => void = () => {}) {
  const [showAddPiko, setShowAddPiko] = useState(false);
  const [showCustomGame, setShowCustomGame] = useState(false);
  const [showImportPicker, setShowImportPicker] = useState(false);
  const [step, setStep] = useState<AddStep>("form");
  const [formName, setFormName] = useState("");
  const [formCategory, setFormCategory] = useState("Custom");
  const [formError, setFormError] = useState("");
  const [cover, setCover] = useState<ArtworkSelection | null>(null);
  const [adding, setAdding] = useState(false);
  const [pendingGame, setPendingGame] = useState<PendingGame | null>(null);
  const [launchType, setLaunchType] = useState<LaunchMethodId>("file");
  const [launchTarget, setLaunchTarget] = useState("");
  const [igdbBusy, setIgdbBusy] = useState(false);
  const [flatpakPickerOpen, setFlatpakPickerOpen] = useState(false);
  const [flatpaks, setFlatpaks] = useState<FlatpakApp[]>([]);
  const [flatpakBusy, setFlatpakBusy] = useState(false);

  const clearForm = () => { setFormName(""); setFormCategory("Custom"); setFormError(""); setCover(null); setAdding(false); };
  const reset = () => { setPendingGame(null); setStep("form"); setShowCustomGame(false); setShowAddPiko(false); setLaunchTarget(""); clearForm(); };
  const openCustom = () => { setShowCustomGame(true); setStep("form"); setPendingGame(null); setLaunchType("file"); setLaunchTarget(""); clearForm(); };

  const addToLibrary = async (name: string, executablePath: string, metadataMatch: IgdbGame | null, category = "Custom", coverChoice: ArtworkSelection | null = null) => {
    const id = `custom-${crypto.randomUUID()}`;
    const piko: Piko = {
      id, name, executablePath, source: "custom", platformCategory: category,
      categories: [], description: "Custom game added to your local library.", accent: "#a99ad6", artwork: "",
      tofus: [{ id: "default", name: "Default", version: "Local", runtime: "Native", mods: 0, status: "Ready" }],
    };
    let enriched = applyIgdbMetadata(piko, metadataMatch);
    if (coverChoice) {
      const cacheKey = enriched.artworkCacheKey || sanitizeKey(id);
      try {
        await saveCustomArtwork(cacheKey, coverChoice.source, coverChoice.crop);
        enriched = { ...enriched, artworkCacheKey: cacheKey, artworkSource: "custom", artworkUrl: undefined, artwork: "", lockedFields: ["artwork"] };
      } catch (error) {
        setFormError(error instanceof Error ? error.message : String(error));
        setAdding(false);
        return;
      }
    }
    lib.setLibrary((current) => [...current, enriched]);
    if (!coverChoice) void cacheArtwork(enriched);
    lib.setSelectedPikoId(id);
    lib.setSelectedTofuId("default");
    reset();
    showLibrary();
    lib.setGameDetailsId(id);
  };

  /** Checks the form and, for path targets, that the file exists. Returns the normalised target or null. */
  const validateForm = async (): Promise<string | null> => {
    const name = formName.trim();
    const executablePath = normalizeLaunchTarget(launchTarget, launchType);
    if (!name) { setFormError("Give the game a name."); return null; }
    if (!executablePath) { setFormError("Choose what Mochi should launch."); return null; }
    if (executablePath.startsWith("/")) {
      try { const [exists] = await invoke<boolean[]>("check_launch_targets", { targets: [executablePath] }); if (exists === false) { setFormError("Mochi can't find that file. Choose it again."); return null; } }
      catch { /* browser/dev mode or old backend: skip the check */ }
    }
    if (lib.library.some((piko) => piko.name.trim().toLowerCase() === name.toLowerCase() && piko.executablePath === executablePath)) { setFormError("This game is already in your library."); return null; }
    setFormError("");
    return executablePath;
  };

  const submitCustom = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const executablePath = await validateForm();
    if (!executablePath) return;
    const name = formName.trim();
    const category = formCategory.trim() || "Custom";
    if (!hasIgdb) { setPendingGame({ name, executablePath, platformCategory: category, candidates: [], match: null }); setStep("cover"); return; }
    setIgdbBusy(true);
    try {
      setPendingGame({ name, executablePath, platformCategory: category, candidates: await lookupIgdbGames(supabase!, name) });
    } catch (error) {
      console.warn("IGDB lookup failed", error);
      setPendingGame({ name, executablePath, platformCategory: category, candidates: [] });
    } finally { setIgdbBusy(false); setStep("igdb"); }
  };

  /** "Search again" in the confirm step with a hand-typed query. */
  const searchIgdbAgain = async (query: string) => {
    if (!supabase || !pendingGame || !query.trim()) return;
    setIgdbBusy(true);
    try { const candidates = await lookupIgdbGames(supabase, query); setPendingGame((current) => (current ? { ...current, candidates } : current)); }
    catch { setPendingGame((current) => (current ? { ...current, candidates: [] } : current)); }
    finally { setIgdbBusy(false); }
  };

  const approveIgdbGame = (match: IgdbGame | null) => {
    setPendingGame((current) => (current ? { ...current, match } : current));
    setStep("cover");
  };

  /** Final step: create the game, with the chosen cover (or none for the automatic one). */
  const finishAdd = async (useCover: boolean) => {
    if (!pendingGame) return;
    setAdding(true);
    await addToLibrary(pendingGame.name, pendingGame.executablePath, pendingGame.match ?? null, pendingGame.platformCategory, useCover ? cover : null);
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
    formName, setFormName, formCategory, setFormCategory, formError, cover, setCover, adding, finishAdd, searchIgdbAgain,
  };
}

export type AddGameState = ReturnType<typeof useAddGame>;
