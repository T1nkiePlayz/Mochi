import { useState } from "react";
import { Copy, Download, FileUp, Share2 } from "lucide-react";
import { encodeShortCode, serializeMochipack, shortCodeSupported } from "../../lib/mods/mochipack";
import { countUnidentified, exportTofuPack, listTofuFiles, savePackFile } from "../../lib/mods/mochipackService";
import { scanTofuMods } from "../../lib/mods/scanService";
import { isOnline } from "../../lib/offline";
import { supabase } from "../../lib/supabase";
import { useApp } from "../../state/AppContext";
import { useTranslation } from "../../lib/useTranslation";
import type { Piko, Tofu } from "../../models";
import { Checkbox } from "../ui/Checkbox";
import { ImportModpackModal } from "./ImportModpackModal";

const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : typeof error === "string" ? error : fallback);

/** Share a Tofu's mod list as a `.mochipack` file or short code, and import one (see docs/mochipack.md). */
export function TofuShareSection({ piko, tofu, onCreateTofu }: { piko: Piko; tofu: Tofu; onCreateTofu: (name: string, version?: string, loader?: Tofu["loader"]) => Tofu | null }) {
  const { notifications: { notify }, behavior, credentials } = useApp();
  const t = useTranslation();
  const [identify, setIdentify] = useState(true);
  const [busy, setBusy] = useState<"" | "file" | "code">("");
  const [status, setStatus] = useState("");
  const [importing, setImporting] = useState(false);
  const codeOk = shortCodeSupported();

  /** Optionally identifies unmatched files first, then builds the pack. */
  const build = async () => {
    if (identify && isOnline()) {
      const unknown = countUnidentified(await listTofuFiles(piko, tofu));
      if (unknown) { setStatus(t("Identifying unknown files…")); await scanTofuMods(piko, tofu, behavior.modSources, credentials.status.nexus && Boolean(supabase)).catch(() => undefined); }
    }
    setStatus(t("Reading the mod list…"));
    return exportTofuPack(piko, tofu);
  };
  const describe = (mods: number, unknown: number, omitted: number) => `${mods} mod${mods === 1 ? "" : "s"}${unknown ? `, ${unknown} unidentified file${unknown === 1 ? "" : "s"} (hash only)` : ""}${omitted ? `, ${omitted} could not be listed` : ""}.`;

  const run = async (kind: "file" | "code") => {
    if (busy) return;
    setBusy(kind);
    try {
      const { pack, omitted } = await build();
      if (!pack.mods.length && !pack.unknown.length) { setStatus(""); notify(t("Nothing to share"), t("This Tofu has no mods yet.")); return; }
      if (kind === "file") {
        const path = await savePackFile(serializeMochipack(pack), tofu.name);
        setStatus(path ? `Saved. ${describe(pack.mods.length, pack.unknown.length, omitted)}` : "");
        if (path) notify(t("Modpack exported"), path);
      } else {
        const code = await encodeShortCode(pack);
        if (!code) { setStatus(""); notify(t("Too big for a short code"), t("Use Export file instead.")); return; }
        await navigator.clipboard.writeText(code);
        setStatus(`Code copied (${code.length} characters). ${describe(pack.mods.length, pack.unknown.length, omitted)}`);
        notify(t("Code copied"), t("Paste it into Import modpack on another device."));
      }
    } catch (error) { setStatus(""); notify(kind === "file" ? t("Export failed") : t("Could not copy the code"), errorText(error, "Something went wrong.")); }
    finally { setBusy(""); }
  };

  const disabled = !tofu.path || busy !== "";
  return <div className="tofu-share">
    <Checkbox checked={identify} onChange={setIdentify} label="Identify unknown files first" description="Looks unmatched files up on Modrinth, CurseForge and Nexus Mods by hash so more of the pack can be re-downloaded." />
    <div className="tofu-share-actions">
      <button type="button" className="play-button" disabled={disabled} onClick={() => void run("file")}><Download size={14}/> Export file</button>
      <button type="button" className="secondary-button" disabled={disabled || !codeOk} title={codeOk ? "Copy a short code you can paste into a chat" : "This web view cannot make short codes"} onClick={() => void run("code")}><Copy size={14}/> Copy code</button>
      <button type="button" className="secondary-button" onClick={() => setImporting(true)}><FileUp size={14}/> Import modpack…</button>
    </div>
    <p className="metadata-note tofu-share-note" role="status" aria-live="polite">{busy ? status || "Working…" : status || <><Share2 size={12}/> The pack holds ids and hashes only, never mod files.</>}</p>
    {importing && <ImportModpackModal piko={piko} tofu={tofu} onCreateTofu={onCreateTofu} onClose={() => setImporting(false)} />}
  </div>;
}
