import { useEffect, useState } from 'react';
import { useReferenceLocale } from './ReferenceLocale';
import type { AppSnapshot } from '../shared/types';
import './library-chrome.css';

export type LibraryView = 'installed' | 'games' | 'apps' | 'later' | 'history' | 'queue';
export interface LibraryTabOptions { showInstalled?: boolean; showApps?: boolean; showHistory?: boolean; showLater?: boolean; showQueue?: boolean; queueInDock?: boolean; highDensity?: boolean; surface?: 'inline' | 'subnav' }
export function libraryTabItems({ showInstalled = false, showApps = false, showHistory = true, showLater = true, showQueue = true, queueInDock = false, highDensity = true, surface = 'subnav' }: LibraryTabOptions = {}): { id: LibraryView; en: string; el: string }[] {
  const games = { id: 'games' as const, en: 'My games', el: 'Τα παιχνίδια μου' };
  const secondary = [
    ...(showApps ? [{ id: 'apps' as const, en: 'Apps', el: 'Εφαρμογές' }] : []),
    ...(showHistory ? [{ id: 'history' as const, en: surface === 'subnav' ? 'Recently played' : 'Play history', el: surface === 'subnav' ? 'Πρόσφατα παιχνίδια' : 'Ιστορικό παιχνιδιού' }] : []),
    ...(showLater ? [{ id: 'later' as const, en: 'Play later', el: 'Αναπαραγωγή αργότερα' }] : []),
  ];
  const queue = showQueue && !(surface === 'subnav' && highDensity && queueInDock) ? [{ id: 'queue' as const, en: 'Queue', el: 'Ουρά' }] : [];
  return surface === 'inline' ? [games, ...secondary, ...queue] : [
    ...(showInstalled ? [{ id: 'installed' as const, en: 'Installed', el: 'Εγκατεστημένα' }] : []),
    ...secondary, ...(highDensity ? [games] : []), ...queue, ...(!highDensity ? [games] : []),
  ];
}
export function LibraryTabs({ active, select, ...options }: { active: LibraryView; select: (view: LibraryView) => void } & LibraryTabOptions) {
  const { text } = useReferenceLocale();
  const tabs = libraryTabItems(options);
  const selected = tabs.some(tab => tab.id === active) ? active : tabs[0].id;
  return <nav className="xbox-library-tabs library-tabs-v2" role="tablist" aria-label={text('Library sections', 'Ενότητες βιβλιοθήκης')}>{tabs.map(({ id, en, el }) => <button key={id} type="button" role="tab" tabIndex={selected === id ? 0 : -1} aria-selected={selected === id} id={`library-tab-${id}`} onClick={() => select(id)} onKeyDown={event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); const index = tabs.findIndex(tab => tab.id === id);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    select(tabs[next].id); requestAnimationFrame(() => document.getElementById(`library-tab-${tabs[next].id}`)?.focus());
  }}>{text(en, el)}</button>)}</nav>;
}
export interface LibraryCollections { later: string[]; history: Record<string, number> }
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
export function collectionKey(auth: AppSnapshot['auth']) { return `xboks.library-collections.v1:${encodeURIComponent(auth.username ?? auth.gamertag ?? 'local')}`; }
export function loadCollections(key: string, storage?: StorageLike): LibraryCollections {
  try {
    const value = JSON.parse((storage ?? localStorage).getItem(key) ?? '{}');
    return { later: Array.isArray(value.later) ? [...new Set(value.later.filter((id: unknown): id is string => typeof id === 'string' && id.length <= 200))] as string[] : [],
      history: Object.fromEntries(Object.entries(value.history ?? {}).filter(([id, time]) => id.length <= 200 && typeof time === 'number' && Number.isFinite(time) && time > 0)) as Record<string, number> };
  } catch { return { later: [], history: {} }; }
}
export function saveCollections(key: string, value: LibraryCollections, storage?: StorageLike): boolean {
  try { (storage ?? localStorage).setItem(key, JSON.stringify(value)); if (typeof window !== 'undefined') window.dispatchEvent(new Event('xboks-library-collections')); return true; }
  catch { return false; }
}
export function useLibraryCollections(auth: AppSnapshot['auth']) {
  const key = collectionKey(auth);
  const [entry, setEntry] = useState(() => ({ key, value: loadCollections(key) }));
  useEffect(() => {
    const refresh = () => setEntry({ key, value: loadCollections(key) }); refresh();
    window.addEventListener('xboks-library-collections', refresh);
    return () => window.removeEventListener('xboks-library-collections', refresh);
  }, [key]);
  return { collections: entry.key === key ? entry.value : loadCollections(key), update: (next: LibraryCollections) => { setEntry({ key, value: next }); return saveCollections(key, next); } };
}
