import { useMemo, useRef } from "react";
import { ChevronRight } from "lucide-react";
import { createPreviewSource, type SectionPlan } from "../../lib/mods/allSections";
import { minecraftFilterFor } from "../../lib/mods/gameVersion";
import type { EcosystemRef } from "../../lib/mods/gameSupport";
import type { ModSource } from "../../lib/mods/types";
import { sourceLabels } from "../../lib/mods/types";
import { useNearViewport } from "../../hooks";
import type { Piko } from "../../models";
import { ModsBrowser } from "../mods/ModsBrowser";
import { GameAvatar } from "./GameAvatar";
import { MinecraftIcon } from "./DiscoveryImage";
import { ProjectSkeletons } from "./ProjectCard";

type Props = { plan: SectionPlan; source: ModSource; cacheKey: string; pikos: Piko[]; ecosystem: EcosystemRef; onSeeAll: () => void };

/** One game on Discover > All: header plus its top mods. Nothing is fetched until the section is near the screen. */
export function GameSection({ plan, source, cacheKey, pikos, ecosystem, onSeeAll }: Props) {
  const ref = useRef<HTMLElement>(null);
  const near = useNearViewport(ref, false);
  const preview = useMemo(() => createPreviewSource(source, cacheKey), [source, cacheKey]);
  const headingId = `all-section-${plan.key.replace(/[^\w-]/g, "_")}`;
  return <section ref={ref} className="all-game-section" aria-labelledby={headingId}>
    <div className="all-game-head">
      {plan.minecraft && !plan.iconUrl ? <span className="game-avatar game-avatar-glyph" aria-hidden="true"><MinecraftIcon /></span> : <GameAvatar src={plan.iconUrl} fallbackSrcs={plan.iconFallbackUrls} name={plan.name} />}
      <h3 id={headingId}>{plan.name}</h3>
      <span className="source-badge">{sourceLabels[plan.site]}</span>
      <button type="button" className="text-button all-see-all" aria-label={`See all ${plan.name} mods`} onClick={onSeeAll}>See all <ChevronRight size={14} aria-hidden="true" /></button>
    </div>
    {near
      ? <ModsBrowser preview source={preview} noun={`${plan.name} mods`} target={{ kind: "choose", pikos, ecosystem, gameName: plan.name, tofuFilter: plan.minecraft ? (tofu) => minecraftFilterFor(tofu, true) : undefined }} />
      : <div className="discover-grid mods-grid mods-preview-grid" aria-hidden="true"><ProjectSkeletons count={4} /></div>}
  </section>;
}
