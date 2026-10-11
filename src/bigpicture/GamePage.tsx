import { useState } from "react";
import { Play, Square, Star } from "lucide-react";
import { formatPlaytime, formatRelativeTime } from "../lib/format";
import type { PlaytimeEntry } from "../lib/platform";
import type { Piko } from "../models";
import { Art } from "./Art";
import { instanceLabel, instanceTofus } from "../lib/libraryInstances";
import { cssUrl } from "../lib/metadata/merge";
import { useTranslation } from "../lib/useTranslation";

type Props = {
  piko: Piko;
  entry?: PlaytimeEntry;
  running: boolean;
  busy: boolean;
  onPlay: (tofuId?: string) => void;
  onStop: () => void;
  onFavorite: () => void;
  onPreview: (url: string) => void;
};

export function GamePage({ piko, entry, running, busy, onPlay, onStop, onFavorite, onPreview }: Props) {
  const t = useTranslation();
  const instances = instanceTofus(piko);
  const [instanceId, setInstanceId] = useState("");
  const chosenInstance = instances.find((tofu) => tofu.id === instanceId) ?? instances[0];
  const genres = [piko.platformCategory, ...(piko.categories ?? [])].filter((value): value is string => Boolean(value));
  const year = piko.firstReleaseDate ? new Date(piko.firstReleaseDate * 1000).getFullYear() : null;
  return <section className="bp-game" aria-label={piko.name}>
    <Art piko={piko} className="bp-game-cover" />
    <div className="bp-game-info">
      <p className="bp-eyebrow">{running ? t("Playing now") : entry?.lastPlayed ? `${t("Last played")} ${formatRelativeTime(entry.lastPlayed)}` : t("Ready to play")}</p>
      <h1 className="bp-hero-title">{piko.name}</h1>
      <div className="bp-stats">
        <div><small>{t("Playtime")}</small><strong>{entry?.seconds ? formatPlaytime(entry.seconds) : t("0m")}</strong></div>
        {year && <div><small>{t("Released")}</small><strong>{year}</strong></div>}
        <div><small>{t("Environments")}</small><strong>{piko.tofus.length}</strong></div>
      </div>
      {genres.length > 0 && <ul className="bp-genres">{genres.slice(0, 6).map((genre) => <li key={genre}>{t(genre)}</li>)}</ul>}
      {instances.length > 1 && <div className="bp-instances" role="group" aria-label={t("Instance to launch")}>
        {instances.map((tofu) => <button type="button" key={tofu.id} className="bp-secondary bp-instance" aria-pressed={chosenInstance?.id === tofu.id} onClick={() => setInstanceId(tofu.id)}>{tofu.name} <small>{instanceLabel(tofu)}</small></button>)}
      </div>}
      <div className="bp-hero-actions">
        {running
          ? <button type="button" className="bp-play bp-stop" data-nav-default onClick={onStop}><Square size={24} fill="currentColor" aria-hidden="true" /> {t("Stop")}</button>
          : <button type="button" className="bp-play" data-nav-default disabled={busy} onClick={() => onPlay(chosenInstance?.id)}><Play size={26} fill="currentColor" aria-hidden="true" /> {busy ? t("Starting…") : t("Play")}</button>}
        <button type="button" className="bp-secondary" aria-pressed={Boolean(piko.favorite)} onClick={onFavorite}><Star size={22} fill={piko.favorite ? "currentColor" : "none"} aria-hidden="true" /> {piko.favorite ? t("Favourite") : t("Add to favourites")}</button>
      </div>
      {piko.description ? <p className="bp-game-description">{piko.description}</p> : <p className="bp-game-description bp-muted">{t("No description yet. Edit this game in Mochi to add one.")}</p>}
      {(piko.screenshots?.length ?? 0) > 0 && <div className="bp-screens" role="list" aria-label={t("Screenshots")}>
        {piko.screenshots!.slice(0, 12).map((url, index) => <button type="button" role="listitem" className="bp-screen" key={`${index}-${url}`} aria-label={t("Screenshot {count}").replace("{count}", String(index + 1))} style={{ backgroundImage: cssUrl(url) }} onClick={() => onPreview(url)} />)}
      </div>}
    </div>
  </section>;
}
