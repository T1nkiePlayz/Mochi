import { useEffect, useState } from "react";
import { answerConfirm, subscribeConfirm, type PendingConfirm } from "../../lib/confirm";
import { ConfirmDialog } from "./ConfirmDialog";

/** Renders the open `confirmAction()` request, one at a time. Mounted once in AppProvider. */
export function ConfirmHost() {
  const [queue, setQueue] = useState<PendingConfirm[]>([]);
  useEffect(() => subscribeConfirm(setQueue), []);
  const current = queue[0];
  if (!current) return null;
  return <ConfirmDialog key={current.id} title={current.title} message={current.message} confirmLabel={current.confirmLabel} danger={current.danger} items={current.items}
    onCancel={() => answerConfirm(current.id, false)} onConfirm={() => answerConfirm(current.id, true)} />;
}
