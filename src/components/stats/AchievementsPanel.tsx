import { useMemo, useState } from "react";
import {
  Award, BadgeCheck, Boxes, CalendarCheck, CalendarDays, CalendarRange, Compass, Crown, Dices, Flame, FolderTree, Footprints, Gamepad, Gamepad2, Gift, HelpCircle, Hourglass, Layers, Leaf,
  Library, Lock, Map as MapIcon, Medal, Moon, Mountain, Palette, PartyPopper, PenLine, Puzzle, RotateCcw, Rocket, Shapes, Shuffle, Star, Sunrise, Tag, Timer, Trophy, Tv, Undo2, Wrench, Zap, Heart,
  type LucideIcon,
} from "lucide-react";
import { useApp } from "../../state/AppContext";
import { useSteamSync } from "../../state/useSteamSync";
import { achievementCategories, progressText, rarityLabels, visibleAchievements, type AchievementCategory, type AchievementFilter, type AchievementProgress } from "../../lib/achievements";

const icons: Record<string, LucideIcon> = {
  Award, BadgeCheck, Boxes, CalendarCheck, CalendarDays, CalendarRange, Compass, Crown, Dices, Flame, FolderTree, Footprints, Gamepad, Gamepad2, Gift, Hourglass, Layers, Leaf, Library,
  Medal, Moon, Mountain, Palette, PartyPopper, PenLine, Puzzle, RotateCcw, Rocket, Shapes, Shuffle, Star, Sunrise, Tag, Timer, Trophy, Tv, Undo2, Wrench, Zap, Heart, Map: MapIcon,
};
const dateText = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
const roman = ["", "I", "II", "III", "IV", "V", "VI", "VII"];

export function AchievementBadge({ item, unlockedAt }: { item: AchievementProgress; unlockedAt?: number }) {
  const { def } = item;
  const unlocked = unlockedAt !== undefined;
  const mystery = def.hidden && !unlocked;
  const Icon = mystery ? HelpCircle : icons[def.icon] ?? Trophy;
  const status = unlocked ? `Unlocked ${dateText(unlockedAt)}` : mystery ? "Hidden" : progressText(item);
  const tier = def.tierCount && def.tierCount > 1 && def.tier ? `Tier ${roman[def.tier] ?? def.tier} of ${roman[def.tierCount] ?? def.tierCount}` : "";
  return (
    <li className={`ach-badge rarity-${def.rarity} ${unlocked ? "unlocked" : "locked"}`} data-category={def.category}>
      <div className="ach-icon" aria-hidden="true">{unlocked || mystery ? <Icon size={22} /> : <span className="ach-icon-locked"><Icon size={22} /><Lock size={11} /></span>}</div>
      <div className="ach-body">
        <div className="ach-title"><strong>{mystery ? "Hidden achievement" : def.title}</strong><span className="ach-rarity">{rarityLabels[def.rarity]}</span></div>
        <p>{mystery ? "Keep playing to find out what this is." : def.description}</p>
        {!unlocked && !mystery && item.available && <div className="ach-progress"><div className="stat-meter" role="progressbar" aria-label={`${def.title} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(item.fraction * 100)} aria-valuetext={progressText(item)}><i style={{ width: `${Math.max(2, item.fraction * 100)}%` }} /></div></div>}
        <small>{status}{tier && !mystery ? <span className="ach-tier"> · {tier}</span> : null}</small>
      </div>
    </li>
  );
}

const statusOptions: Array<{ value: AchievementFilter["status"]; label: string }> = [{ value: "all", label: "All" }, { value: "unlocked", label: "Unlocked" }, { value: "locked", label: "Locked" }];

export function AchievementsPanel({ progress, unlocked }: { progress: AchievementProgress[]; unlocked: Record<string, number> }) {
  const { lib } = useApp();
  const sync = useSteamSync(lib.library);
  const [category, setCategory] = useState<AchievementFilter["category"]>("all");
  const [status, setStatus] = useState<AchievementFilter["status"]>("all");
  const at = (item: AchievementProgress) => unlocked[item.def.id] ?? (item.met ? Date.now() : undefined);
  const done = progress.filter((item) => at(item) !== undefined).length;
  const perCategory = useMemo(() => {
    const counts = new Map<AchievementCategory, { done: number; total: number }>();
    for (const item of progress) {
      const entry = counts.get(item.def.category) ?? { done: 0, total: 0 };
      entry.total += 1;
      if (unlocked[item.def.id] !== undefined || item.met) entry.done += 1;
      counts.set(item.def.category, entry);
    }
    return counts;
  }, [progress, unlocked]);
  const shown = useMemo(() => visibleAchievements(progress, unlocked, { category, status }), [progress, unlocked, category, status]);
  const steamWaiting = progress.some((item) => item.def.requires === "steam" && !item.available);
  const showSteamNote = (category === "all" || category === "Steam") && steamWaiting;

  return (
    <section aria-labelledby="ach-heading" className="stats-card ach-panel">
      <div className="stats-card-head"><h2 id="ach-heading">Achievements</h2><span className="stats-muted">{done} of {progress.length} unlocked</span></div>
      <div className="stat-meter wide" role="progressbar" aria-label="Achievements unlocked" aria-valuemin={0} aria-valuemax={progress.length} aria-valuenow={done}><i style={{ width: `${(done / Math.max(1, progress.length)) * 100}%` }} /></div>
      <p className="stats-muted">Mochi's own achievements, tracked on this device from your play history and library. Tiered ones show the next tier to go for. Steam achievements for each game are in its Overview.</p>
      <div className="ach-filters">
        <div className="ach-chips" role="group" aria-label="Achievement categories">
          <button type="button" className="ach-chip" aria-pressed={category === "all"} onClick={() => setCategory("all")}>All <small>{done}/{progress.length}</small></button>
          {achievementCategories.map((name) => {
            const counts = perCategory.get(name);
            return counts ? <button key={name} type="button" className="ach-chip" aria-pressed={category === name} onClick={() => setCategory(name)}>{name} <small>{counts.done}/{counts.total}</small></button> : null;
          })}
        </div>
        <div className="ach-chips" role="group" aria-label="Achievement status">
          {statusOptions.map((option) => <button key={option.value} type="button" className="ach-chip" aria-pressed={status === option.value} onClick={() => setStatus(option.value)}>{option.label}</button>)}
        </div>
      </div>
      {showSteamNote && (
        <div className="ach-steam-note" role="status">
          <span>Steam achievements count once Steam data has been loaded. {sync.count ? "Load it for every Steam game in your library, or open a game's Overview." : "Import Steam games to use them."}</span>
          {sync.count > 0 && <button type="button" className="secondary-button" onClick={() => void sync.start()} disabled={sync.running}>{sync.running ? `Syncing ${sync.done} of ${sync.total}…` : "Sync Steam achievements"}</button>}
          {sync.message && !sync.running && <small>{sync.message}</small>}
        </div>
      )}
      {shown.length ? <ul className="ach-grid">{shown.map((item) => <AchievementBadge key={item.def.id} item={item} unlockedAt={at(item)} />)}</ul> : <p className="stats-muted">Nothing matches these filters.</p>}
    </section>
  );
}

export function RecentAchievements({ progress, unlocked, onOpen }: { progress: AchievementProgress[]; unlocked: Record<string, number>; onOpen: () => void }) {
  const recent = progress.filter((item) => unlocked[item.def.id] !== undefined).sort((a, b) => unlocked[b.def.id] - unlocked[a.def.id]).slice(0, 4);
  return (
    <section className="stats-card" aria-labelledby="recent-ach">
      <div className="stats-card-head"><h2 id="recent-ach">Recent achievements</h2><button type="button" className="stats-link" onClick={onOpen}>View all</button></div>
      {recent.length ? <ul className="ach-grid compact">{recent.map((item) => <AchievementBadge key={item.def.id} item={item} unlockedAt={unlocked[item.def.id]} />)}</ul>
        : <p className="stats-muted">Nothing unlocked yet. Launch a game to earn your first one.</p>}
    </section>
  );
}
