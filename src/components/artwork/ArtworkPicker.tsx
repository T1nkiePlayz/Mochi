import { useCallback, useEffect, useRef, useState } from "react";
import { FolderOpen, Globe, Image as ImageIcon, Search } from "lucide-react";
import { blobToDataUrl, chooseImageFile, isImagePath, looksLikeImageUrl, prepareArtworkPreview, type ArtworkPreview, type CropRect } from "../../lib/artwork";
import type { ArtworkCandidate } from "../../lib/artworkSearch";
import { ArtworkCropper } from "./ArtworkCropper";
import { ArtworkSearchPicker } from "./ArtworkSearchPicker";

export type ArtworkSelection = { source: string; crop: CropRect };

type Props = {
  gameName: string;
  /** Called with the chosen image and crop, or null when cleared. */
  onChange: (selection: ArtworkSelection | null) => void;
  /** Shown while nothing new is chosen (the current cover). */
  current?: React.ReactNode;
};

/** Pick a cover from a file, drag-and-drop, the clipboard, a URL or an online search, then crop it. */
export function ArtworkPicker({ gameName, onChange, current }: Props) {
  const [source, setSource] = useState("");
  const [preview, setPreview] = useState<ArtworkPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [url, setUrl] = useState("");
  const [searching, setSearching] = useState(false);
  const [dragging, setDragging] = useState(false);
  const crop = useRef<CropRect | null>(null);
  const zone = useRef<HTMLDivElement>(null);

  const loadSeq = useRef(0);
  const load = useCallback(async (next: string) => {
    const mine = ++loadSeq.current;
    setBusy(true); setError(""); setSearching(false);
    try {
      const prepared = await prepareArtworkPreview(next);
      // The newest request wins when a paste and a drop (or two URLs) overlap.
      if (mine !== loadSeq.current) return;
      crop.current = null;
      setSource(next); setPreview(prepared);
    } catch (reason) { if (mine === loadSeq.current) setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { if (mine === loadSeq.current) setBusy(false); }
  }, []);

  const loadBlob = useCallback(async (blob: Blob) => {
    try { await load(await blobToDataUrl(blob)); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  }, [load]);

  // Paste an image (or an image URL) anywhere while the picker is on screen.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && target.tagName === "INPUT" && (target as HTMLInputElement).type !== "range") {
        const hasImage = Array.from(event.clipboardData?.files ?? []).some((file) => file.type.startsWith("image/"));
        if (!hasImage) return;
      }
      const file = Array.from(event.clipboardData?.files ?? []).find((item) => item.type.startsWith("image/"));
      if (file) { event.preventDefault(); void loadBlob(file); return; }
      const text = event.clipboardData?.getData("text") ?? "";
      if (looksLikeImageUrl(text)) { event.preventDefault(); setUrl(text.trim()); void load(text.trim()); }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [load, loadBlob]);

  // Native drag-and-drop (Tauri delivers file paths); the DOM handlers below cover the browser.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void import("@tauri-apps/api/webview").then(async ({ getCurrentWebview }) => {
      const stop = await getCurrentWebview().onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === "over" || payload.type === "enter") setDragging(true);
        else if (payload.type === "leave") setDragging(false);
        else if (payload.type === "drop") {
          setDragging(false);
          const path = payload.paths.find(isImagePath);
          if (path) void load(path); else setError("Drop a PNG, JPEG, WebP or GIF image.");
        }
      });
      if (disposed) stop(); else unlisten = stop;
    }).catch(() => { /* not running inside Tauri */ });
    return () => { disposed = true; unlisten?.(); };
  }, [load]);

  const choose = async () => {
    try { const path = await chooseImageFile(); if (path) await load(path); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const pickCandidate = (candidate: ArtworkCandidate) => { setUrl(candidate.url); void load(candidate.url); };
  const clear = () => { setSource(""); setPreview(null); crop.current = null; onChange(null); };

  useEffect(() => { if (!preview) onChange(null); }, [preview]); // eslint-disable-line react-hooks/exhaustive-deps

  if (searching) return <ArtworkSearchPicker initialQuery={gameName} onPick={pickCandidate} onCancel={() => setSearching(false)} />;

  return <div className="artwork-picker">
    {preview ? <>
      <ArtworkCropper src={preview.dataUrl} width={preview.width} height={preview.height} title={gameName}
        onChange={(next) => { crop.current = next; onChange({ source, crop: next }); }} />
      <p className="metadata-note">{preview.width}×{preview.height} source, saved as a 600×800 cover.</p>
      <div className="artwork-actions"><button type="button" className="secondary-button" onClick={clear}>Choose a different image</button></div>
    </> : <>
      <div ref={zone} className={`artwork-dropzone ${dragging ? "dragging" : ""}`}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
        onDrop={(event) => { event.preventDefault(); setDragging(false); const file = Array.from(event.dataTransfer.files).find((item) => item.type.startsWith("image/")); if (file) void loadBlob(file); }}>
        {current && <div className="artwork-current">{current}</div>}
        <div className="artwork-dropzone-copy">
          <ImageIcon size={22} aria-hidden="true" />
          <strong>{busy ? "Loading image…" : "Drop an image here"}</strong>
          <small>or paste one from the clipboard (Ctrl/⌘+V). PNG, JPEG, WebP or GIF.</small>
        </div>
      </div>
      <div className="artwork-source-buttons">
        <button type="button" className="secondary-button" onClick={() => void choose()} disabled={busy}><FolderOpen size={14} /> Choose file…</button>
        <button type="button" className="secondary-button" onClick={() => setSearching(true)} disabled={busy}><Search size={14} /> Find artwork online</button>
      </div>
      <form className="artwork-url-row" onSubmit={(event) => { event.preventDefault(); if (looksLikeImageUrl(url)) void load(url.trim()); else setError("Enter a full http(s) image address."); }}>
        <label><span><Globe size={13} aria-hidden="true" /> Image URL</span><input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/cover.png" inputMode="url" /></label>
        <button type="submit" className="secondary-button" disabled={busy || !url.trim()}>Load</button>
      </form>
    </>}
    {error && <p className="auth-error" role="alert">{error}</p>}
  </div>;
}
