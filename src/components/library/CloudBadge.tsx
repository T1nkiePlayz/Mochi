import type { CloudStatus } from "../../lib/cloudStatus";

const copy: Record<Exclude<CloudStatus, "none">, { mark: string; title: string; text: string; cls: string }> = {
  synced: { mark: "✓", title: "Synced to Mochi Cloud", text: "Synced", cls: "is-synced" },
  pending: { mark: "…", title: "Waiting to sync to Mochi Cloud", text: "Syncing", cls: "is-pending" },
  error: { mark: "!", title: "Not synced to Mochi Cloud: the last sync failed", text: "Not synced", cls: "not-synced" },
};

/** Per-game cloud state. Renders nothing when cloud sync does not apply, so local-only games show no warning. */
export function CloudBadge({ status, label }: { status: CloudStatus; label?: boolean }) {
  if (status === "none") return null;
  const c = copy[status];
  return <span className={`game-cloud-status ${c.cls}`} title={c.title}>{c.mark}{label ? ` ${c.text}` : ""}</span>;
}
