import { Github } from "lucide-react";
import { useApp } from "../../state/AppContext";
import { SettingsGroup } from "./Section";

export function HelpSection() {
  const { resetLocalData } = useApp();
  return <>
    <SettingsGroup title="Help & feedback" subtitle="Report a problem or request a feature" id="settings-help">
      <a className="setting-row help-link" href="https://github.com/T1nkiePlayz/Mochi/issues" target="_blank" rel="noreferrer"><span><strong>GitHub issues</strong><small>View known issues or report a new one.</small></span><Github size={16}/></a>
    </SettingsGroup>
    <button className="reset-button" onClick={() => void resetLocalData()}>Clear all Mochi app data</button>
  </>;
}
