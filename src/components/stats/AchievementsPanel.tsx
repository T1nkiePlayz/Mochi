import { Compass, Crown, FolderTree, Flame, Footprints, Hourglass, Library, Lock, Medal, Moon, Mountain, Palette, Puzzle, Rocket, Shuffle, Sunrise, Timer, Trophy, Wrench, HelpCircle, type LucideIcon } from "lucide-react";
import { progressText, rarityLabels, type AchievementProgress, type Rarity } from "../../lib/achievements";

const icons: Record<string, LucideIcon> = { Compass, Crown, FolderTree, Flame, Footprints, Hourglass, Library, Medal, Moon, Mountain, Palette, Puzzle, Rocket, Shuffle, Sunrise, Timer, Trophy, Wrench };
const dateText = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

export function AchievementBadge({ item, unlockedAt }: { item: AchievementProgress; unlockedAt?: number }) {
  const { def } = item;
  const unlocked = unlockedAt !== undefined;
  const mystery = def.hidden && !unlocked;
  const Icon = mystery ? HelpCircle : icons[def.icon] ?? Trophy;
  const status = unlocked ? `Unlocked ${dateText(unlockedAt)}` : mystery ? "Hidden" : progressText(item);
  return (
    <li className={`ach-badge rarity-${def.rarity} ${unlocked ? "unlocked" : "locked"}`}>
      <div className="ach-icon" aria-hidden="true">{unlocked || mystery ? <Icon size={22} /> : <span className="ach-icon-locked"><Icon size={22} /><Lock size={11} /></span>}</div>
      <div className="ach-body">
        <div className="ach-title"><strong>{mystery ? "Hidden achievement" : def.title}</strong><span className="ach-rarity">{rarityLabels[def.rarity]}</span></div>
        <p>{mystery ? "Keep playing to find out what this is." : def.description}</p>
        {!unlocked && !mystery && <div className="ach-progress"><div className="stat-meter" role="progressbar" aria-label={`${def.title} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(item.fraction * 100)}><i style={{ width: `${Math.max(2, item.fraction * 100)}%` }} /></div></div>}
        <small>{status}</small>
      </div>
    </li>
  );
}

const rarityOrder: Rarity[] = ["common", "uncommon", "rare", "epic", "legendary"];

export function AchievementsPanel({ progress, unlocked }: { progress: AchievementProgress[]; unlocked: Record<string, number> }) {
  const at = (item: AchievementProgress) => unlocked[item.def.id] ?? (item.met ? Date.now() : undefined);
  const done = progress.filter((item) => at(item) !== undefined).length;
  const sorted = [...progress].sort((a, b) => Number(at(b) !== undefined) - Number(at(a) !== undefined) || rarityOrder.indexOf(a.def.rarity) - rarityOrder.indexOf(b.def.rarity) || b.fraction - a.fraction);
  return (
    <section aria-labelledby="ach-heading" className="stats-card ach-panel">
      <div className="stats-card-head"><h2 id="ach-heading">Achievements</h2><span className="stats-muted">{done} of {progress.length} unlocked</span></div>
      <div className="stat-meter wide" role="progressbar" aria-label="Achievements unlocked" aria-valuemin={0} aria-valuemax={progress.length} aria-valuenow={done}><i style={{ width: `${(done / Math.max(1, progress.length)) * 100}%` }} /></div>
      <p className="stats-muted">These are Mochi's own achievements, tracked on this device from your play history and library. In-game achievements from Steam and other stores need their own services and are not included.</p>
      <ul className="ach-grid">{sorted.map((item) => <AchievementBadge key={item.def.id} item={item} unlockedAt={at(item)} />)}</ul>
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
