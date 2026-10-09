import { useRef, useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { supabase } from "../lib/supabase";
import { lookupIgdbGames, type IgdbGame } from "../lib/igdb";
import { importedGameToPiko } from "../lib/importMapping";
import { applyIgdbMetadata, sanitizeKey } from "../lib/metadata";
import { cacheArtwork } from "./useMetadata";
import { applyIconCovers, applyLauncherLogos } from "../lib/iconCover";
import { saveCustomArtwork } from "../lib/artwork";
import type { ArtworkSelection } from "../components/artwork/ArtworkPicker";
import { listInstalledFlatpaks, normalizeLaunchTarget, chooseGameAppBundle, chooseGameTarget, type FlatpakApp, type LaunchMethodId } from "../lib/platform";
import type { ImportedGame } from "../lib/sources";
import type { Piko } from "../models";
import type { LibraryState } from "./useLibrary";
import type { MetadataState } from "./useMetadata";

type PendingGame = { name: string; executablePath: string; platformCategory: string; candidates: IgdbGame[]; match?: IgdbGame | null };
export type AddStep = "form" | "igdb" | "cover";

export { platformLabel } from "../lib/importMapping";

/** The "Add a Piko" flows: custom games, importing from other launchers and picking a Flatpak. */
export function useAddGame(lib: LibraryState, metadata: MetadataState, hasIgdb: boolean, _igdbConfigured: boolean, setLaunchError: (message: string) => void, showLibrary: () => void = () => {}) {
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
  const igdbSearchSeq = useRef(0);
  const addingRef = useRef(false);

  const clearForm = () => { setFormName(""); setFormCategory("Custom"); setFormError(""); setCover(null); setAdding(false); };
  const reset = () => { setPendingGame(null); setStep("form"); setShowCustomGame(false); setShowAddPiko(false); setLaunchTarget(""); clearForm(); };
  const openCustom = () => { setShowCustomGame(true); setStep("form"); setPendingGame(null); setLaunchType("file"); setLaunchTarget(""); clearForm(); };

  const addToLibrary = async (name: string, executablePath: string, metadataMatch: IgdbGame | null, category = "Custom", coverChoice: ArtworkSelection | null = null) => {
    if (addingRef.current) return;
    addingRef.current = true;
    try { await createGame(name, executablePath, metadataMatch, category, coverChoice); } finally { addingRef.current = false; }
  };

  const createGame = async (name: string, executablePath: string, metadataMatch: IgdbGame | null, category: string, coverChoice: ArtworkSelection | null) => {
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
    // Only the newest search may write its results; slower, older ones are dropped.
    const seq = ++igdbSearchSeq.current;
    setIgdbBusy(true);
    try { const candidates = await lookupIgdbGames(supabase, query); if (seq === igdbSearchSeq.current) setPendingGame((current) => (current ? { ...current, candidates } : current)); }
    catch { if (seq === igdbSearchSeq.current) setPendingGame((current) => (current ? { ...current, candidates: [] } : current)); }
    finally { if (seq === igdbSearchSeq.current) setIgdbBusy(false); }
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
    const fresh = games.filter((game) => !known.has(game.name.trim().toLowerCase()));
    const created = fresh.map((game) => importedGameToPiko(game, now));
    lib.setLibrary((current) => [...current, ...created.filter((piko) => !current.some((item) => item.id === piko.id))]);
    if (created.length) void finishImport(created, new Map(created.flatMap((piko, index) => (fresh[index].iconPath && piko.kind !== "launcher" ? [[piko.id, fresh[index].iconPath!]] : []))));
    if (created[0]) { lib.setSelectedPikoId(created[0].id); lib.setSelectedTofuId("default"); }
    setShowAddPiko(false);
    setShowImportPicker(false);
  };

  /**
   * After an import: games get a cover drawn from their own icon first (so they never look blank,
   * even offline), launchers their company's IGDB logo, then metadata lookups may replace the icons.
   */
  const finishImport = async (created: Piko[], icons: Map<string, string>) => {
    const withIcons = await applyIconCovers(created, icons);
    const logos = supabase && metadata.ready.igdb ? await applyLauncherLogos(supabase, created) : new Set<string>();
    const sourceOf = (piko: Piko): Piko["artworkSource"] => (logos.has(piko.id) ? "igdb" : withIcons.has(piko.id) ? "icon" : piko.artworkSource);
    if (withIcons.size || logos.size) {
      lib.setLibrary((current) => current.map((piko) => ((withIcons.has(piko.id) || logos.has(piko.id)) && !piko.artworkSource ? { ...piko, artworkSource: sourceOf(piko) } : piko)));
    }
    await metadata.enrich(created.filter((piko) => piko.kind !== "launcher").map((piko) => (withIcons.has(piko.id) ? { ...piko, artworkSource: "icon" as const } : piko)));
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
