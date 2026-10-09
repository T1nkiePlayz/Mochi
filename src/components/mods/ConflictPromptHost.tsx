import { useCallback, useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { answerConflict, subscribeConflicts, type PendingConflict } from "../../lib/mods/conflictPrompt";
import { checkTofuMods } from "../../lib/mods/conflictService";
import type { Issue } from "../../lib/mods/conflicts";
import { ConflictIssues } from "./ConflictIssues";
import { ModalShell } from "./ModalShell";

function ConflictDialog({ request }: { request: PendingConflict }) {
  const [issues, setIssues] = useState<Issue[]>(request.issues);
  const answer = useCallback((choice: Parameters<typeof answerConflict>[1]) => answerConflict(request.id, choice), [request.id]);
  const recheck = async () => setIssues(await checkTofuMods(request.piko, request.tofu));
  const clean = issues.length === 0;
  return <ModalShell label={`Check mods before launching ${request.piko.name}`} className="modal conflict-dialog" onClose={() => answer("cancel")}>
    <div className="confirm-heading"><span className="confirm-icon" aria-hidden="true"><AlertTriangle size={18} /></span><h2>{clean ? "All fixed" : "Some mods may not load"}</h2></div>
    <p className="modal-description">{clean ? `${request.tofu.name} looks fine now.` : `${request.tofu.name} has ${issues.length} possible problem${issues.length === 1 ? "" : "s"}. You can fix them here or launch anyway.`}</p>
    <div className="dep-body"><ConflictIssues issues={issues} tofu={request.tofu} onFixed={recheck} /></div>
    <div className="confirm-actions">
      <button type="button" className="secondary-button" onClick={() => answer("cancel")}>Cancel</button>
      {!clean && <button type="button" className="secondary-button" title="Launch now and stop checking this Tofu before launch" onClick={() => answer("launch-and-silence")}>Don’t warn for this Tofu</button>}
      <button type="button" className="play-button" data-autofocus onClick={() => answer("launch")}>{clean ? "Launch" : "Launch anyway"}</button>
    </div>
  </ModalShell>;
}

/** Renders the open pre-launch check, one at a time. Mounted once in AppProvider. */
export function ConflictPromptHost() {
  const [queue, setQueue] = useState<PendingConflict[]>([]);
  useEffect(() => subscribeConflicts(setQueue), []);
  const current = queue[0];
  return current ? <ConflictDialog key={current.id} request={current} /> : null;
}
