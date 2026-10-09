import { useState } from "react";
import { AlertTriangle, Info } from "lucide-react";
import { applyIssueAction } from "../../lib/mods/conflictService";
import type { Issue, IssueAction } from "../../lib/mods/conflicts";
import type { Tofu } from "../../models";

const MAX_SHOWN = 12;

/** The problems found in a Tofu with one button per fix. `onFixed` re-checks after a fix changed something. */
export function ConflictIssues({ issues, tofu, onFixed }: { issues: Issue[]; tofu: Tofu; onFixed: () => void | Promise<void> }) {
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [showAll, setShowAll] = useState(false);
  const run = async (issue: Issue, action: IssueAction) => {
    setBusy(`${issue.id}:${action.label}`);
    setMessage(await applyIssueAction(action, tofu));
    setBusy("");
    if (action.kind !== "open-page") await onFixed();
  };
  const shown = showAll ? issues : issues.slice(0, MAX_SHOWN);
  return <div className="conflict-issues">
    <ul className="conflict-list" aria-label="Possible mod problems">
      {shown.map((issue) => {
        const Icon = issue.severity === "warning" ? AlertTriangle : Info;
        return <li key={issue.id} className="conflict-row" data-severity={issue.severity}>
          <Icon size={15} aria-hidden="true" />
          <div className="conflict-text"><strong>{issue.title}</strong><small>{issue.detail}</small></div>
          {issue.actions.length > 0 && <div className="conflict-actions">
            {issue.actions.map((action) => <button key={action.label} type="button" className="secondary-button" disabled={busy !== ""} onClick={() => void run(issue, action)}>{busy === `${issue.id}:${action.label}` ? "Working…" : action.label}</button>)}
          </div>}
        </li>;
      })}
    </ul>
    {issues.length > shown.length && <button type="button" className="text-button" onClick={() => setShowAll(true)}>Show {issues.length - shown.length} more</button>}
    <p className="conflict-message" role="status" aria-live="polite">{message}</p>
  </div>;
}
