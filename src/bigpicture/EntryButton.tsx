import { Tv } from "lucide-react";
import { enterBigPicture } from "./mode";

/** Topbar button that switches to Big Picture. Also reachable with F11 and Start + Select (hold). */
export function BigPictureButton() {
  return <button type="button" className="icon-button" aria-label="Open Big Picture mode" title="Big Picture (F11)" onClick={enterBigPicture}><Tv size={17} aria-hidden="true" /></button>;
}
