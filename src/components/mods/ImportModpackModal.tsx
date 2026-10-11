import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "../../lib/useTranslation";
import { ExternalLink, FileUp, X } from "lucide-react";
import { MochipackError, parseMochipackInput, type MochiPack } from "../../lib/mods/mochipack";
import { compatibilityNotes, downloadable, gameMismatch, summarizePlan, type ImportReport, type PlanItem } from "../../lib/mods/mochipackPlan";
import { buildImportPlan, pickPackFile, runImport, type ImportPlan } from "../../lib/mods/mochipackService";
import { modSupportOf } from "../../lib/mods/gameSupport";
import { titleFromFile } from "../../lib/mods/identify";
import { openExternalUrl } from "../../lib/platform";
import { supabase } from "../../lib/supabase";
import { useApp } from "../../state/AppContext";
import type { Piko, Tofu } from "../../models";
import { Checkbox } from "../ui/Checkbox";
import { ModalShell } from "./ModalShell";

type Props = { piko: Piko; tofu: Tofu; onCreateTofu: (name: string, version?: string, loader?: Tofu["loader"]) => Tofu | null; onClose: () => void };
const errorText = (error: unknown, t: (message: string) => string) => (error instanceof Error ? error.message : typeof error === "string" ? error : t("Something went wrong."))
const SHOWN = 150;
const LABEL: Record<PlanItem["availability"]["status"], string> = { ready: "Ready", manual: "Manual download", unavailable: "Unavailable", changed: "Changed" };
const PROVIDER: Record<string, string> = { modrinth: "Modrinth", curseforge: "CurseForge", nexus: "Nexus Mods" };

/** Preview and install a `.mochipack` (file or pasted code) into a new or the current Tofu. */
export function ImportModpackModal({ piko, tofu, onCreateTofu, onClose }: Props) {
  const t = useTranslation();
  const { notifications: { notify }, behavior, credentials } = useApp();
  const [text, setText] = useState("");
  const [pack, setPack] = useState<MochiPack | null>(null);
  const [error, setError] = useState("");
  const [intoNew, setIntoNew] = useState(Boolean(tofu.gameDir));
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [includeDisabled, setIncludeDisabled] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  const token = useRef({ aborted: false });
  useEffect(() => () => { token.current.aborted = true; }, []);
  const minecraft = modSupportOf(piko) === "minecraft";

  const load = async (input: string) => {
    setError(""); setPlan(null); setPack(null);
    try {
      const parsed = await parseMochipackInput(input);
      const mismatch = gameMismatch(parsed, piko);
      if (mismatch) { setError(mismatch); return; }
      setPack(parsed);
      token.current.aborted = true;
      const run = { aborted: false };
      token.current = run;
      setProgress([0, parsed.mods.length]);
      const ctx = { piko, sources: behavior.modSources, nexusKey: credentials.status.nexus && Boolean(supabase), pack: parsed };
      const built = await buildImportPlan(parsed, intoNew ? null : tofu, ctx, { signal: run, onProgress: (done, total) => { if (!run.aborted) setProgress([done, total]); } });
      if (!run.aborted) { setPlan(built); setProgress(null); }
    } catch (reason) { setProgress(null); setError(reason instanceof MochipackError ? reason.message : errorText(reason, t)); }
  };
  const chooseFile = async () => {
    try { const content = await pickPackFile(); if (content !== null) { setText(content.length > 4000 ? "" : content); await load(content); } }
    catch (reason) { setError(errorText(reason, t)); }
  };

  const summary = useMemo(() => (plan ? summarizePlan(plan.items, includeDisabled) : null), [plan, includeDisabled]);
  const notes = pack ? compatibilityNotes(pack, intoNew ? { loader: pack.loader as Tofu["loader"], version: pack.gameVersion ?? "" } : tofu, minecraft) : [];

  const start = async () => {
    if (!pack || !plan || busy) return;
    setBusy(true);
    try {
      const target = intoNew ? onCreateTofu(pack.name || "Imported modpack", pack.gameVersion, pack.loader as Tofu["loader"]) : tofu;
      if (!target) throw new Error("Could not create a Tofu. Choose a mod folder for this game first.");
      const done = await runImport(plan, target, pack, includeDisabled);
      setReport(done);
      notify(t("Modpack import started"), t("{count} downloads queued for {name}. Progress is in Downloads.").replace("{count}", String(done.queued)).replace("{name}", target.name));
    } catch (reason) { setError(errorText(reason, t)); }
    finally { setBusy(false); }
  };

  const rows = plan ? (showAll ? plan.items : plan.items.slice(0, SHOWN)) : [];
  const toInstall = plan ? downloadable(plan.items, includeDisabled).length : 0;
  const link = (item: PlanItem) => item.availability.status === "manual" && item.availability.pageUrl ? <button type="button" className="secondary-button" onClick={() => void openExternalUrl(item.availability.status === "manual" ? item.availability.pageUrl ?? "" : "").catch(() => undefined)}><ExternalLink size={11}/> {t("Open page")}</button> : null;

  return <ModalShell label={t("Import modpack")} className="modal import-pack-modal" onClose={onClose}>
    <div className="modal-header"><div><p className="eyebrow">{piko.name}</p><h2>{t("Import modpack")}</h2></div><button type="button" className="icon-button" aria-label={t("Close")} onClick={onClose}><X size={17}/></button></div>
    <div className="import-pack-body">
      {report ? <div className="import-pack-report" role="status">
        <p>{t("{count} downloads queued. Each file is checked against its checksum; failures show in Downloads.").replace("{count}", String(report.queued))}</p>
        {report.failed.length > 0 && <ReportList t={t} title={t("Could not start")} rows={report.failed.map((entry) => `${titleFromFile(entry.item.mod.fileName)}: ${entry.error}`)} />}
        {report.changed.length > 0 && <ReportList t={t} title={t("Changed since the pack was made (skipped)")} rows={report.changed.map((item) => item.mod.fileName)} />}
        {report.manual.length > 0 && <ReportList t={t} title={t("Download these by hand")} rows={report.manual.map((item) => item.mod.fileName)} />}
        {report.unavailable.length > 0 && <ReportList t={t} title={t("Not available")} rows={report.unavailable.map((item) => `${item.mod.fileName}: ${item.availability.status === "unavailable" ? item.availability.reason : ""}`)} />}
        {report.unknownFiles > 0 && <p className="muted">{t("{count} files were not matched to any site when the pack was made. They are not installed.").replace("{count}", String(report.unknownFiles))}</p>}
      </div> : <>
        <fieldset className="import-pack-target"><legend>{t("Install into")}</legend>
          <label><input type="radio" name="pack-target" checked={intoNew} disabled={!tofu.gameDir || Boolean(plan) || progress !== null} onChange={() => setIntoNew(true)} /> {t("A new Tofu")}{!tofu.gameDir && ` (${t("choose a game folder first")})`}</label>
          <label><input type="radio" name="pack-target" checked={!intoNew} disabled={Boolean(plan) || progress !== null} onChange={() => setIntoNew(false)} /> “{tofu.name}” ({t("a snapshot is saved first")})</label>
        </fieldset>
        {!pack && <div className="import-pack-input">
          <button type="button" className="secondary-button" onClick={() => void chooseFile()}><FileUp size={14}/> {t("Choose .mochipack file…")}</button>
          <label className="mochi-field"><span className="mochi-field-label">{t("Or paste a code")}</span><textarea rows={3} value={text} placeholder={t("mochipack:…")} spellCheck={false} onChange={(event) => setText(event.target.value)} /></label>
          <button type="button" className="play-button" disabled={!text.trim()} onClick={() => void load(text)}>{t("Preview")}</button>
        </div>}
        {error && <p className="metadata-note import-pack-error" role="alert">{t(error)}</p>}
        {pack && <>
          <div className="import-pack-head"><strong>{pack.name || pack.game.name}</strong><small>{pack.game.name}{pack.loader ? ` · ${pack.loader}` : ""}{pack.gameVersion ? ` · ${pack.gameVersion}` : ""} · {pack.mods.length} mod{pack.mods.length === 1 ? "" : "s"}</small></div>
          {notes.map((note) => <p key={note} className="metadata-note">{t(note)}</p>)}
          {progress && <p className="muted" role="status">{t("Checking availability…")} {progress[0]} / {progress[1]}</p>}
          {plan && summary && <>
            <p className="import-pack-summary" role="status">{t("{ready} ready · {manual} manual · {unavailable} unavailable{changed}").replace("{ready}", String(summary.ready)).replace("{manual}", String(summary.manual)).replace("{unavailable}", String(summary.unavailable)).replace("{changed}", summary.changed ? ` · ${summary.changed} changed` : "")}{plan.alreadyInstalled.length ? ` · ${t("{count} already installed").replace("{count}", String(plan.alreadyInstalled.length))}` : ""}{pack.unknown.length ? ` · ${t("{count} unidentified in pack").replace("{count}", String(pack.unknown.length))}` : ""}</p>
            {pack.mods.some((mod) => !mod.enabled) && <Checkbox checked={includeDisabled} onChange={setIncludeDisabled} label={t("Also install mods that were switched off in the pack")} description={t("They are installed switched on.")} />}
            <ul className="import-pack-list" aria-label={t("Mods in the pack")}>{rows.map((item) => <li key={`${item.mod.provider}:${item.mod.projectId}:${item.mod.fileId}`} className={`import-pack-row is-${item.availability.status}`}>
              <div className="import-pack-row-text"><strong>{titleFromFile(item.mod.fileName)}</strong><small>{item.mod.fileName} · {PROVIDER[item.mod.provider]}{item.mod.folder !== "mods" ? ` · ${item.mod.folder}` : ""}{!item.mod.enabled ? " · off in pack" : ""}</small>
                {item.availability.status !== "ready" && <small className="import-pack-reason">{t(item.availability.reason)}</small>}</div>
              <span className={`chip import-pack-status is-${item.availability.status}`}>{t(LABEL[item.availability.status])}</span>{link(item)}
            </li>)}</ul>
            {plan.items.length > SHOWN && !showAll && <button type="button" className="secondary-button" onClick={() => setShowAll(true)}>{t("Show all {count}").replace("{count}", String(plan.items.length))}</button>}
          </>}
        </>}
      </>}
    </div>
    <div className="tofu-manager-actions">
      {report ? <button type="button" className="play-button" onClick={onClose}>{t("Done")}</button> : <>
        <button type="button" className="secondary-button" onClick={onClose}>{t("Cancel")}</button>
        <button type="button" className="play-button" disabled={!plan || busy || toInstall === 0} onClick={() => void start()}>{busy ? t("Starting…") : t("Import {count} mods").replace("{count}", String(toInstall))}</button>
      </>}
    </div>
  </ModalShell>;
}

function ReportList({ title, rows, t }: { title: string; rows: string[]; t: (message: string) => string }) {
  return <div className="import-pack-report-group"><h3>{title} ({rows.length})</h3><ul>{rows.slice(0, 50).map((row, index) => <li key={index}>{row}</li>)}{rows.length > 50 && <li>{t("and {count} more").replace("{count}", String(rows.length - 50))}</li>}</ul></div>;
}
