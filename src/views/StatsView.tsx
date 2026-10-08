import { BarChart3 } from "lucide-react";
import { MochiIcon } from "../components/MochiIcon";

export function StatsView() {
  return <div className="empty-state"><div className="empty-icon"><MochiIcon name="stats" fallback={BarChart3} size={23} /></div><h2>Playtime stats</h2><p>Coming together.</p></div>;
}
