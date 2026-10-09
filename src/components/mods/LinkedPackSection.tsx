import { useEffect, useState } from "react";
import { openExternalUrl } from "../../lib/platform";
import type { Tofu } from "../../models";
import { rematchPack, unlinkPack } from "../../lib/mods/packLink";
import type { LinkedPackInfo } from "../../lib/mods/packApi";

const HOW = { managed: "recorded by your launcher", index: "from the pack's manifest", search: "matched by name" } as const;

/** "Linked modpack: <name> · Unlink" for a Minecraft instance. Names, icons and descriptions are fetched live (CurseForge ones are never saved). */
export function LinkedPackSection({ tofu, onPatch }: { tofu: Tofu; onPatch: (change: (tofu: Tofu) => Tofu) => void }) {
  const pack = tofu.pack;
  const [info, setInfo] = useState<LinkedPackInfo | null>(null);
  const [error, setError] = useState("");
  const key = pack ? `${pack.source}:${pack.projectId}:${pack.versionId ?? ""}:${tofu.version}:${tofu.loader ?? ""}` : "";
  useEffect(() => {
    setInfo(null); setError("");
    if (!pack) return;
    let live = true;
    void import("../../lib/mods/packApi").then((api) => api.loadLinkedPack(tofu, pack)).then((value) => { if (live) setInfo(value); }).catch((reason) => { if (live) setError(reason instanceof Error ? reason.message : "Could not load the modpack."); });
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!pack) return <div className="linked-pack">
    <p className="muted">{tofu.packCheckedAt ? "No modpack was recognised for this instance." : "Looking for a matching modpack in the background."}</p>
    {tofu.packCheckedAt && <button type="button" className="secondary-button" onClick={() => onPatch(rematchPack)}>Search again</button>}
  </div>;
  const site = pack.source === "modrinth" ? "Modrinth" : "CurseForge";
  return <div className="linked-pack">
    <div className="tofu-settings-inline">
      {info?.iconUrl && <img src={info.iconUrl} alt="" width={40} height={40} loading="lazy" decoding="async" style={{ borderRadius: 8 }} />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <strong>Linked modpack: {info?.name ?? (error ? `${site} pack ${pack.projectId}` : "Loading…")}</strong>
        <small className="muted" style={{ display: "block" }}>{site} · {HOW[pack.matchedBy]}</small>
      </div>
      <button type="button" className="secondary-button" onClick={() => onPatch(unlinkPack(Date.now()))}>Unlink</button>
    </div>
    {info?.description && <p className="muted">{info.description}</p>}
    {error && <p className="muted" role="status">{error}</p>}
    {info?.update && <p role="status"><strong>Update available: {info.update.versionName}</strong> <button type="button" className="secondary-button" onClick={() => void openExternalUrl(info.pageUrl).catch(() => {})}>Open pack page</button>
      <small className="muted" style={{ display: "block" }}>Update the pack in your launcher. Mochi updates the individual mods under Updates.</small></p>}
    {pack.source === "curseforge" && <small className="metadata-note">Powered by CurseForge</small>}
  </div>;
}
