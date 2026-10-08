import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type WheelEvent } from "react";
import { RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { cropFromView, type CropRect } from "../../lib/artwork";

export const COVER_RATIO = 3 / 4;
const MAX_ZOOM = 8;

type Props = {
  /** Preview image (data URL) and the size of the ORIGINAL image, which the crop is normalised against. */
  src: string;
  width: number;
  height: number;
  title?: string;
  onChange: (crop: CropRect) => void;
};

/** Portrait 3:4 cropper: drag to pan, wheel/slider to zoom, with a live card preview. */
export function ArtworkCropper({ src, width, height, title, onChange }: Props) {
  const [zoom, setZoom] = useState(1);
  const [center, setCenter] = useState<[number, number]>([0.5, 0.5]);
  const drag = useRef<{ x: number; y: number; center: [number, number] } | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const crop = cropFromView(width, height, COVER_RATIO, zoom, center[0], center[1]);

  const apply = (nextZoom: number, nextCenter: [number, number]) => {
    if (!Number.isFinite(nextZoom) || !Number.isFinite(nextCenter[0]) || !Number.isFinite(nextCenter[1])) return;
    const z = Math.min(MAX_ZOOM, Math.max(1, nextZoom));
    const next = cropFromView(width, height, COVER_RATIO, z, nextCenter[0], nextCenter[1]);
    setZoom(z);
    setCenter([next.x + next.width / 2, next.y + next.height / 2]);
    onChange(next);
  };
  // Report the initial crop once so "Save" works without touching the cropper.
  useEffect(() => { onChange(cropFromView(width, height, COVER_RATIO, 1, 0.5, 0.5)); }, [src, width, height]); // eslint-disable-line react-hooks/exhaustive-deps

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, center };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current || !stage.current) return;
    const box = stage.current.getBoundingClientRect();
    // A hidden or collapsed stage has no size; dividing by it would turn the crop into NaN.
    if (!(box.width > 0 && box.height > 0)) return;
    const dx = (event.clientX - drag.current.x) / box.width * crop.width;
    const dy = (event.clientY - drag.current.y) / box.height * crop.height;
    apply(zoom, [drag.current.center[0] - dx, drag.current.center[1] - dy]);
  };
  const onWheel = (event: WheelEvent<HTMLDivElement>) => apply(zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1), center);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = 0.04 * crop.width;
    if (event.key === "ArrowLeft") apply(zoom, [center[0] - step, center[1]]);
    else if (event.key === "ArrowRight") apply(zoom, [center[0] + step, center[1]]);
    else if (event.key === "ArrowUp") apply(zoom, [center[0], center[1] - step]);
    else if (event.key === "ArrowDown") apply(zoom, [center[0], center[1] + step]);
    else if (event.key === "+" || event.key === "=") apply(zoom * 1.15, center);
    else if (event.key === "-") apply(zoom / 1.15, center);
    else return;
    event.preventDefault();
  };

  const imageStyle = {
    width: `${100 / crop.width}%`,
    left: `${-crop.x / crop.width * 100}%`,
    top: `${-crop.y / crop.height * 100}%`,
  };

  return <div className="artwork-cropper">
    <div className="artwork-crop-main">
      <div ref={stage} className="artwork-crop-stage" tabIndex={0} role="group"
        aria-label="Cover crop. Drag or use the arrow keys to move, plus and minus to zoom."
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
        onWheel={onWheel} onKeyDown={onKeyDown}>
        <img src={src} alt="" draggable={false} style={imageStyle} />
        <span className="artwork-crop-grid" aria-hidden="true" />
      </div>
      <div className="artwork-crop-preview" aria-label="Live preview">
        <span className="eyebrow">Preview</span>
        <div className="artwork-preview-card">
          <div className="artwork-preview-art"><img src={src} alt="" draggable={false} style={imageStyle} /></div>
          <strong>{title || "Your game"}</strong>
        </div>
      </div>
    </div>
    <div className="artwork-crop-controls">
      <button type="button" className="icon-button" aria-label="Zoom out" onClick={() => apply(zoom / 1.25, center)} disabled={zoom <= 1}><ZoomOut size={15} /></button>
      <input type="range" min={1} max={MAX_ZOOM} step={0.01} value={zoom} aria-label="Zoom" onChange={(event) => apply(Number(event.target.value), center)} />
      <button type="button" className="icon-button" aria-label="Zoom in" onClick={() => apply(zoom * 1.25, center)} disabled={zoom >= MAX_ZOOM}><ZoomIn size={15} /></button>
      <button type="button" className="secondary-button" onClick={() => apply(1, [0.5, 0.5])}><RotateCcw size={13} /> Reset</button>
    </div>
  </div>;
}
