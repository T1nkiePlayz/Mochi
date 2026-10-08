import { useEffect, useRef } from "react";
import { useExperimentalStatus } from "../../state/useExperimental";
import { SettingsGroup } from "./Section";

/** Hidden entirely while the registry (src/lib/experimental.ts) is empty. */
export function ExperimentalSection() {
  const { features, enabled, unseen, setEnabled, markSeen } = useExperimentalStatus();
  // Features that were new when the section opened keep their badge for this visit.
  const newOnOpen = useRef<string[] | null>(null);
  if (newOnOpen.current === null) newOnOpen.current = unseen;
  useEffect(() => { markSeen(); }, [features.length]);
  if (!features.length) return null;
  return <SettingsGroup title="Experimental" subtitle="Unfinished features. They may change, break, or disappear." id="settings-experimental">
    {features.map((feature) => <label className="setting-row" key={feature.id}>
      <span>
        <strong>{feature.name}{newOnOpen.current?.includes(feature.id) && <span className="experimental-new-badge">New</span>}</strong>
        <small>{feature.description}</small>
        <small className="experimental-since">Added in Mochi {feature.since}</small>
      </span>
      <input className="toggle" type="checkbox" role="switch" aria-checked={enabled.includes(feature.id)} checked={enabled.includes(feature.id)} onChange={(event) => setEnabled(feature.id, event.target.checked)} aria-label={feature.name} />
    </label>)}
  </SettingsGroup>;
}
