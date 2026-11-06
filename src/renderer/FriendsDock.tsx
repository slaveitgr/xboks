import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Headphones, MessageCircle, UserRoundPlus } from 'lucide-react';
import { CircleUserRound, RefreshCw, Search, X } from './XboxIcons';
import type { AuthStatus, LauncherApi } from '../shared/types';
import type { XboxFriend } from '../shared/xbox-social';
import { useReferenceLocale } from './ReferenceLocale';
import './friends-dock.css';

type DockBridge = Pick<LauncherApi, 'getXboxFriends' | 'searchXboxPeople'>;
type Text = (en: string, el: string) => string;
export type FriendsDockPeer = Pick<XboxFriend, 'xuid' | 'gamertag'>;
export type FriendsDockProps = {
  auth: AuthStatus;
  openFriends: (initialTab?: 'friends' | 'chats') => void;
  openAccount: () => void;
  onOpenPeer?: (peer: FriendsDockPeer) => void;
};
export type FriendsDockState = {
  status: 'loading' | 'ready' | 'error' | 'unsupported';
  friends: XboxFriend[];
  presence: boolean;
  canChat: boolean;
  canSearch: boolean;
  loading: boolean;
  search?: { query: string; status: 'loading' | 'ready' | 'error'; friends: XboxFriend[]; canChat: boolean; presence: boolean };
};
const initialState = (): FriendsDockState => ({ status: 'loading', friends: [], presence: false, canChat: false, canSearch: false, loading: false });
export const friendsDockAccountKey = (auth: AuthStatus) => JSON.stringify([auth.stored, auth.running, auth.username ?? null]);
export const validFriendsDockQuery = (query: string) => Boolean(query.trim()) && [...query.trim()].length <= 64 && !/[\x00-\x1f\x7f]/.test(query);

/** Each account gets a separate, disposable session. Main owns the short-lived
 * social cache; the dock does not persist private data or perform mutations. */
export class FriendsDockSession {
  private value = initialState();
  private closed = false;
  private reading?: Promise<void>;
  private searchVersion = 0;
  constructor(private readonly bridge: DockBridge | undefined, private readonly changed: (value: FriendsDockState) => void) {}
  get current(): FriendsDockState { return this.value; }
  private publish(patch: Partial<FriendsDockState>): void {
    if (this.closed) return;
    this.value = { ...this.value, ...patch }; this.changed(this.value);
  }
  read(refresh = false): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (this.reading) return this.reading;
    if (!this.bridge?.getXboxFriends) { this.publish({ status: 'unsupported', loading: false }); return Promise.resolve(); }
    this.publish({ loading: true });
    const job = (async () => {
      try {
        const result = await this.bridge!.getXboxFriends(refresh);
        if (this.closed) return;
        if (result.status !== 'ready' || !result.capabilities.friends || !Array.isArray(result.friends)) {
          this.publish({ status: result.status === 'unsupported' || result.status === 'ready' && !result.capabilities.friends ? 'unsupported' : 'error', friends: [], presence: false, canChat: false, canSearch: false });
          return;
        }
        this.publish({ status: 'ready', friends: result.friends, presence: result.capabilities.presence,
          canChat: result.capabilities.conversation, canSearch: result.capabilities.search && Boolean(this.bridge?.searchXboxPeople) });
      } catch { this.publish({ status: 'error', friends: [], presence: false, canChat: false, canSearch: false }); }
      finally { this.publish({ loading: false }); }
    })();
    this.reading = job;
    void job.finally(() => { if (this.reading === job) this.reading = undefined; });
    return job;
  }
  async search(query: string): Promise<void> {
    if (this.closed || !this.value.canSearch || !validFriendsDockQuery(query)) return;
    const version = ++this.searchVersion, text = query.trim();
    this.publish({ search: { query: text, status: 'loading', friends: [], canChat: false, presence: false } });
    try {
      const result = await this.bridge!.searchXboxPeople(text);
      if (this.closed || version !== this.searchVersion) return;
      const ready = result.status === 'ready' && result.capabilities.search && Array.isArray(result.friends);
      this.publish({ search: { query: text, status: ready ? 'ready' : 'error', friends: ready ? result.friends! : [],
        canChat: ready && result.capabilities.conversation, presence: ready && result.capabilities.presence } });
    } catch {
      if (version === this.searchVersion) this.publish({ search: { query: text, status: 'error', friends: [], canChat: false, presence: false } });
    }
  }
  clearSearch(): void { this.searchVersion++; this.publish({ search: undefined }); }
  close(): void { this.closed = true; this.searchVersion++; this.value = initialState(); }
}

export function visibleFriendsDock(element: HTMLElement | null, doc: Document = document): boolean {
  if (!element || doc.visibilityState !== 'visible' || !element.getClientRects().length) return false;
  const style = doc.defaultView?.getComputedStyle(element);
  return !style || style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse';
}

const presenceLabel = (friend: XboxFriend, available: boolean, t: Text) => !available || friend.presence === 'unknown'
  ? t('Presence unavailable', 'Η παρουσία δεν είναι διαθέσιμη')
  : friend.activity || (friend.presence === 'online' ? t('Online', 'Σε σύνδεση') : friend.presence === 'away' ? t('Away', 'Απουσιάζει') : t('Offline', 'Χωρίς σύνδεση'));

function FriendAvatar({ friend, presence }: { friend: XboxFriend; presence: boolean }) {
  const [failed, setFailed] = useState(false);
  return <span className={`friends-dock-avatar presence-${presence ? friend.presence : 'unknown'}`}>
    {friend.gamerpicUrl && !failed ? <img src={friend.gamerpicUrl} alt="" onError={() => setFailed(true)} /> : <CircleUserRound />}
  </span>;
}

export function FriendsDock({ auth, ...actions }: FriendsDockProps) {
  return <FriendsDockAccount key={friendsDockAccountKey(auth)} auth={auth} {...actions} />;
}
function FriendsDockAccount({ auth, openFriends, openAccount, onOpenPeer }: FriendsDockProps) {
  const { text: t } = useReferenceLocale(), id = useId(), root = useRef<HTMLElement>(null);
  const session = useRef<FriendsDockSession>();
  const [state, setState] = useState(initialState), [query, setQuery] = useState(''), [limit, setLimit] = useState(100);
  const signedIn = auth.stored === true && !auth.running;
  useEffect(() => {
    if (!signedIn) return;
    const owned = new FriendsDockSession(typeof window === 'undefined' ? undefined : window.launcher, setState);
    session.current = owned;
    const refresh = () => { if (visibleFriendsDock(root.current)) void owned.read(); };
    refresh();
    const timer = window.setInterval(refresh, 25_000);
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh);
    // Layout changes may reveal the dock without a window focus event.
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(refresh);
    if (root.current) observer?.observe(root.current);
    return () => { owned.close(); session.current = undefined; window.clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); observer?.disconnect(); };
  }, [signedIn]);
  const searching = Boolean(state.search), result = state.search;
  const presence = result?.presence ?? state.presence, canChat = result?.canChat ?? state.canChat;
  const friends = result?.friends ?? state.friends;
  const displayed = friends;
  const openPeer = (friend: XboxFriend) => onOpenPeer ? onOpenPeer({ xuid: friend.xuid, gamertag: friend.gamertag }) : openFriends('friends');
  function search(event: FormEvent) {
    event.preventDefault();
    if (!state.canSearch || !validFriendsDockQuery(query) || result?.status === 'loading') return;
    setLimit(100); void session.current?.search(query);
  }
  const clear = () => { session.current?.clearSearch(); setQuery(''); setLimit(100); root.current?.querySelector<HTMLInputElement>('input')?.focus(); };
  const error = result?.status === 'error' || state.status === 'error';
  return <aside className="friends-dock" ref={root} aria-label={t('Friends', 'Φίλοι')}>
    <header className="friends-dock-heading"><h2>{t('Friends', 'Φίλοι')}</h2><div>
      <button type="button" disabled={!signedIn || !state.canSearch} onClick={() => root.current?.querySelector<HTMLInputElement>('input')?.focus()} aria-label={t('Search people', 'Αναζήτηση ατόμων')} title={t('Search people', 'Αναζήτηση ατόμων')}><UserRoundPlus /></button>
      <button type="button" onClick={() => openFriends('chats')} aria-label={t('Open chats', 'Άνοιγμα συνομιλιών')} title={t('Chats', 'Συνομιλίες')}><MessageCircle /></button>
      <button type="button" disabled aria-label={t('Xbox party voice unavailable', 'Η φωνητική ομάδα Xbox δεν είναι διαθέσιμη')} title={t('Xbox party voice is not available in this version.', 'Η φωνητική ομάδα Xbox δεν είναι διαθέσιμη σε αυτήν την έκδοση.')}><Headphones /></button>
    </div></header>
    <form className="friends-dock-search" onSubmit={search}><label className="sr-only" htmlFor={`${id}-search`}>{t('Search or add friends', 'Αναζήτηση ή προσθήκη φίλων')}</label><Search aria-hidden="true" />
      <input id={`${id}-search`} value={query} maxLength={128} onChange={event => setQuery(event.target.value)} placeholder={t('Search or add friends', 'Αναζήτηση ή προσθήκη φίλων')} disabled={!signedIn || !state.canSearch} onKeyDown={event => { if (event.key === 'Escape' && searching) { event.preventDefault(); event.stopPropagation(); clear(); } }} />
      {searching ? <button type="button" onClick={clear} aria-label={t('Clear people search', 'Καθαρισμός αναζήτησης ατόμων')}><X /></button> : <button type="submit" disabled={!state.canSearch || !validFriendsDockQuery(query)} aria-label={t('Find people', 'Εύρεση ατόμων')}><Search /></button>}
    </form>
    <section className="friends-dock-body" aria-label={searching ? t('People search results', 'Αποτελέσματα αναζήτησης ατόμων') : t('Friends list', 'Λίστα φίλων')} aria-busy={state.loading || result?.status === 'loading' || undefined}>
      {!signedIn ? <div className="friends-dock-status"><p>{t('Sign in to see your friends.', 'Συνδεθείτε για να δείτε τους φίλους σας.')}</p><button onClick={openAccount}>{t('Sign in', 'Σύνδεση')}</button></div> : <>
        {state.status === 'loading' || result?.status === 'loading' ? <p className="friends-dock-status" role="status">{t('Loading…', 'Φόρτωση…')}</p> : null}
        {state.status === 'unsupported' ? <div className="friends-dock-status"><p>{t('Friends are unavailable with this Engine.', 'Οι φίλοι δεν είναι διαθέσιμοι με αυτό το Engine.')}</p><button onClick={openAccount}>{t('Account settings', 'Ρυθμίσεις λογαριασμού')}</button></div> : null}
        {error ? <div className="friends-dock-status" role="alert"><p>{t('Friends could not load. Check your account and connection.', 'Δεν φορτώθηκαν οι φίλοι. Ελέγξτε τον λογαριασμό και τη σύνδεσή σας.')}</p><button disabled={state.loading} onClick={() => { if (result) void session.current?.search(result.query); else void session.current?.read(true); }}><RefreshCw />{t('Refresh', 'Ανανέωση')}</button></div> : null}
        {!error && (result?.status === 'ready' || !result && state.status === 'ready') ? <>
          {searching ? <p className="friends-dock-results-label">{t('People', 'Άτομα')} ({friends.length})</p> : null}
          <ul className="friends-dock-roster">{displayed.slice(0, limit).map(friend => <li key={friend.xuid}><button type="button" data-social-peer={friend.xuid} disabled={!canChat} onClick={() => openPeer(friend)}><FriendAvatar key={friend.gamerpicUrl ?? friend.xuid} friend={friend} presence={presence} /><span><strong>{friend.gamertag}</strong><small>{presenceLabel(friend, presence, t)}</small></span></button></li>)}</ul>
          {!displayed.length ? <p className="friends-dock-status">{searching ? t('No players found.', 'Δεν βρέθηκαν παίκτες.') : t('No friends were returned for this account.', 'Δεν επιστράφηκαν φίλοι για αυτόν τον λογαριασμό.')}</p> : null}
          {displayed.length > limit ? <button className="friends-dock-more" onClick={() => setLimit(value => value + 100)}>{t('Show more', 'Περισσότερα')}</button> : null}
        </> : null}
      </>}
    </section>
    <footer><button type="button" onClick={() => openFriends('friends')}>{t('See all friends', 'Προβολή όλων των φίλων')}</button>{signedIn ? <button type="button" disabled={state.loading} onClick={() => void session.current?.read(true)} aria-label={t('Refresh friends', 'Ανανέωση φίλων')}><RefreshCw /></button> : null}</footer>
  </aside>;
}
