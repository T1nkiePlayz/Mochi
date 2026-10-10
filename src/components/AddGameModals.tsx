import { useEffect, useState } from "react";
import { ChevronDown, Gamepad2, Grid2X2, Library, Plus, RefreshCw, Rocket, Search, X } from "lucide-react";
import { ArtworkPicker } from "./artwork/ArtworkPicker";
import { Select } from "./ui/Select";
import { MochiIcon } from "./MochiIcon";
import { ImportPicker } from "./ImportPicker";
import { resolveIgdbImage } from "../lib/metadata";
import type { LaunchMethodId } from "../lib/platform";
import { useApp } from "../state/AppContext";
import { cssUrl } from "../lib/metadata/merge";
import { useTranslation } from "../lib/useTranslation";

const methodLabel = (method: string, t: (message: string) => string) => method === "file" ? t("Choose file") : method === "app" ? t("macOS application") : method === "flatpak" ? t("Flatpak") : t("Custom");

export function AddGameModals() {
  const t = useTranslation();
  const { add, platformCapabilities } = useApp();
  const [searchText, setSearchText] = useState("");
  useEffect(() => { if (add.step === "igdb") setSearchText(add.pendingGame?.name ?? ""); }, [add.step]); // eslint-disable-line react-hooks/exhaustive-deps
  return <>
    {add.showAddPiko && <div className="modal-backdrop" onClick={() => add.setShowAddPiko(false)}><div className="modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
      <div className="modal-header"><div><p className="eyebrow">Expand your library</p><h2>Add a Piko</h2></div><button className="icon-button" aria-label="Close" onClick={() => add.setShowAddPiko(false)}><MochiIcon name="close" fallback={X} size={17} /></button></div>
      <p className="modal-description">Connect an installed game or add a custom game to start managing its Tofus in Mochi.</p>
      <div className="add-options">
        <button onClick={() => add.openImportPicker("games")}><MochiIcon name="library" fallback={Library} size={18} /><span><strong>Import from another platform</strong><small>Bring games in from an installed launcher</small></span><MochiIcon name="chevron" fallback={ChevronDown} size={15} /></button>
        <button onClick={() => add.openImportPicker("launchers")}><MochiIcon name="rocket" fallback={Rocket} size={18} /><span><strong>Import game launchers</strong><small>Add Steam, Heroic, Prism and other launchers you have installed</small></span><MochiIcon name="chevron" fallback={ChevronDown} size={15} /></button>
        <button onClick={add.openCustom}><MochiIcon name="plus" fallback={Plus} size={18} /><span><strong>Add a custom game</strong><small>Save a name and executable path locally</small></span><MochiIcon name="chevron" fallback={ChevronDown} size={15} /></button>
      </div>
    </div></div>}

    {add.showCustomGame && <div className="modal-backdrop" onClick={() => add.reset()}>
      <div className={`modal igdb-selection-modal add-game-modal step-${add.step}`} role="dialog" aria-modal="true" aria-label="Add custom game" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === "Escape" && !event.defaultPrevented) add.reset(); }}>
        <div className="modal-header"><div><p className="eyebrow">{add.step === "igdb" ? "Step 2 · Confirm game identity" : add.step === "cover" ? `Step ${add.hasIgdb ? 3 : 2} · Cover` : "Local library"}</p><h2>{add.step === "igdb" ? "Is this the right game?" : add.step === "cover" ? "Choose a cover" : "Add custom game"}</h2></div><button className="icon-button" type="button" aria-label="Close" onClick={() => add.reset()}><MochiIcon name="close" fallback={X} size={17} /></button></div>
        {add.step === "form" && <form onSubmit={(event) => void add.submitCustom(event)} noValidate>
          <p className="modal-description">Choose how Mochi should launch this game. File selection uses the native file dialog.</p>
          <div className="form-fields">
            <label>Game name<input value={add.formName} onChange={(event) => add.setFormName(event.target.value)} autoFocus placeholder="e.g. Hollow Knight" aria-invalid={Boolean(add.formError) && !add.formName.trim()} /></label>
            <label>Platform category<input value={add.formCategory} onChange={(event) => add.setFormCategory(event.target.value)} placeholder="e.g. Steam, Heroic, Custom" /></label>
            <div className="editor-field"><span className="editor-field-label">Launch method</span>
              <Select<LaunchMethodId> label="Launch method" value={add.launchType} onChange={add.setLaunchType}
                options={(platformCapabilities?.launchMethods ?? ["file", "flatpak", "custom"]).map((method) => ({ value: method as LaunchMethodId, label: methodLabel(method, t) }))} />
            </div>
            {(add.launchType === "file" || add.launchType === "app") && <div className="launch-target-picker"><button type="button" className="secondary-button file-picker-button" onClick={add.chooseFile}>{add.launchType === "app" ? "Choose macOS application" : "Choose executable / launcher file"}</button></div>}
            {add.launchType === "flatpak" && <div className="flatpak-input-row"><button type="button" className="secondary-button" onClick={add.loadFlatpaks} disabled={add.flatpakBusy}>{add.flatpakBusy ? <><MochiIcon name="refresh" fallback={RefreshCw} size={15} className="spin" /> {t("Loading…")}</> : <><MochiIcon name="installed" fallback={Grid2X2} size={15} /> Choose installed Flatpak</>}</button><input value={add.launchTarget} onChange={(event) => add.setLaunchTarget(event.target.value)} placeholder="org.company.game" autoComplete="off" aria-label="Flatpak ID" /></div>}
            {add.launchType === "custom" && <input value={add.launchTarget} onChange={(event) => add.setLaunchTarget(event.target.value)} placeholder="Custom path, Flatpak ID, or supported launch target" autoComplete="off" aria-label="Launch target" />}
            {add.launchTarget && <p className="metadata-note path-text" title={add.launchTarget}>{add.launchTarget}</p>}
          </div>
          {add.formError && <p className="auth-error" role="alert">{add.formError}</p>}
          <button className="play-button form-submit" type="submit" disabled={add.igdbBusy}>{add.igdbBusy ? <><MochiIcon name="refresh" fallback={RefreshCw} size={16} className="spin" /> {t("Searching IGDB…")}</> : <>Next <MochiIcon name="chevron" fallback={ChevronDown} size={16} /></>}</button>
        </form>}
        {add.step === "igdb" && <>
          <p className="modal-description">{add.pendingGame?.candidates.length ? "Mochi found these matches. Approve the best match to use its artwork, description and categories." : "Mochi could not find a confident match. Search again or add the game without IGDB metadata."}</p>
          <form className="artwork-search-bar" onSubmit={(event) => { event.preventDefault(); void add.searchIgdbAgain(searchText); }}>
            <label className="artwork-search-input"><Search size={14} aria-hidden="true" /><input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Search IGDB again" aria-label="Search IGDB again" /></label>
            <button type="submit" className="secondary-button" disabled={add.igdbBusy || !searchText.trim()}>{add.igdbBusy ? "Searching…" : "Search"}</button>
          </form>
          <div className="igdb-candidates">{add.pendingGame?.candidates.map((game) => {
            const art = resolveIgdbImage(game.cover?.url, "t_cover_big") || resolveIgdbImage(game.artworks?.[0]?.url, "t_720p");
            const released = game.first_release_date ? new Date(game.first_release_date * 1000).getFullYear() : null;
            return <button type="button" className="igdb-candidate" key={game.id ?? game.name} onClick={() => add.approveIgdbGame(game)}><div className="igdb-candidate-art" style={{ backgroundImage: art ? cssUrl(art) : undefined }} /><div className="igdb-candidate-copy"><strong>{game.name}{released ? ` (${released})` : ""}</strong><small>{game.genres?.map((g) => g.name).join(" · ") || "Genre unknown"}</small>{game.summary && <p>{game.summary}</p>}</div><MochiIcon name="chevron" fallback={ChevronDown} size={16} /></button>;
          })}</div>
          <div className="igdb-selection-actions"><button type="button" className="secondary-button" onClick={() => add.setStep("form")}>Back</button><button type="button" className="secondary-button" onClick={() => add.approveIgdbGame(null)}>None of these</button></div>
        </>}
        {add.step === "cover" && <>
          <p className="modal-description">Optional. Pick your own cover, or skip to use {add.pendingGame?.match ? "the IGDB artwork" : "Mochi's placeholder"}. You can change it later in Edit.</p>
          <ArtworkPicker gameName={add.pendingGame?.match?.name || add.pendingGame?.name || ""} onChange={add.setCover} />
          {add.formError && <p className="auth-error" role="alert">{add.formError}</p>}
          <div className="igdb-selection-actions">
            <button type="button" className="secondary-button" onClick={() => add.setStep(add.hasIgdb ? "igdb" : "form")} disabled={add.adding}>Back</button>
            <button type="button" className="secondary-button" onClick={() => void add.finishAdd(false)} disabled={add.adding}>Skip cover</button>
            <button type="button" className="play-button" onClick={() => void add.finishAdd(true)} disabled={add.adding || !add.cover}><MochiIcon name="plus" fallback={Plus} size={16} /> {add.adding ? "Adding…" : "Add game"}</button>
          </div>
        </>}
      </div>
    </div>}

    {add.flatpakPickerOpen && <div className="modal-backdrop" onClick={() => add.setFlatpakPickerOpen(false)}>
      <div className="modal flatpak-picker-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header"><div><p className="eyebrow">Installed applications</p><h2>Choose a Flatpak</h2></div><button className="icon-button" type="button" aria-label="Close" onClick={() => add.setFlatpakPickerOpen(false)}><MochiIcon name="close" fallback={X} size={17} /></button></div>
        <p className="modal-description">Games are shown first. Everything else is grouped separately.</p>
        {(["Games", "Other"] as const).map((category) => {
          const items = add.flatpaks.filter((flatpak) => flatpak.category === category);
          return items.length ? <section className="flatpak-group" key={category}><div className="flatpak-group-heading"><strong>{category}</strong><span>{items.length}</span></div><div className="flatpak-list">{items.map((flatpak) => <button type="button" className="flatpak-item" key={flatpak.id} onClick={() => { add.setLaunchTarget(`flatpak://${flatpak.id}`); add.setFlatpakPickerOpen(false); }}><span><strong>{flatpak.name}</strong><small>{flatpak.id}</small></span><MochiIcon name="chevron" fallback={ChevronDown} size={15} /></button>)}</div></section> : null;
        })}
        {!add.flatpaks.length && <div className="empty-state flatpak-empty"><MochiIcon name="gamepad" fallback={Gamepad2} size={22} /><p>No installed Flatpaks were found.</p></div>}
      </div>
    </div>}

    {add.showImportPicker && <ImportPicker mode={add.importMode} onClose={add.closeImportPicker} onImport={add.importGames} />}
  </>;
}
