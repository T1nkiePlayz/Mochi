import { Layers } from "lucide-react";
import type { Piko } from "../../models";
import { activeSource, launchSourcesOf } from "../../lib/launchSources";

type Props = { game: Piko; onUse: (sourceId: string) => void; onUnmerge: (sourceId?: string) => void };

/** The launchers a merged game can be started from, with Unmerge. Renders nothing for an ordinary game. */
export function GameSources({ game, onUse, onUnmerge }: Props) {
  const sources = launchSourcesOf(game);
  if (sources.length < 2) return null;
  const current = activeSource(game);
  const folded = new Set((game.mergedFrom ?? []).map((piko) => piko.id));
  return <section className="game-details-section game-sources" aria-label="Sources">
    <div className="discover-section-heading"><div><h3>Sources</h3><p>This game was found in {sources.length} places and merged. Nothing was deleted.</p></div>
      <button type="button" className="text-button" onClick={() => onUnmerge()}><Layers size={13} /> Unmerge all</button></div>
    <ul className="game-sources-list">
      {sources.map((source) => <li key={source.id} className={source.id === current?.id ? "active" : ""}>
        <span className="game-sources-copy"><strong>{source.label}</strong><small className="path-text" title={source.executablePath}>{source.executablePath}</small></span>
        <span className="game-sources-actions">
          {source.id === current?.id ? <span className="chip-static">Plays now</span> : <button type="button" className="secondary-button" onClick={() => onUse(source.id)}>Play via this</button>}
          {folded.has(source.id) && <button type="button" className="secondary-button" aria-label={`Unmerge ${source.label}`} onClick={() => onUnmerge(source.id)}>Unmerge</button>}
        </span>
      </li>)}
    </ul>
  </section>;
}
