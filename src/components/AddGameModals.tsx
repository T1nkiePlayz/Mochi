import { ChevronDown, Gamepad2, Grid2X2, Library, Plus, RefreshCw, X } from "lucide-react";
import { MochiIcon } from "./MochiIcon";
import { ImportPicker } from "./ImportPicker";
import { resolveIgdbImage } from "../lib/metadata";
import type { LaunchMethodId } from "../lib/platform";
import { useApp } from "../state/AppContext";

const methodLabel = (method: string) => method === "file" ? "Choose file" : method === "app" ? "macOS application" : method === "flatpak" ? "Flatpak" : "Custom";

export function AddGameModals() {
  const { add, platformCapabilities } = useApp();
  return <>
    {add.showAddPiko && <div className="modal-backdrop" onClick={() => add.setShowAddPiko(false)}><div className="modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
      <div className="modal-header"><div><p className="eyebrow">Expand your library</p><h2>Add a Piko</h2></div><button className="icon-button" aria-label="Close" onClick={() => add.setShowAddPiko(false)}><MochiIcon name="close" fallback={X} size={17} /></button></div>
      <p className="modal-description">Connect an installed game or add a custom game to start managing its Tofus in Mochi.</p>
      <div className="add-options">
        <button onClick={() => { add.setShowImportPicker(true); add.setShowAddPiko(false); }}><MochiIcon name="library" fallback={Library} size={18} /><span><strong>Import from another platform</strong><small>Bring games in from an installed launcher</small></span><MochiIcon name="chevron" fallback={ChevronDown} size={15} /></button>
        <button onClick={add.openCustom}><MochiIcon name="plus" fallback={Plus} size={18} /><span><strong>Add a custom game</strong><small>Save a name and executable path locally</small></span><MochiIcon name="chevron" fallback={ChevronDown} size={15} /></button>
      </div>
    </div></div>}

    {add.showCustomGame && <div className="modal-backdrop" onClick={() => add.reset()}>
      <form className="modal igdb-selection-modal" role="dialog" aria-modal="true" onSubmit={add.submitCustom} onClick={(event) => event.stopPropagation()}>
        <div className="modal-header"><div><p className="eyebrow">{add.step === "igdb" ? "Confirm game identity" : "Local library"}</p><h2>{add.step === "igdb" ? "Is this the right game?" : "Add custom game"}</h2></div><button className="icon-button" type="button" aria-label="Close" onClick={() => add.reset()}><MochiIcon name="close" fallback={X} size={17} /></button></div>
        {add.step === "form" ? <>
          <p className="modal-description">Choose how Mochi should launch this game. File selection uses the native file dialog.</p>
          <div className="form-fields">
            <label>Game name<input name="name" autoFocus placeholder="e.g. Hollow Knight" required /></label>
            <label>Platform category<input name="platformCategory" defaultValue="Custom" placeholder="e.g. Steam, Heroic, Custom" /></label>
            <label>Launch method
              <select value={add.launchType} onChange={(event) => add.setLaunchType(event.target.value as LaunchMethodId)}>
                {(platformCapabilities?.launchMethods ?? ["file", "flatpak", "custom"]).map((method) => <option value={method} key={method}>{methodLabel(method)}</option>)}
              </select>
            </label>
            {(add.launchType === "file" || add.launchType === "app") && <div className="launch-target-picker"><button type="button" className="secondary-button file-picker-button" onClick={add.chooseFile}>{add.launchType === "app" ? "Choose macOS application" : "Choose executable / launcher file"}</button></div>}
            {add.launchType === "flatpak" && <div className="flatpak-input-row"><button type="button" className="secondary-button" onClick={add.loadFlatpaks} disabled={add.flatpakBusy}>{add.flatpakBusy ? <><MochiIcon name="refresh" fallback={RefreshCw} size={15} className="spin" /> Loading...</> : <><MochiIcon name="installed" fallback={Grid2X2} size={15} /> Choose installed Flatpak</>}</button><input value={add.launchTarget} onChange={(event) => add.setLaunchTarget(event.target.value)} placeholder="org.company.game" autoComplete="off" required /></div>}
            {add.launchType === "custom" && <input value={add.launchTarget} onChange={(event) => add.setLaunchTarget(event.target.value)} placeholder="Custom path, Flatpak ID, or supported launch target" autoComplete="off" required />}
            {add.launchTarget && <p className="metadata-note path-text" title={add.launchTarget}>{add.launchTarget}</p>}
          </div>
          <button className="play-button form-submit" type="submit" disabled={add.igdbBusy}>{add.igdbBusy ? <><MochiIcon name="refresh" fallback={RefreshCw} size={16} className="spin" /> Searching IGDB...</> : add.hasIgdb ? <>Next <MochiIcon name="chevron" fallback={ChevronDown} size={16} /></> : <><MochiIcon name="plus" fallback={Plus} size={16} /> Add game</>}</button>
        </> : <>
          <p className="modal-description">{add.pendingGame?.candidates.length ? "Mochi found these matches. Approve the best match to use its artwork, description and categories." : "Mochi could not find a confident match. You can add the game without IGDB metadata."}</p>
          <div className="igdb-candidates">{add.pendingGame?.candidates.map((game) => {
            const art = resolveIgdbImage(game.cover?.url, "t_cover_big") || resolveIgdbImage(game.artworks?.[0]?.url, "t_720p");
            return <button type="button" className="igdb-candidate" key={game.id ?? game.name} onClick={() => add.approveIgdbGame(game)}><div className="igdb-candidate-art" style={{ backgroundImage: art ? `url('${art}')` : undefined }} /><div className="igdb-candidate-copy"><strong>{game.name}</strong><small>{game.genres?.map((g) => g.name).join(" · ") || "Genre unknown"}</small>{game.summary && <p>{game.summary}</p>}</div><MochiIcon name="chevron" fallback={ChevronDown} size={16} /></button>;
          })}</div>
          <div className="igdb-selection-actions"><button type="button" className="secondary-button" onClick={() => add.setStep("form")}>Back</button><button type="button" className="play-button" onClick={() => add.approveIgdbGame(null)}>Add without IGDB</button></div>
        </>}
      </form>
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

    {add.showImportPicker && <ImportPicker onClose={() => add.setShowImportPicker(false)} onImport={add.importGames} />}
  </>;
}
