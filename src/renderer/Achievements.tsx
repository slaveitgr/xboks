import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Eye, LoaderCircle, LockKeyhole, RefreshCw, Trophy, X } from 'lucide-react';
import type { AppSnapshot, GameAchievement, GameAchievements } from '../shared/types';
import './achievements.css';

export type AchievementFilter = 'all' | 'unlocked' | 'locked';
export function achievementList(items: GameAchievement[], filter: AchievementFilter): GameAchievement[] {
  return items.filter(item => filter === 'all' || (filter === 'unlocked' ? item.state === 'unlocked' : item.state !== 'unlocked'))
    .sort((a, b) => Number(b.state === 'unlocked') - Number(a.state === 'unlocked')
      || (b.unlockedAt ? Date.parse(b.unlockedAt) : 0) - (a.unlockedAt ? Date.parse(a.unlockedAt) : 0)
      || a.name.localeCompare(b.name));
}
export function achievementSummary(items: GameAchievement[]) {
  const unlocked = items.filter(item => item.state === 'unlocked');
  return { earned: unlocked.length, count: items.length,
    score: items.length && items.every(item => item.gamerscore !== undefined)
      ? `${unlocked.reduce((sum, item) => sum + item.gamerscore!, 0)} / ${items.reduce((sum, item) => sum + item.gamerscore!, 0)} G` : undefined };
}

export function AchievementCard({ item }: { item: GameAchievement }) {
  const [revealed, setRevealed] = useState(false), [failed, setFailed] = useState(false);
  const hidden = item.secret && item.state !== 'unlocked' && !revealed;
  const date = item.unlockedAt ? new Date(item.unlockedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : undefined;
  return <li className={`achievement-card ${item.state}`} data-gamepad-card tabIndex={hidden ? -1 : 0}>
    <div className="achievement-icon">{!hidden && item.iconUrl && !failed ? <img src={item.iconUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <Trophy />}</div>
    <div className="achievement-copy"><div className="achievement-title"><h3>{hidden ? 'Secret achievement' : item.name}</h3>{item.gamerscore !== undefined ? <span>{item.gamerscore} G</span> : null}</div>
      <p>{hidden ? 'Reveal the details only if you want to see spoilers.' : item.description}</p>
      <small>{item.state === 'unlocked' ? <><Check />Unlocked{date ? ` · ${date}` : ''}</> : <><LockKeyhole />{item.revoked ? 'Revoked' : item.state === 'in-progress' ? 'In progress' : 'Locked'}</>}</small>
      {!hidden && item.progress !== undefined && item.state !== 'unlocked' ? <div className="achievement-progress"><progress max={100} value={item.progress} aria-label="Achievement progress" /><span>{Math.floor(item.progress)}%</span></div> : null}
      {hidden ? <button className="gd-text-button" onClick={() => setRevealed(true)}><Eye />Reveal details</button> : null}
    </div>
  </li>;
}

export function AchievementsDialog({ title, value, close }: { title: string; value: GameAchievements; close: () => void }) {
  const [filter, setFilter] = useState<AchievementFilter>('all');
  const ref = useRef<HTMLElement>(null), onClose = useRef(close); onClose.current = close;
  const items = achievementList(value.items ?? [], filter);
  useEffect(() => {
    const origin = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    ref.current?.querySelector<HTMLElement>('[data-gamepad-cancel]')?.focus({ preventScroll: true });
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose.current(); }
      if (event.key === 'Tab') {
        const buttons = [...ref.current!.querySelectorAll<HTMLElement>('button:not(:disabled),select,[tabindex="0"]')];
        if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1)?.focus(); }
        if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0]?.focus(); }
      }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); if (origin?.isConnected) origin.focus({ preventScroll: true }); };
  }, []);
  return <div className="achievements-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
    <section ref={ref} className="achievements-dialog" role="dialog" aria-modal="true" aria-labelledby="achievements-title">
      <header><div><h2 id="achievements-title">Achievements</h2><p>{title}</p></div><button className="secondary" data-gamepad-cancel onClick={close}><X />Close<span className="gd-controller-hint" aria-hidden="true">B</span></button></header>
      <label className="achievements-filter">Show<select aria-label="Filter achievements" value={filter} onChange={event => setFilter(event.target.value as AchievementFilter)}><option value="all">All achievements</option><option value="unlocked">Unlocked</option><option value="locked">Locked</option></select></label>
      {value.partial ? <p className="achievements-warning">Only part of the achievement list is available. Counts describe loaded achievements.</p> : null}
      <ul className="achievements-list" aria-label="Achievements">{items.map(item => <AchievementCard key={item.id} item={item} />)}</ul>
      {!items.length ? <p className="achievements-empty">No achievements match this filter.</p> : null}
    </section>
  </div>;
}

function statusText(value?: GameAchievements): string {
  switch (value?.status) {
    case 'signed-out': return 'Sign in to view your Xbox achievements.';
    case 'unsupported': return 'Update the backend to read Xbox achievements.';
    case 'error': return 'Xbox achievements could not be loaded. Try refreshing.';
    default: return 'No Xbox achievements are available for this game.';
  }
}

export function AchievementsContent({ title, value, loading, refresh }: { title: string; value?: GameAchievements; loading: boolean; refresh: () => void }) {
  const [open, setOpen] = useState(false);
  useEffect(() => { if (value?.status !== 'available') setOpen(false); }, [value?.status]);
  const items = value?.status === 'available' ? value.items ?? [] : [];
  const summary = achievementSummary(items);
  return <section className="game-achievements" aria-label="Xbox achievements" aria-busy={loading}>
    <header><div><h2><Trophy />Achievements</h2>{items.length ? <p>{value?.partial ? `${summary.earned} unlocked in ${summary.count} loaded` : `${summary.earned} / ${summary.count} unlocked`}{summary.score ? ` · ${summary.score}` : ''}</p> : null}</div><div className="button-row"><button className="gd-text-button" disabled={loading} onClick={refresh} aria-label="Refresh Xbox achievements">{loading ? <LoaderCircle className="spin" /> : <RefreshCw />}Refresh</button>{items.length ? <button className="secondary" onClick={() => setOpen(true)}>View all {items.length}</button> : null}</div></header>
    {loading && !value ? <p className="achievements-empty">Loading Xbox achievements…</p> : !items.length ? <p className="achievements-empty">{value?.partial ? 'The achievement list is incomplete. Try refreshing.' : statusText(value)}</p> : <>
      {value?.partial ? <p className="achievements-warning">Incomplete list. Counts and Gamerscore describe loaded achievements only.</p> : null}
      <ul className="achievements-preview" aria-label="Recent achievements">{achievementList(items, 'all').slice(0, 3).map(item => <AchievementCard key={item.id} item={item} />)}</ul>
    </>}
    <p className="achievements-footnote">From Xbox. Availability and progress may vary by game. This view never unlocks or updates achievements.</p>
    {open && value?.status === 'available' ? <AchievementsDialog title={title} value={value} close={() => setOpen(false)} /> : null}
  </section>;
}

export function Achievements({ gameId, title, data }: { gameId: string; title: string; data: AppSnapshot }) {
  const [value, setValue] = useState<GameAchievements>(), [loading, setLoading] = useState(true);
  const request = useRef(0);
  const load = useCallback((refresh = false) => {
    const id = ++request.current; setLoading(true);
    void window.launcher.getGameAchievements(gameId, refresh).then(value => { if (request.current === id) setValue(value); })
      .catch(() => { if (request.current === id) setValue({ status: 'error' }); })
      .finally(() => { if (request.current === id) setLoading(false); });
  }, [gameId, data.auth.username, data.auth.stored, data.auth.running, data.backend.binaryPath, data.backend.capabilities.achievements]);
  useEffect(() => { setValue(undefined); load(); return () => { request.current++; }; }, [load]);
  return <AchievementsContent title={title} value={value} loading={loading} refresh={() => load(true)} />;
}
