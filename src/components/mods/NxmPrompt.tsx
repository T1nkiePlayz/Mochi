import { useEffect, useMemo, useState } from "react";
import { Download, X } from "lucide-react";
import { startModDownload } from "../../lib/downloads";
import { getNexusDownload, getNexusFiles, getNexusModDetail } from "../../lib/nexus";
import { ensureTofuFolder } from "../../lib/mods/autoFolder";
import { modSupportOf } from "../../lib/mods/gameSupport";
import { nexusFileDate } from "../../lib/mods/helpers";
import { nxmExpired, parseNxmLink, type NxmLink } from "../../lib/mods/nxm";
import { contentFolder } from "../../lib/mods/targets";
import { supabase } from "../../lib/supabase";
import type { Piko, Tofu } from "../../models";
import { useApp } from "../../state/AppContext";
import { dismissNxmLink, nxmIntent, useNxmQueue } from "../../state/nxmLinks";
import { Select } from "../ui/Select";
import { ModalShell } from "./ModalShell";

const errorText = (error: unknown) => (error instanceof Error ? error.message : typeof error === "string" ? error : "The download could not start.");

/** Shows the oldest waiting nxm:// link (one at a time). */
export function NxmPrompt() {
  const queue = useNxmQueue();
  const url = queue[0];
  if (!url) return null;
  return <NxmDialog key={url} url={url} onClose={() => dismissNxmLink(url)} />;
}

/** Which Tofus can take a file of `gameDomain`: games linked to that Nexus domain first, then every other moddable game. */
function choicesFor(library: readonly Piko[], gameDomain: string) {
  const linked = library.filter((piko) => piko.modLinks?.nexus?.domain === gameDomain);
  const others = library.filter((piko) => !linked.includes(piko) && modSupportOf(piko) === "ecosystem");
  return [...linked, ...others].flatMap((piko) => piko.tofus.map((tofu) => ({ piko, tofu, linked: linked.includes(piko) })));
}

function NxmDialog({ url, onClose }: { url: string; onClose: () => void }) {
  const { lib, credentials, account, setActiveNav } = useApp();
  const parsed = useMemo(() => parseNxmLink(url), [url]);
  const link: NxmLink | null = parsed.ok ? parsed.link : null;
  const choices = useMemo(() => (link ? choicesFor(lib.library, link.gameDomain) : []), [lib.library, link]);
  const preferred = link ? nxmIntent(link.gameDomain, link.modId) : undefined;
  const [choice, setChoice] = useState(() => {
    const remembered = preferred && choices.find((entry) => entry.tofu.id === preferred.tofuId);
    const first = remembered ?? choices[0];
    return first ? `${first.piko.id}\n${first.tofu.id}` : "";
  });
  const [title, setTitle] = useState("");
  const [state, setState] = useState<"idle" | "working" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  const client = supabase;
  const ready = Boolean(client && account.user && credentials.status.nexus);

  useEffect(() => {
    if (!link || !client || !ready) return;
    let live = true;
    void getNexusModDetail(client, link.gameDomain, link.modId).then((detail) => { if (live) setTitle(detail.name); }).catch(() => undefined);
    return () => { live = false; };
  }, [link, client, ready]);

  const download = async () => {
    if (!link || !client) return;
    const [pikoId, tofuId] = choice.split("\n");
    const piko = lib.library.find((item) => item.id === pikoId);
    const tofu = piko?.tofus.find((item) => item.id === tofuId);
    if (!piko || !tofu) { setMessage("Choose a Tofu first."); return; }
    if (nxmExpired(link)) { setState("error"); setMessage("This download link expired. Click \"Mod Manager Download\" on Nexus Mods again."); return; }
    setState("working"); setMessage("");
    try {
      const save = (patch: Partial<Tofu>) => lib.updateGame(piko.id, { tofus: piko.tofus.map((item) => (item.id === tofu.id ? { ...item, ...patch } : item)) });
      const target = await ensureTofuFolder(piko, tofu, save);
      const folder = target ? contentFolder(target, "mod") : undefined;
      if (!target || !folder) throw new Error(`${tofu.name} has no mod folder yet. Choose one under Mod folders on the game page, then click the link again.`);
      const [resolved, files] = await Promise.all([
        getNexusDownload(client, link.gameDomain, link.modId, link.fileId, { key: link.key, expires: link.expires }),
        getNexusFiles(client, link.gameDomain, link.modId).catch(() => []),
      ]);
      const file = files.find((entry) => entry.fileId === link.fileId);
      const name = title || file?.name || `Nexus mod ${link.modId}`;
      await startModDownload({
        provider: "nexus", url: resolved.url, path: folder.path, subdir: folder.subdir, tofuId: target.id, tofuName: target.name, itemName: name,
        filename: resolved.fileName || file?.fileName || `nexus-${link.modId}-${link.fileId}.zip`, extract: target.extractArchives === true,
        record: { source: "nexus", projectId: String(link.modId), fileId: String(link.fileId), version: file?.version, title: name, fileDate: nexusFileDate(file?.uploadedAt) },
      });
      setState("done"); setMessage(`Downloading ${name} into ${target.name}. Progress is in Downloads.`);
    } catch (error) { setState("error"); setMessage(errorText(error)); }
  };

  const options = choices.map(({ piko, tofu, linked }) => ({ value: `${piko.id}\n${tofu.id}`, label: `${piko.name}: ${tofu.name}`, group: linked ? "Linked to this game on Nexus Mods" : "Other games" }));
  return <ModalShell label="Nexus Mods download" className="modal nxm-modal" onClose={onClose}>
    <div className="modal-header"><div><p className="eyebrow">Nexus Mods · Mod Manager Download</p><h2>{title || (link ? `Mod ${link.modId}` : "Download link")}</h2></div><button type="button" className="icon-button" aria-label="Close" onClick={onClose}><X size={17} /></button></div>
    {!link ? <p className="metadata-note" role="alert">{parsed.ok ? "" : parsed.reason}</p>
      : !ready ? <div className="nxm-body"><p className="metadata-note" role="status">{!client ? "Mochi cloud features are not available in this build, so Nexus Mods downloads cannot start." : !account.user ? "Sign in to Mochi and save your Nexus Mods API key to download from this link." : "Save your Nexus Mods API key in Settings to download from this link."}</p>
        {client && <button type="button" className="secondary-button" onClick={() => { setActiveNav("Settings"); onClose(); }}>Open Settings</button>}</div>
      : <div className="nxm-body">
        <p className="muted">File {link.fileId} of mod {link.modId} for <strong>{link.gameDomain}</strong>. Pick the Tofu it goes into.</p>
        {options.length ? <label className="mochi-field"><span className="mochi-field-label">Tofu</span><Select value={choice} onChange={setChoice} options={options} label="Tofu" searchable={options.length > 8} /></label>
          : <p className="metadata-note" role="status">No game in your library can take Nexus mods for {link.gameDomain}. Add the game first.</p>}
        {message && <p className={`metadata-note ${state === "error" ? "is-error" : ""}`} role={state === "error" ? "alert" : "status"}>{message}</p>}
        <div className="nxm-actions">
          <button type="button" className="secondary-button" onClick={onClose}>{state === "done" ? "Close" : "Cancel"}</button>
          {state !== "done" && <button type="button" className="play-button" disabled={!options.length || state === "working"} onClick={() => void download()}><Download size={14} /> {state === "working" ? "Starting…" : "Download"}</button>}
        </div>
      </div>}
  </ModalShell>;
}
