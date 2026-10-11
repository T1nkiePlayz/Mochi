import { useEffect, useRef } from "react";
import { useExperimentalStatus } from "../../state/useExperimental";
import { SettingsGroup } from "./Section";

/** Hidden entirely while the registry (src/lib/experimental.ts) is empty. */
export function ExperimentalSection() {
  const t = useTranslation();
  const { features, enabled, unseen, setEnabled, markSeen } = useExperimentalStatus();
  // Features that were new when the section opened keep their badge for this visit.
  const newOnOpen = useRef<string[] | null>(null);
  if (newOnOpen.current === null) newOnOpen.current = unseen;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- mark features as seen once per change of the list, not whenever `markSeen` changes identity
  useEffect(() => { markSeen(); }, [features.length]);
  if (!features.length) return null;
  return <SettingsGroup title={t("Experimental")} subtitle={t("Unfinished features. They may change, break, or disappear.")} id="settings-experimental">
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
