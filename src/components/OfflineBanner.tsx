import { WifiOff } from "lucide-react";
import { useOnline } from "../lib/offline";

export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return <div className="offline-banner" role="status" aria-live="polite">
    <WifiOff size={14} aria-hidden="true" />
    <span>You're offline. Your library, saves and cached artwork still work.</span>
  </div>;
}
