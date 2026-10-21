import { useEffect, useState } from 'react';
import { useReferenceLocale } from './ReferenceLocale';
import type { AppSnapshot } from '../shared/types';

export type LibraryView = 'games' | 'later' | 'history' | 'queue';
const tabs: [LibraryView, string][] = [['games', 'My games'], ['later', 'Play later'], ['history', 'Play history'], ['queue', 'Install Queue']];
export function LibraryTabs({ active, select }: { active: LibraryView; select: (view: LibraryView) => void }) {
  const { language } = useReferenceLocale();
  const labels = { games: 'Τα παιχνίδια μου', later: 'Αναπαραγωγή αργότερα', history: 'Ιστορικό παιχνιδιού', queue: 'Εγκατάσταση ουράς' };
  return <div className="xbox-library-tabs" role="tablist" aria-label="Library sections">{tabs.map(([id, label]) => <button key={id} role="tab" aria-selected={active === id} id={`library-tab-${id}`} onClick={() => select(id)} onKeyDown={event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); const index = tabs.findIndex(tab => tab[0] === id);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    select(tabs[next][0]); requestAnimationFrame(() => document.getElementById(`library-tab-${tabs[next][0]}`)?.focus());
  }}>{language === 'el' ? labels[id] : label}</button>)}</div>;
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
