import { useMemo } from "react";
import type { Piko } from "../../models";
import { GameArtwork } from "../GameArtwork";
import { addDays, dayKey, formatDuration, formatHours, startOfDay, weekdayIndex, type Analysis, type DayBucket } from "../../lib/stats";
import { ChartTip, DataTable, niceMax, OTHER_SERIES, seriesVar, useChartTip, useRoving } from "./chartKit";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const longDate = (date: Date) => date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });

type Series = { id: string; name: string; color: string };

/** Stacked hours-per-bucket bars; the five biggest games get their own colour, the rest share "Other". */
export function StackedBars({ buckets, games, weekly }: { buckets: DayBucket[]; games: Analysis["games"]; weekly: boolean }) {
  const { wrap, tip, bind, hide } = useChartTip();
  const roving = useRoving(buckets.length);
  const series: Series[] = games.slice(0, 5).map((game, i) => ({ id: game.gameId, name: game.name, color: seriesVar(i) }));
  const W = 720, H = 230, left = 38, right = 6, top = 10, bottom = 26;
  const plotW = W - left - right, plotH = H - top - bottom;
  const max = niceMax(Math.max(...buckets.map((b) => b.seconds), 3600) / 3600);
  const slot = plotW / buckets.length;
  const barW = Math.max(2, Math.min(34, slot * 0.72));
  const y = (hours: number) => top + plotH - (hours / max) * plotH;
  const labelEvery = buckets.length <= 7 ? 1 : buckets.length <= 31 ? 5 : 0;
  const hasOther = games.length > 5;
  return (
    <div className="stat-chart" ref={wrap} onKeyDown={(event) => { if (event.key === "Escape") hide(); }}>
      <svg ref={roving.root} viewBox={`0 0 ${W} ${H}`} role="group" aria-label={`${weekly ? "Hours played per week" : "Hours played per day"}, stacked by game`} onKeyDown={roving.onKeyDown}>
        {[0, 0.5, 1].map((fraction) => (
          <g key={fraction}>
            <line className="stat-grid" x1={left} x2={W - right} y1={y(max * fraction)} y2={y(max * fraction)} />
            <text className="stat-axis" x={left - 6} y={y(max * fraction) + 4} textAnchor="end">{max * fraction >= 1 || fraction === 0 ? `${Math.round(max * fraction * 10) / 10}h` : `${Math.round(max * fraction * 60)}m`}</text>
          </g>
        ))}
        {buckets.map((bucket, i) => {
          const x = left + i * slot + (slot - barW) / 2;
          let acc = 0;
          const parts = series.map((s) => ({ s, hours: (bucket.byGame.get(s.id) ?? 0) / 3600 }));
          const otherSeconds = bucket.seconds - series.reduce((sum, s) => sum + (bucket.byGame.get(s.id) ?? 0), 0);
          if (otherSeconds > 0) parts.push({ s: { id: "other", name: "Other", color: OTHER_SERIES }, hours: otherSeconds / 3600 });
          const label = weekly ? `Week of ${longDate(bucket.date)}` : longDate(bucket.date);
          const tipContent = (
            <><strong>{label}</strong><span>{bucket.seconds ? formatDuration(bucket.seconds) : "No play"}</span>
              {parts.filter((p) => p.hours > 0).map((p) => <span key={p.s.id} className="stat-tip-row"><i style={{ background: p.s.color }} />{p.s.name} {formatDuration(p.hours * 3600)}</span>)}</>
          );
          const showLabel = labelEvery ? i % labelEvery === 0 : i === 0 || bucket.date.getMonth() !== buckets[i - 1].date.getMonth();
          return (
            <g key={bucket.key} {...roving.item(i)} aria-label={`${label}: ${bucket.seconds ? formatDuration(bucket.seconds) : "no play"}`} {...bind(tipContent)}>
              <rect className="stat-hit" x={left + i * slot} y={top} width={slot} height={plotH} />
              {parts.map(({ s, hours }) => {
                const h = (hours / max) * plotH;
                const rect = <rect key={s.id} x={x} y={y(acc + hours)} width={barW} height={Math.max(h, 0)} fill={s.color} className="stat-bar" />;
                acc += hours;
                return rect;
              })}
              {showLabel && <text className="stat-axis" x={left + i * slot + slot / 2} y={H - 8} textAnchor="middle">{labelEvery ? (buckets.length <= 7 ? WEEKDAYS[weekdayIndex(bucket.date)] : `${bucket.date.getDate()} ${MONTHS[bucket.date.getMonth()]}`) : MONTHS[bucket.date.getMonth()]}</text>}
            </g>
          );
        })}
      </svg>
      <ChartTip tip={tip} />
      <ul className="stat-legend" aria-label="Legend">
        {series.map((s) => <li key={s.id}><i style={{ background: s.color }} />{s.name}</li>)}
        {hasOther && <li><i style={{ background: OTHER_SERIES }} />Other</li>}
      </ul>
      <DataTable caption={weekly ? "Hours played per week" : "Hours played per day"} headers={["Date", "Total", ...series.map((s) => s.name)]}
        rows={buckets.map((b) => [b.key, formatDuration(b.seconds), ...series.map((s) => formatDuration(b.byGame.get(s.id) ?? 0))])} />
    </div>
  );
}

/** Ranked games with artwork thumbnails. Plain markup: the text is the accessible content. */
export function TopGames({ games, library, limit = 8 }: { games: Analysis["games"]; library: Piko[]; limit?: number }) {
  const top = games.slice(0, limit);
  const max = top[0]?.seconds || 1;
  return (
    <ol className="stat-top-games">
      {top.map((game, i) => {
        const piko = library.find((item) => item.id === game.gameId);
        return (
          <li key={game.gameId}>
            <span className="stat-rank" aria-hidden="true">{i + 1}</span>
            {piko ? <GameArtwork className="stat-thumb" cacheKey={piko.artworkCacheKey} fallback={piko.artwork} name={piko.name} kind={piko.kind} sourceId={piko.sourceId} /> : <div className="stat-thumb" aria-hidden="true" />}
            <div className="stat-top-body">
              <div className="stat-top-line"><strong>{piko?.name ?? game.name}</strong><span>{formatDuration(game.seconds)}</span></div>
              <div className="stat-meter" aria-hidden="true"><i style={{ width: `${Math.max(3, (game.seconds / max) * 100)}%`, background: seriesVar(i) }} /></div>
              <small>{game.sessions} session{game.sessions === 1 ? "" : "s"}</small>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function SimpleBars({ values, labels, tipLabels, caption, unit, labelEvery, highlight }: {
  values: number[]; labels: string[]; tipLabels: string[]; caption: string; unit: string; labelEvery: number; highlight?: number;
}) {
  const { wrap, tip, bind, hide } = useChartTip();
  const roving = useRoving(values.length);
  const W = 360, H = 170, left = 30, top = 8, bottom = 22;
  const plotH = H - top - bottom, slot = (W - left - 4) / values.length;
  const max = niceMax(Math.max(...values, 3600) / 3600);
  const y = (hours: number) => top + plotH - (hours / max) * plotH;
  return (
    <div className="stat-chart" ref={wrap} onKeyDown={(event) => { if (event.key === "Escape") hide(); }}>
      <svg ref={roving.root} viewBox={`0 0 ${W} ${H}`} role="group" aria-label={caption} onKeyDown={roving.onKeyDown}>
        {[0, 1].map((f) => <g key={f}><line className="stat-grid" x1={left} x2={W - 4} y1={y(max * f)} y2={y(max * f)} /><text className="stat-axis" x={left - 5} y={y(max * f) + 4} textAnchor="end">{`${max * f}h`}</text></g>)}
        {values.map((seconds, i) => {
          const h = (seconds / 3600 / max) * plotH;
          const text = `${tipLabels[i]}: ${seconds ? formatDuration(seconds) : "no play"}${unit}`;
          return (
            <g key={i} {...roving.item(i)} aria-label={text} {...bind(<><strong>{tipLabels[i]}</strong><span>{seconds ? formatDuration(seconds) : "No play"}{unit}</span></>)}>
              <rect className="stat-hit" x={left + i * slot} y={top} width={slot} height={plotH} />
              <rect className={`stat-bar ${highlight === i ? "peak" : ""}`} x={left + i * slot + slot * 0.14} width={slot * 0.72} y={y(seconds / 3600)} height={Math.max(h, 0)} fill="var(--stat-s1)" rx="2" />
              {i % labelEvery === 0 && <text className="stat-axis" x={left + i * slot + slot / 2} y={H - 6} textAnchor="middle">{labels[i]}</text>}
            </g>
          );
        })}
      </svg>
      <ChartTip tip={tip} />
      <DataTable caption={caption} headers={["Period", "Time played"]} rows={values.map((v, i) => [tipLabels[i], formatDuration(v)])} />
    </div>
  );
}

const peak = (values: number[]) => (Math.max(...values) > 0 ? values.indexOf(Math.max(...values)) : undefined);

export function HourHistogram({ hours }: { hours: number[] }) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return <SimpleBars values={hours} labels={hours.map((_, i) => pad(i))} tipLabels={hours.map((_, i) => `${pad(i)}:00 to ${pad((i + 1) % 24)}:00`)}
    caption="Time played by hour of day" unit="" labelEvery={3} highlight={peak(hours)} />;
}

export function WeekdayPattern({ weekdays }: { weekdays: number[] }) {
  return <SimpleBars values={weekdays} labels={WEEKDAYS} tipLabels={WEEKDAYS} caption="Time played by weekday" unit=" in total" labelEvery={1} highlight={peak(weekdays)} />;
}

/** GitHub-style calendar of the last 53 weeks. */
export function Heatmap({ totals, now = Date.now() }: { totals: Map<string, number>; now?: number }) {
  const { wrap, tip, bind, hide } = useChartTip();
  const today = startOfDay(now);
  const first = addDays(today, -(52 * 7 + weekdayIndex(today)));
  const cells = useMemo(() => {
    const out: Array<{ date: Date; key: string; seconds: number; col: number; row: number }> = [];
    for (let d = first, i = 0; d <= today; d = addDays(d, 1), i += 1) {
      const key = dayKey(d);
      out.push({ date: d, key, seconds: totals.get(key) ?? 0, col: Math.floor(i / 7), row: i % 7 });
    }
    return out;
  }, [totals, first.getTime(), today.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps
  const roving = useRoving(cells.length, { h: 7, v: 1 });
  const max = Math.max(...cells.map((c) => c.seconds), 1);
  const level = (s: number) => (s <= 0 ? 0 : Math.min(4, Math.ceil((s / max) * 4)));
  const size = 11, gap = 3, left = 28, top = 16;
  const W = left + 53 * (size + gap), H = top + 7 * (size + gap);
  return (
    <div className="stat-chart stat-heatmap" ref={wrap} onKeyDown={(event) => { if (event.key === "Escape") hide(); }}>
      <div className="stat-heatmap-scroll">
        <svg ref={roving.root} viewBox={`0 0 ${W} ${H}`} style={{ minWidth: 640 }} role="group" aria-label="Play activity calendar for the last year" onKeyDown={roving.onKeyDown}>
          {[0, 2, 4].map((row) => <text key={row} className="stat-axis" x={left - 6} y={top + row * (size + gap) + size - 1} textAnchor="end">{WEEKDAYS[row]}</text>)}
          {cells.map((cell, i) => {
            const monthStart = cell.row === 0 && (i === 0 || cell.date.getMonth() !== addDays(cell.date, -7).getMonth());
            const text = `${longDate(cell.date)}: ${cell.seconds ? formatDuration(cell.seconds) : "no play"}`;
            return (
              <g key={cell.key} {...roving.item(i)} aria-label={text} {...bind(<><strong>{longDate(cell.date)}</strong><span>{cell.seconds ? formatDuration(cell.seconds) : "No play"}</span></>)}>
                <rect className={`stat-cell l${level(cell.seconds)}`} x={left + cell.col * (size + gap)} y={top + cell.row * (size + gap)} width={size} height={size} rx="2.5" />
                {monthStart && <text className="stat-axis" x={left + cell.col * (size + gap)} y={10}>{MONTHS[cell.date.getMonth()]}</text>}
              </g>
            );
          })}
        </svg>
      </div>
      <ChartTip tip={tip} />
      <div className="stat-heat-key" aria-hidden="true">Less{[0, 1, 2, 3, 4].map((l) => <i key={l} className={`stat-cell l${l}`} />)}More</div>
      <DataTable caption="Play time per day, last year" headers={["Date", "Time played"]} rows={cells.filter((c) => c.seconds > 0).map((c) => [c.key, formatDuration(c.seconds)])} />
    </div>
  );
}

const sourceNames: Record<string, string> = { steam: "Steam", heroic: "Heroic", lutris: "Lutris", bottles: "Bottles", itch: "itch.io", flatpak: "Flatpak", apps: "Desktop apps", manual: "Added manually" };

/** Library split by where the games came from. */
export function Composition({ library, playtime }: { library: Piko[]; playtime: Map<string, number> }) {
  const groups = new Map<string, { count: number; seconds: number }>();
  for (const piko of library) {
    const id = piko.sourceId ?? "manual";
    const group = groups.get(id) ?? { count: 0, seconds: 0 };
    group.count += 1; group.seconds += playtime.get(piko.id) ?? 0;
    groups.set(id, group);
  }
  const rows = [...groups.entries()].sort((a, b) => b[1].count - a[1].count);
  const total = library.length || 1;
  return (
    <div className="stat-composition">
      <div className="stat-stack" role="img" aria-label={`Library of ${library.length} games: ${rows.map(([id, g]) => `${sourceNames[id] ?? id} ${g.count}`).join(", ")}`}>
        {rows.map(([id, g], i) => <i key={id} style={{ width: `${(g.count / total) * 100}%`, background: i < 5 ? seriesVar(i) : OTHER_SERIES }} />)}
      </div>
      <ul className="stat-comp-list">
        {rows.map(([id, g], i) => (
          <li key={id}><i style={{ background: i < 5 ? seriesVar(i) : OTHER_SERIES }} /><span>{sourceNames[id] ?? id}</span>
            <strong>{g.count}</strong><small>{Math.round((g.count / total) * 100)}% · {g.seconds ? formatHours(g.seconds) : "no play"}</small></li>
        ))}
      </ul>
    </div>
  );
}
