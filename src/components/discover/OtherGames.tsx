import { useEffect, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import type { CfGame } from "../../lib/curseforge";
import { createPreviewSource, pickOtherGames } from "../../lib/mods/allSections";
import { createCurseforgeSource } from "../../lib/mods/curseforgeSource";
import { useNearViewport } from "../../hooks";
import { GameAvatar } from "./GameAvatar";
import type { StoredGame } from "./useDiscoverGames";

type Props = { cfGames: CfGame[] | null; addedIds: ReadonlySet<number>; refreshKey: number; onAdd: (game: StoredGame) => void };

/** The same stored shape the Add game picker saves for a CurseForge-only game. */
const toStored = (game: CfGame): StoredGame => ({ k: "cf", id: game.id, slug: game.slug });

/** A few popular games that are not tabs yet. Idle until scrolled near; the mod names are a tiny queued lookup per card. */
export function OtherGames({ cfGames, addedIds, refreshKey, onAdd }: Props) {
  const ref = useRef<HTMLElement>(null);
  const near = useNearViewport(ref, false);
  const picks = useMemo(() => pickOtherGames(cfGames, addedIds, 6), [cfGames, addedIds]);
  if (picks.length === 0) return null;
  return <section ref={ref} className="all-other-games" aria-labelledby="all-other-games-title">
    <div className="all-game-head"><h3 id="all-other-games-title">Other games</h3><span className="all-other-hint">Popular on CurseForge. Add one to give it a tab.</span></div>
    <div className="all-other-grid">{picks.map((game) => <OtherGameCard key={game.id} game={game} load={near} refreshKey={refreshKey} onAdd={() => onAdd(toStored(game))} />)}</div>
  </section>;
}

function OtherGameCard({ game, load, refreshKey, onAdd }: { game: CfGame; load: boolean; refreshKey: number; onAdd: () => void }) {
  const [names, setNames] = useState<string[]>([]);
  useEffect(() => {
    if (!load) return;
    let live = true;
    const source = createPreviewSource(createCurseforgeSource({ gameId: game.id, gameSlug: game.slug }), `other:${game.id}:${refreshKey}`, 3);
    void source.search({ query: "", offset: 0, limit: 3, sort: source.defaultSort }).then((page) => { if (live) setNames(page.items.map((item) => item.name)); }).catch(() => undefined);
    return () => { live = false; };
  }, [load, game.id, game.slug, refreshKey]);
  return <article className="all-other-card">
    <GameAvatar src={game.assets?.iconUrl} name={game.name} />
    <div className="all-other-copy"><strong>{game.name}</strong><small>{names.length ? names.join(", ") : " "}</small></div>
    <button type="button" className="secondary-button" aria-label={`Add ${game.name}`} onClick={onAdd}><Plus size={13} /> Add game</button>
  </article>;
}
