import { useState } from "react";
import { useTranslation } from "../../lib/useTranslation";
import { AlertTriangle, Info } from "lucide-react";
import { applyIssueAction } from "../../lib/mods/conflictService";
import { translateCompatibilityReason } from "../../lib/mods/compat";
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
  const issueDetail = (issue: Issue) => {
    if (issue.kind === "wrong-loader" || issue.kind === "wrong-version") return translateCompatibilityReason(issue.detail, t);
    if (issue.kind === "duplicate-file") return t("Both the switched-on and the switched-off copy are in the folder, so switching it on or off again can fail. Remove the copy you do not need.");
    if (issue.kind === "duplicate-project") {
      const keep = issue.detail.match(/Keep (.*), the newest\./)?.[1] ?? issue.files[0] ?? "";
      const reason = issue.id.startsWith("duplicate-title:") ? t("The same mod from different sites:") : t("Two versions of the same mod:");
      return `${reason} ${issue.files.join(", ")}. ${t("Two copies usually stop the game from starting. Keep {keep}, the newest.").replace("{keep}", keep)}`;
    }
    if (issue.kind === "incompatible") {
      const [name, other] = issue.title.split(" does not work with ");
      return t("{name} is marked incompatible with {other} by its author. Turn one of them off.").replace("{name}", name).replace("{other}", other ?? "");
    }
    if (issue.kind === "missing-dependency") {
      const name = issue.title.replace(/ is switched off$| is missing$/, "");
      const neededBy = issue.files.join(", ");
      return issue.title.endsWith(" is switched off")
        ? t("Missing requirement: {name} is installed but switched off (needed by {neededBy}).").replace("{name}", name).replace("{neededBy}", neededBy)
        : t("Missing requirement: another mod is not installed (needed by {neededBy}).").replace("{neededBy}", neededBy);
    }
    return t(issue.detail);
  };
  const run = async (issue: Issue, action: IssueAction) => {
    setBusy(`${issue.id}:${action.label}`);
    const result = await applyIssueAction(action, tofu);
    const failedFiles = result.match(/^Could not change (\d+) files?\.$/);
    setMessage(failedFiles ? t("{count} files could not be changed.").replace("{count}", failedFiles[1]) : t(result));
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
          <div className="conflict-text"><strong>{issueTitle(issue)}</strong><small>{issueDetail(issue)}</small></div>
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
