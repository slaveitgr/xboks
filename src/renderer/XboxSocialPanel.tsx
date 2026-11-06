import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { Headphones, Send } from 'lucide-react';
import { ArrowLeft, ChevronRight, CircleUserRound, RefreshCw, Search, Settings, Users } from './XboxIcons';
import type { AppSnapshot } from '../shared/types';
import { noXboxSocialCapabilities, type XboxChatMessage, type XboxFriend, type XboxSocialResult } from '../shared/xbox-social';
import { useReferenceLocale } from './ReferenceLocale';
import { useBackHandler } from './GamepadNavigation';
import { XboxMessageSubmission } from './xbox-message-submission';
import './xbox-social-panel.css';

type Text = (en: string, el: string) => string;
type SocialTab = 'friends' | 'chats';
export interface XboxSocialRoute { tab?: SocialTab; peer?: { xuid: string; gamertag: string } }
type Resource = 'friends' | 'chats' | 'conversation' | 'search';
const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;
const presenceOrder = ['online', 'away', 'offline', 'unknown'] as const;
export const xboxPartyVoiceReason = 'Xbox party voice is not available in this version.';
export const xboxMessageLength = (text: string) => [...text].length;
export const validXboxMessage = (text: string) => Boolean(text.trim()) && xboxMessageLength(text) <= 256 && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text);
export function xboxSocialAccountKey(auth: AppSnapshot['auth']): string { return JSON.stringify([auth.stored, auth.running, auth.username ?? null]); }
export function xboxFriendGroups(friends: XboxFriend[], presenceAvailable: boolean): Record<XboxFriend['presence'], XboxFriend[]> {
  const groups: Record<XboxFriend['presence'], XboxFriend[]> = { online: [], away: [], offline: [], unknown: [] };
  for (const friend of friends) groups[presenceAvailable && presenceOrder.includes(friend.presence) ? friend.presence : 'unknown'].push(friend);
  return groups;
}
export function xboxMessageText(message: XboxChatMessage, t: Text): string {
  return message.deleted ? t('Deleted message', 'Διαγραμμένο μήνυμα') : message.text === undefined ? t('Message text is unavailable or filtered.', 'Το κείμενο μηνύματος δεν είναι διαθέσιμο ή έχει φιλτραριστεί.') : message.text;
}
export function xboxConversationMatches(result: XboxSocialResult, peerXuid: string): boolean {
  return result.status === 'ready' && result.peerXuid === peerXuid && Boolean(result.selfXuid) && (result.messages ?? []).every(message => message.senderXuid === result.selfXuid || message.senderXuid === peerXuid);
}
function socialError(_value: unknown, t: Text): XboxSocialResult {
  return { status: 'error', checkedAt: new Date().toISOString(), capabilities: { ...noXboxSocialCapabilities }, reason: t('Xbox social could not load. Try refreshing.', 'Δεν ήταν δυνατή η φόρτωση των κοινωνικών υπηρεσιών Xbox. Δοκιμάστε ανανέωση.') };
}
function statusText(result: XboxSocialResult | undefined, t: Text) {
  if (!result) return t('Loading Xbox social…', 'Φόρτωση κοινωνικών υπηρεσιών Xbox…');
  return result.reason || (result.status === 'signed-out' ? t('Sign in to load friends and chats.', 'Συνδεθείτε για φόρτωση φίλων και συνομιλιών.') : result.status === 'unsupported' ? t('This backend does not support Xbox social.', 'Αυτό το backend δεν υποστηρίζει τις κοινωνικές υπηρεσίες Xbox.') : t('Xbox social could not load.', 'Δεν ήταν δυνατή η φόρτωση των κοινωνικών υπηρεσιών Xbox.'));
}
function Avatar({ friend }: { friend: XboxFriend }) {
  const [failed, setFailed] = useState(false);
  return <span className={`xbox-social-avatar presence-${friend.presence}`}>{friend.gamerpicUrl && !failed ? <img src={friend.gamerpicUrl} alt="" onError={() => setFailed(true)} /> : <CircleUserRound />}</span>;
}

export function XboxFriendsList({ result, select, t }: { result: XboxSocialResult; select: (friend: XboxFriend, origin: HTMLElement) => void; t: Text }) {
  const groups = xboxFriendGroups(result.friends ?? [], result.capabilities.presence);
  const captions = { online: t('Online', 'Σε σύνδεση'), away: t('Away', 'Απουσιάζει'), offline: t('Offline', 'Χωρίς σύνδεση'), unknown: t('Presence unavailable', 'Η παρουσία δεν είναι διαθέσιμη') };
  return <div className="xbox-social-friends">{presenceOrder.filter(value => groups[value].length).map(value => <section key={value} aria-label={captions[value]}><h3>{captions[value]} ({groups[value].length})</h3>{groups[value].map(friend => <button data-social-peer={friend.xuid} className="xbox-social-person" key={friend.xuid} disabled={!result.capabilities.conversation} onClick={event => select(friend, event.currentTarget)}>
    <Avatar friend={result.capabilities.presence ? friend : { ...friend, presence: 'unknown' }} /><span><strong>{friend.gamertag}</strong><small>{result.capabilities.presence ? friend.activity || captions[friend.presence] : captions.unknown}</small></span><ChevronRight />
  </button>)}</section>)}</div>;
}

/** The keyed session immediately discards private UI on sign-out/account switch;
 * IPC caching stays in the account-bound main process, never localStorage. */
export function XboxSocialPanel({ auth, variant = 'shell', accountSettings, initialRoute }: { auth: AppSnapshot['auth']; variant?: 'shell' | 'guide'; accountSettings: () => void; initialRoute?: XboxSocialRoute }) {
  return <XboxSocialSession key={xboxSocialAccountKey(auth)} auth={auth} variant={variant} accountSettings={accountSettings} initialRoute={initialRoute} />;
}
function XboxSocialSession({ auth, variant, accountSettings, initialRoute }: { auth: AppSnapshot['auth']; variant: 'shell' | 'guide'; accountSettings: () => void; initialRoute?: XboxSocialRoute }) {
  const { text: t, language } = useReferenceLocale();
  const id = useId();
  const [tab, setTab] = useState<SocialTab>(initialRoute?.tab === 'chats' ? 'chats' : 'friends');
  const [results, setResults] = useState<Partial<Record<Resource, XboxSocialResult>>>({});
  const [loading, setLoading] = useState<Partial<Record<Resource, boolean>>>({});
  const [query, setQuery] = useState(''), [searchOpen, setSearchOpen] = useState(false);
  const [peer, setPeer] = useState<{ xuid: string; name: string; origin: string } | undefined>(() => {
    const value = initialRoute?.peer;
    if (auth.stored !== true || auth.running || !value || !/^[1-9]\d{0,19}$/.test(value.xuid) || BigInt(value.xuid) > 18446744073709551615n) return;
    return { xuid: value.xuid, name: value.gamertag, origin: `[data-social-peer="${value.xuid}"]` };
  });
  const [draft, setDraft] = useState(''), [sending, setSending] = useState(false), [sendError, setSendError] = useState(''), [sentNotice, setSentNotice] = useState('');
  const submission = useRef(new XboxMessageSubmission());
  const [submissionBlocked, setSubmissionBlocked] = useState(false);
  const root = useRef<HTMLDivElement>(null), subpage = useRef<HTMLDivElement>(null);
  const mounted = useRef(true), sendPending = useRef(false), sequence = useRef({ friends: 0, chats: 0, conversation: 0, search: 0 });
  const currentPeer = useRef(peer); currentPeer.current = peer;
  const latest = useRef<() => void>(() => {});
  const signedIn = auth.stored === true && !auth.running;
  const launcher = typeof window === 'undefined' ? undefined : window.launcher;
  const friendResult = results.friends, activeResult = tab === 'friends' ? friendResult : results.chats;
  const peerFriends = [...friendResult?.friends ?? [], ...results.search?.friends ?? []];
  const names = new Map(peerFriends.map(friend => [friend.xuid, friend.gamertag]));
  const conversation = peer && results.conversation && xboxConversationMatches(results.conversation, peer.xuid) ? results.conversation : undefined;
  const canSend = signedIn && Boolean(peer && conversation?.capabilities.send && typeof launcher?.sendXboxMessage === 'function');
  const labels = { friends: t('Friends', 'Φίλοι'), chats: t('Chats', 'Συνομιλίες') };

  const uncertainMessage = () => t('The submission could not be confirmed. Your draft is kept. Refresh and review the conversation before sending again.', 'Η υποβολή δεν επιβεβαιώθηκε. Το πρόχειρο διατηρήθηκε. Ανανεώστε και ελέγξτε τη συνομιλία πριν το στείλετε ξανά.');
  async function read(resource: Resource, refresh = false, value?: string, manualReview = false) {
    if (!signedIn) return;
    const version = ++sequence.current[resource];
    setLoading(previous => ({ ...previous, [resource]: true }));
    try {
      const method = resource === 'friends' ? launcher?.getXboxFriends : resource === 'chats' ? launcher?.getXboxChats : resource === 'conversation' ? launcher?.getXboxConversation : launcher?.searchXboxPeople;
      let result: XboxSocialResult;
      if (typeof method !== 'function') result = { status: 'unsupported', checkedAt: new Date().toISOString(), capabilities: { ...noXboxSocialCapabilities }, reason: t('Xbox social is unavailable in this app session.', 'Οι κοινωνικές υπηρεσίες Xbox δεν είναι διαθέσιμες σε αυτήν τη συνεδρία εφαρμογής.') };
      else if (resource === 'friends') result = await launcher!.getXboxFriends(refresh);
      else if (resource === 'chats') result = await launcher!.getXboxChats(refresh);
      else if (resource === 'conversation') result = await launcher!.getXboxConversation(value!, refresh);
      else result = await launcher!.searchXboxPeople(value!);
      if (!mounted.current || sequence.current[resource] !== version) return;
      if (resource === 'conversation' && result.status === 'ready' && !xboxConversationMatches(result, value!)) result = socialError(new Error(t('The conversation target could not be verified.', 'Δεν ήταν δυνατή η επαλήθευση του παραλήπτη συνομιλίας.')), t);
      setResults(previous => ({ ...previous, [resource]: result }));
      if (resource === 'conversation' && currentPeer.current?.xuid === value) {
        const reconciliation = submission.current.history(result, manualReview);
        if (reconciliation.kind === 'confirmed') {
          setDraft(current => current === reconciliation.text ? '' : current);
          setSubmissionBlocked(false); setSendError('');
          setSentNotice(t('Your submitted message now appears in the conversation history.', 'Το μήνυμα που υποβάλατε εμφανίζεται πλέον στο ιστορικό συνομιλίας.'));
        } else if (reconciliation.kind === 'reviewed') {
          setSubmissionBlocked(false); setSentNotice('');
          setSendError(t('Conversation refreshed. Your draft is kept. Check whether it was already sent before choosing Send again.', 'Η συνομιλία ανανεώθηκε. Το πρόχειρο διατηρήθηκε. Ελέγξτε αν έχει ήδη σταλεί πριν επιλέξετε ξανά Αποστολή.'));
        }
      }
    } catch (value) { if (mounted.current && sequence.current[resource] === version) setResults(previous => ({ ...previous, [resource]: socialError(value, t) })); }
    finally { if (mounted.current && sequence.current[resource] === version) setLoading(previous => ({ ...previous, [resource]: false })); }
  }
  useEffect(() => { mounted.current = true; if (signedIn) void read('friends'); return () => { mounted.current = false; submission.current.reset(); for (const key of Object.keys(sequence.current) as Resource[]) sequence.current[key]++; }; }, []);
  useEffect(() => { if (tab === 'chats' && !results.chats) void read('chats'); }, [tab]);
  useEffect(() => {
    if (!peer) return;
    submission.current.reset(); setSubmissionBlocked(false);
    setResults(previous => ({ ...previous, conversation: undefined })); setDraft(''); setSendError(''); setSentNotice(''); void read('conversation', false, peer.xuid);
    return () => { sequence.current.conversation++; };
  }, [peer?.xuid]);
  latest.current = () => {
    if (!signedIn || sendPending.current || document.visibilityState !== 'visible' || !root.current?.getClientRects().length) return;
    if (peer && !loading.conversation) void read('conversation', false, peer.xuid);
    else if (!peer && !searchOpen && !loading[tab]) void read(tab);
  };
  useEffect(() => {
    const poll = () => latest.current();
    const timer = window.setInterval(poll, 25000); window.addEventListener('focus', poll); document.addEventListener('visibilitychange', poll);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', poll); document.removeEventListener('visibilitychange', poll); };
  }, []);
  const back = () => {
    if (sendPending.current) return;
    if (peer) { const origin = peer.origin; submission.current.reset(); setSubmissionBlocked(false); setPeer(undefined); setDraft(''); setSendError(''); setSentNotice(''); requestAnimationFrame(() => (root.current?.querySelector<HTMLElement>(origin) ?? root.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]'))?.focus()); }
    else if (searchOpen) { setSearchOpen(false); sequence.current.search++; requestAnimationFrame(() => root.current?.querySelector<HTMLElement>('.xbox-social-search input')?.focus()); }
  };
  useBackHandler(() => { back(); return true; }, Boolean(peer || searchOpen), () => subpage.current);
  useBrowserLayoutEffect(() => { if (peer || searchOpen) subpage.current?.querySelector<HTMLElement>('[data-gamepad-cancel]')?.focus(); }, [peer?.xuid, searchOpen]);
  function openPeer(friend: { xuid: string; gamertag: string }, origin: HTMLElement) {
    setPeer({ xuid: friend.xuid, name: friend.gamertag, origin: `[data-social-peer="${CSS.escape(friend.xuid)}"]` });
    origin.focus();
  }
  function search(event: FormEvent) {
    event.preventDefault(); const value = query.trim();
    if (!signedIn || !friendResult?.capabilities.search || !value || [...value].length > 64 || loading.search) return;
    setSearchOpen(true); setResults(previous => ({ ...previous, search: undefined })); void read('search', false, value);
  }
  async function send(event: FormEvent) {
    event.preventDefault();
    if (sendPending.current || submission.current.blocked || !peer || !canSend || !validXboxMessage(draft) || !conversation?.selfXuid) return;
    const target = peer.xuid, text = draft;
    if (!submission.current.begin(conversation.selfXuid, target, text)) return;
    // A history request started before the POST must not reconcile it later.
    sequence.current.conversation++;
    setLoading(previous => ({ ...previous, conversation: false }));
    setSubmissionBlocked(true);
    sendPending.current = true; setSending(true); setSendError(''); setSentNotice('');
    try {
      const result = await launcher!.sendXboxMessage(target, text);
      if (!mounted.current || currentPeer.current?.xuid !== target) return;
      if (!submission.current.receive(result)) { setSendError(uncertainMessage()); return; }
      setSentNotice(t('Checking the submitted message in conversation history…', 'Έλεγχος του μηνύματος στο ιστορικό συνομιλίας…'));
      await read('conversation', true, target);
      if (mounted.current && currentPeer.current?.xuid === target && submission.current.blocked) { setSentNotice(''); setSendError(uncertainMessage()); }
    } catch { if (mounted.current && currentPeer.current?.xuid === target) { submission.current.failed(); setSentNotice(''); setSendError(uncertainMessage()); } }
    finally { sendPending.current = false; if (mounted.current) setSending(false); }
  }
  const retry = (resource: Resource, value?: string) => <button className="xbox-social-retry" disabled={loading[resource] || sending} onClick={() => void read(resource, true, value, resource === 'conversation')}><RefreshCw />{t('Refresh', 'Ανανέωση')}</button>;
  const failed = (result: XboxSocialResult | undefined, resource: Resource, value?: string) => <div className="xbox-social-status" role={result?.status === 'error' ? 'alert' : 'status'}><p>{statusText(result, t)}</p>{retry(resource, value)}</div>;
  const view = peer ? 'conversation' : searchOpen ? 'search' : undefined;
  return <div ref={root} className={`xbox-social-panel xbox-social-${variant}`}>
    <div hidden={Boolean(view)}>
      {variant === 'guide' ? <div className="xbox-social-profile"><CircleUserRound /><span><strong>{signedIn ? auth.gamertag ?? auth.username ?? t('Profile unavailable', 'Μη διαθέσιμο προφίλ') : t('Not signed in', 'Δεν έχετε συνδεθεί')}</strong><small>{t('Xbox account', 'Λογαριασμός Xbox')}</small></span></div> : null}
      <form className="xbox-social-search" onSubmit={search}><Search /><input aria-label={t('Search people', 'Αναζήτηση ατόμων')} placeholder={t('Search people', 'Αναζήτηση ατόμων')} value={query} onChange={event => setQuery(event.target.value)} disabled={!signedIn || !friendResult?.capabilities.search} /><button type="submit" disabled={!signedIn || !friendResult?.capabilities.search || !query.trim() || [...query.trim()].length > 64 || Boolean(loading.search)} aria-label={t('Find people', 'Εύρεση ατόμων')}><ChevronRight /></button><button type="button" disabled title={t(xboxPartyVoiceReason, 'Η φωνητική ομάδα Xbox δεν είναι διαθέσιμη σε αυτήν την έκδοση.')} aria-label={t('Xbox party voice unavailable', 'Η φωνητική ομάδα Xbox δεν είναι διαθέσιμη')}><Headphones /></button><button type="button" onClick={accountSettings} aria-label={t('Account settings', 'Ρυθμίσεις λογαριασμού')}><Settings /></button></form>
      <p className="xbox-social-party-reason">{t(xboxPartyVoiceReason, 'Η φωνητική ομάδα Xbox δεν είναι διαθέσιμη σε αυτήν την έκδοση.')}</p>
      <div className="xbox-social-tabs" role="tablist" aria-label={t('Social sections', 'Καρτέλες κοινωνικής δικτύωσης')}>{(['friends', 'chats'] as const).map(value => <button key={value} role="tab" id={`${id}-${value}`} aria-controls={`${id}-body`} aria-selected={tab === value} tabIndex={tab === value ? 0 : -1} onClick={() => setTab(value)} onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setTab(value === 'friends' ? 'chats' : 'friends'); requestAnimationFrame(() => document.getElementById(`${id}-${value === 'friends' ? 'chats' : 'friends'}`)?.focus()); } }}>{labels[value]}</button>)}</div>
      <div className="xbox-social-body" id={`${id}-body`} role="tabpanel" aria-labelledby={`${id}-${tab}`} aria-busy={loading[tab] || undefined}>
        {!signedIn ? <div className="xbox-social-status"><p>{t('Sign in to your Xbox account to load friends and chats.', 'Συνδεθείτε στον λογαριασμό Xbox για φόρτωση φίλων και συνομιλιών.')}</p><button onClick={accountSettings}>{t('Account settings', 'Ρυθμίσεις λογαριασμού')}</button></div> : !activeResult || activeResult.status !== 'ready' ? failed(activeResult, tab) : <>
          <div className="xbox-social-refresh-row">{retry(tab)}</div>
          {tab === 'friends' ? activeResult.capabilities.friends ? <><XboxFriendsList result={activeResult} select={openPeer} t={t} />{!activeResult.friends?.length ? <p className="xbox-social-empty">{t('No friends were returned for this account.', 'Δεν επιστράφηκαν φίλοι για αυτόν τον λογαριασμό.')}</p> : null}</> : <p className="xbox-social-empty">{t('Friends are unavailable for this account.', 'Οι φίλοι δεν είναι διαθέσιμοι για αυτόν τον λογαριασμό.')}</p> : activeResult.capabilities.inbox ? <><div className="xbox-social-chats">{activeResult.conversations?.map(item => <button className="xbox-social-person" key={item.id} data-social-peer={item.peerXuid} disabled={!activeResult.capabilities.conversation} onClick={event => openPeer({ xuid: item.peerXuid, gamertag: names.get(item.peerXuid) ?? t('Xbox player', 'Παίκτης Xbox') }, event.currentTarget)}><CircleUserRound /><span><strong>{names.get(item.peerXuid) ?? item.peerXuid}{item.unread ? <b className="xbox-social-unread" aria-label={t('Unread', 'Μη αναγνωσμένο')} /> : null}</strong><small>{item.lastMessage ? xboxMessageText(item.lastMessage, t) : t('No message preview', 'Χωρίς προεπισκόπηση μηνύματος')}</small></span><ChevronRight /></button>)}</div>{!activeResult.conversations?.length ? <p className="xbox-social-empty">{t('No one-to-one conversations were returned.', 'Δεν επιστράφηκαν προσωπικές συνομιλίες.')}</p> : null}{(activeResult.omittedConversations ?? 0) > 0 ? <p className="xbox-social-empty">{t('Group and system conversations are not displayed.', 'Οι ομαδικές συνομιλίες και οι συνομιλίες συστήματος δεν εμφανίζονται.')}</p> : null}</> : <p className="xbox-social-empty">{t('Xbox chats are unavailable for this account.', 'Οι συνομιλίες Xbox δεν είναι διαθέσιμες για αυτόν τον λογαριασμό.')}</p>}
        </>}
      </div>
    </div>
    {view ? <div ref={subpage} className="xbox-social-subpage" role="dialog" aria-modal="true" aria-label={peer ? `${t('Conversation with', 'Συνομιλία με')} ${peer.name}` : t('People search', 'Αναζήτηση ατόμων')} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); back(); }
      if (event.key === 'Tab') { event.preventDefault(); event.stopPropagation(); const nodes = [...subpage.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled)') ?? []].filter(node => node.getClientRects().length); const index = nodes.indexOf(document.activeElement as HTMLElement); nodes[(index + (event.shiftKey ? -1 : 1) + nodes.length) % nodes.length]?.focus(); }
    }}>
      <div className="xbox-social-subpage-heading"><button data-gamepad-cancel disabled={sending} onClick={back}><ArrowLeft />{t('Back', 'Πίσω')}</button><h3>{peer?.name ?? t('Search results', 'Αποτελέσματα αναζήτησης')}</h3>{retry(peer ? 'conversation' : 'search', peer?.xuid ?? query.trim())}</div>
      {peer ? <>
        {!conversation ? failed(results.conversation, 'conversation', peer.xuid) : <><ol className="xbox-social-messages" aria-label={t('Conversation messages', 'Μηνύματα συνομιλίας')}>{conversation.messages?.map(message => <li key={message.id} className={message.senderXuid === conversation.selfXuid ? 'self-message' : ''}><small>{message.senderXuid === conversation.selfXuid ? t('You', 'Εσείς') : peer.name}{message.sentAt ? <time dateTime={message.sentAt}>{new Date(message.sentAt).toLocaleString(language === 'el' ? 'el-GR' : undefined)}</time> : null}</small><p>{xboxMessageText(message, t)}</p></li>)}</ol>{!conversation.messages?.length ? <p className="xbox-social-empty">{t('No messages were returned.', 'Δεν επιστράφηκαν μηνύματα.')}</p> : null}{conversation.continuationToken ? <p className="xbox-social-empty">{t('Only the returned message page is shown.', 'Εμφανίζεται μόνο η σελίδα μηνυμάτων που επιστράφηκε.')}</p> : null}</>}
        <form className="xbox-social-composer" onSubmit={event => void send(event)}><label htmlFor={`${id}-message`}>{t('Message', 'Μήνυμα')}</label><textarea id={`${id}-message`} aria-label={t('Message text', 'Κείμενο μηνύματος')} value={draft} onChange={event => { setDraft(event.target.value); setSendError(''); setSentNotice(''); }} disabled={!canSend || sending || submissionBlocked} /><div><span aria-live="polite">{xboxMessageLength(draft)} / 256</span><button type="submit" disabled={!canSend || sending || submissionBlocked || !validXboxMessage(draft)}><Send />{sending ? t('Sending…', 'Αποστολή…') : t('Send', 'Αποστολή')}</button></div></form>
        {!canSend && !loading.conversation ? <p className="xbox-social-empty">{t('Messaging is unavailable for this account or conversation.', 'Η αποστολή μηνυμάτων δεν είναι διαθέσιμη για αυτόν τον λογαριασμό ή συνομιλία.')}</p> : null}
        {sendError ? <p className="xbox-social-error" role="alert">{sendError}</p> : null}{sentNotice ? <p className="xbox-social-notice" role="status">{sentNotice}</p> : null}
      </> : <>{!results.search || results.search.status !== 'ready' ? failed(results.search, 'search', query.trim()) : <><XboxFriendsList result={results.search} select={openPeer} t={t} />{!results.search.friends?.length ? <p className="xbox-social-empty">{t('No matching people were returned.', 'Δεν επιστράφηκαν άτομα που να ταιριάζουν.')}</p> : null}{results.search.continuationToken ? <p className="xbox-social-empty">{t('Only the returned search page is shown.', 'Εμφανίζεται μόνο η σελίδα αναζήτησης που επιστράφηκε.')}</p> : null}</>}</>}
    </div> : null}
  </div>;
}
