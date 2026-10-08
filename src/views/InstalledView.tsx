import { Grid2X2 } from "lucide-react";
import { MochiIcon } from "../components/MochiIcon";

export function InstalledView() {
  return <div className="empty-state"><div className="empty-icon"><MochiIcon name="installed" fallback={Grid2X2} size={23} /></div><h2>Installed</h2><p>Coming together.</p></div>;
}
