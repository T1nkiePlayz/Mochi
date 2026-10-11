import { useState } from "react";
import { useTranslation } from "../../lib/useTranslation";
import { AlertTriangle, Info } from "lucide-react";
import { applyIssueAction } from "../../lib/mods/conflictService";
import type { Issue, IssueAction } from "../../lib/mods/conflicts";
import type { Tofu } from "../../models";

const MAX_SHOWN = 12;

/** The problems found in a Tofu with one button per fix. `onFixed` re-checks after a fix changed something. */
export function ConflictIssues({ issues, tofu, onFixed }: { issues: Issue[]; tofu: Tofu; onFixed: () => void | Promise<void> }) {
  const t = useTranslation();
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [showAll, setShowAll] = useState(false);
  const issueTitle = (issue: Issue) => {
    const title = issue.title;
    if (issue.kind === "duplicate-file") return t("{name} exists twice").replace("{name}", title.replace(/ exists twice$/, ""));
    if (issue.kind === "duplicate-project") return t("{name} is installed twice").replace("{name}", title.replace(/ is installed twice$/, ""));
    if (issue.kind === "wrong-loader") return t("{name} is for a different loader").replace("{name}", title.replace(/ is for a different loader$/, ""));
    if (issue.kind === "wrong-version") return t("{name} is for a different game version").replace("{name}", title.replace(/ is for a different game version$/, ""));
    if (issue.kind === "incompatible") {
      const [name, other] = title.split(" does not work with ");
      return t("{name} does not work with {other}").replace("{name}", name).replace("{other}", other ?? "");
    }
    if (issue.kind === "missing-dependency") {
      if (title.endsWith(" is switched off")) return t("{name} is switched off").replace("{name}", title.replace(/ is switched off$/, ""));
      if (title.endsWith(" is missing")) return t("{name} is missing").replace("{name}", title.replace(/ is missing$/, ""));
    }
    return t(title);
  };
  const actionLabel = (label: string) => {
    if (label.startsWith("Disable ")) return `${t("Disable")} ${label.slice("Disable ".length)}`;
    if (label.startsWith("Enable ")) return `${t("Enable")} ${label.slice("Enable ".length)}`;
    if (label === "Disable duplicate") return t("Disable");
    return t(label);
  };
  const run = async (issue: Issue, action: IssueAction) => {
    setBusy(`${issue.id}:${action.label}`);
    setMessage(await applyIssueAction(action, tofu));
    setBusy("");
    if (action.kind !== "open-page") await onFixed();
  };
  const shown = showAll ? issues : issues.slice(0, MAX_SHOWN);
  return <div className="conflict-issues">
    <ul className="conflict-list" aria-label={t("Possible mod problems")}>
      {shown.map((issue) => {
        const Icon = issue.severity === "warning" ? AlertTriangle : Info;
        return <li key={issue.id} className="conflict-row" data-severity={issue.severity}>
          <Icon size={15} aria-hidden="true" />
          <div className="conflict-text"><strong>{issueTitle(issue)}</strong><small>{t(issue.detail)}</small></div>
          {issue.actions.length > 0 && <div className="conflict-actions">
            {issue.actions.map((action) => <button key={action.label} type="button" className="secondary-button" disabled={busy !== ""} onClick={() => void run(issue, action)}>{busy === `${issue.id}:${action.label}` ? t("Working…") : actionLabel(action.label)}</button>)}
          </div>}
        </li>;
      })}
    </ul>
    {issues.length > shown.length && <button type="button" className="text-button" onClick={() => setShowAll(true)}>{t("Show {count} more").replace("{count}", String(issues.length - shown.length))}</button>}
    <p className="conflict-message" role="status" aria-live="polite">{message}</p>
  </div>;
}
