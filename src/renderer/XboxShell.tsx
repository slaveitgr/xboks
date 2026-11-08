import { useEffect, useRef, useState } from 'react';
import { HelpCircle, Shield } from './XboxIcons';
import { Bell, CheckCheck, ChevronDown, ChevronRight, CircleAlert, CircleUserRound, Download, ExternalLink, Gift, Info, LogOut, MonitorPlay, MoreHorizontal, Search, Settings, Users, X } from './XboxIcons';
import { GamePassBadge } from './XboxIcons';
import type { SettingsSection } from './SettingsFrame';
import { useReferenceLocale } from './ReferenceLocale';
import { useBackHandler } from './GamepadNavigation';
import { ReferenceMenu } from './ReferenceMenu';
import type { AppSnapshot, Page } from '../shared/types';
import { XboxSocialPanel, type XboxSocialRoute } from './XboxSocialPanel';
import { ConsoleLibrary } from './ConsoleLibrary';
import { SubscriptionBadge } from './SubscriptionBadge';
import { parseXboxSelfProfileDetails } from '../shared/xbox-profile';
import './account-menu-v2.css';

export type ShellPanel = 'account' | 'friends' | 'notifications' | 'remote-play' | 'support' | 'feedback';
export function GamePassIcon({ wordmark = false }: { wordmark?: boolean }) {
  const [missing, setMissing] = useState(false);
  return wordmark ? <span className="game-pass-wordmark" aria-hidden="true">{missing ? 'XBOX GAME PASS' : <img src="./original-xbox/icons/GamePassInline5.svg" alt="" onError={() => setMissing(true)} />}</span> : <GamePassBadge className="game-pass-icon" />;
}

type ShellFlyoutProps = {panel: ShellPanel; data: AppSnapshot; close: () => void; go: (page: Page) => void; settings?: (section: SettingsSection) => void; remotePlay?: () => void; socialRoute?: XboxSocialRoute};
export function ShellFlyout(props: ShellFlyoutProps) {
  if (props.panel === 'remote-play') return <ConsoleLibrary auth={props.data.auth} close={props.close} signIn={() => {props.close(); if (props.settings) props.settings('account'); else props.go('settings');}}/>;
  return <ShellFlyoutContent key={props.panel} {...props} panel={props.panel}/>;
}
function ShellFlyoutContent({panel, data, close, go, settings, remotePlay, socialRoute}: Omit<ShellFlyoutProps, 'panel'> & {panel: Exclude<ShellPanel, 'remote-play'>}) {
  const { text } = useReferenceLocale();
  const root = useRef<HTMLDivElement>(null);
  const notificationAnchor = useRef<HTMLButtonElement>(null);
  const [auxiliary, setAuxiliary] = useState<'support' | 'feedback' | undefined>(panel === 'support' || panel === 'feedback' ? panel : undefined);
  const [accountError, setAccountError] = useState('');
  const [accountBusy, setAccountBusy] = useState(false);
  const signedIn = data.auth.stored === true && !data.auth.running;
  const accountOwner = JSON.stringify([data.auth.stored === false ? 'signed-out' : 'account', data.auth.username ?? null, data.auth.gamertag ?? null]);
  const owner = useRef(accountOwner); owner.current = accountOwner;
  const accountPending = useRef(false), mounted = useRef(false), auxiliaryOrigin = useRef<'support' | 'feedback'>();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { accountPending.current = false; setAccountBusy(false); setAccountError(''); }, [accountOwner]);
  const accountDetails = signedIn ? parseXboxSelfProfileDetails(data.auth.profile) : {};
  const accountName = signedIn ? data.auth.profile?.gamertag ?? data.auth.gamertag ?? data.auth.username ?? text('Xbox account', 'Λογαριασμός Xbox') : data.auth.running ? text('Connecting…', 'Σύνδεση…') : text('Sign in', 'Σύνδεση');
  const accountAvatar = signedIn ? data.auth.profile?.avatarDataUrl ?? data.auth.avatarDataUrl : undefined;
  const [unread, setUnread] = useState(false);
  const [readIds, setReadIds] = useState<string[]>(() => {
    try { const value: unknown = JSON.parse(localStorage.getItem('xboks.read-notifications.v1') ?? '[]'); return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []; } catch { return []; }
  });
  const [menu, setMenu] = useState(false);
  const title = auxiliary === 'support' ? text('Support', 'Υποστήριξη') : auxiliary === 'feedback' ? text('Feedback', 'Σχόλια') : panel === 'account' ? text('Account menu', 'Μενού λογαριασμού') : panel === 'friends' ? text('Friends', 'Φίλοι') : text('Notifications', 'Ειδοποιήσεις');
  const closeSurface = () => { if (accountPending.current) return true; if (auxiliary && panel !== 'support' && panel !== 'feedback') setAuxiliary(undefined); else close(); return true; };
  useBackHandler(closeSurface, true, () => root.current);
  useEffect(() => { const closed = () => { if (panel === 'friends') close(); }; window.addEventListener('xboks-close-social', closed); return () => window.removeEventListener('xboks-close-social', closed); }, [panel, close]);
  async function signOut() {
    if (accountPending.current || !signedIn || !data.backend.capabilities.logout) return;
    accountPending.current = true; const requestOwner = owner.current;
    setAccountBusy(true); setAccountError('');
    try { await window.launcher.logout(); if (mounted.current && owner.current === requestOwner) close(); }
    catch { if (mounted.current && owner.current === requestOwner) setAccountError(text('Sign out failed. Try again.', 'Η αποσύνδεση απέτυχε. Δοκιμάστε ξανά.')); }
    finally { if (mounted.current && owner.current === requestOwner) { accountPending.current = false; setAccountBusy(false); } }
  }
  const navigate = (page: Page) => { if (accountPending.current) return; close(); go(page); };
  const openSettings = (section: SettingsSection) => { if (accountPending.current) return; close(); if (settings) settings(section); else go('settings'); };
  const openAuxiliary = (kind: 'support' | 'feedback') => { if (accountPending.current) return; auxiliaryOrigin.current = kind; setAuxiliary(kind); };
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const shell = document.querySelector<HTMLElement>('.app-shell');
    const wasInert = shell?.inert ?? false;
    if (shell) shell.inert = true;
    root.current?.querySelector<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled)')?.focus();
    return () => { if (shell) shell.inert = wasInert; previous?.isConnected && previous.focus(); };
  }, []);
  useEffect(() => {
    const restore = !auxiliary && auxiliaryOrigin.current ? root.current?.querySelector<HTMLElement>(`[data-shell-action="${auxiliaryOrigin.current}"]`) : undefined;
    (restore ?? root.current?.querySelector<HTMLElement>('button:not(:disabled),a[href]'))?.focus();
    if (!auxiliary) auxiliaryOrigin.current = undefined;
  }, [auxiliary]);
  const notifications = data.downloads.filter(task => ['failed', 'complete'].includes(task.status));
  const visibleNotifications = notifications.filter(task => !unread || !readIds.includes(`${task.id}:${task.status}`));
  const markAllRead = () => {
    const ids = [...new Set([...readIds, ...notifications.map(task => `${task.id}:${task.status}`)])].slice(-500);
    setReadIds(ids); try { localStorage.setItem('xboks.read-notifications.v1', JSON.stringify(ids)); } catch { /* Keep read state for this session. */ }
    setMenu(false);
  };
  return <div className={`shell-flyout-backdrop ${panel === 'account' && !auxiliary ? 'account-flyout-backdrop' : ''}`} onMouseDown={event => { if (event.target === event.currentTarget) closeSurface(); }}>
    <div className={`shell-flyout ${auxiliary ? 'shell-auxiliary-dialog' : panel === 'account' ? 'shell-account-menu' : ''}`} ref={root} role="dialog" aria-modal="true" aria-label={title} aria-busy={accountBusy || undefined} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeSurface(); }
      if (event.key === 'Tab') {
        const nodes = Array.from(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled)') ?? []).filter(el => el.getClientRects().length);
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
      {auxiliary ? <><header><h2>{title}</h2><button aria-label={text('Close', 'Κλείσιμο')} data-gamepad-cancel onClick={closeSurface}><X /></button></header>
        {auxiliary === 'support' ? <div className="shell-support-content"><h3>{text('How can we help?', 'Πώς μπορούμε να βοηθήσουμε;')}</h3><a href="https://support.xbox.com/" target="_blank" rel="noreferrer">{text('Xbox support', 'Υποστήριξη Xbox')}<ExternalLink /></a><a href="https://github.com/slaveitgr/xboks/issues" target="_blank" rel="noreferrer">{text('XBOKS support and known issues', 'Υποστήριξη XBOKS και γνωστά προβλήματα')}<ExternalLink /></a></div> : <div className="shell-support-content"><p>{text('Share feedback about XBOKS. Review your report before submitting it on GitHub.', 'Στείλτε σχόλια για το XBOKS. Ελέγξτε την αναφορά σας πριν την υποβολή στο GitHub.')}</p><a href="https://github.com/slaveitgr/xboks/issues/new" target="_blank" rel="noreferrer">{text('Open feedback form', 'Άνοιγμα φόρμας σχολίων')}<ExternalLink /></a></div>}
      </> : panel === 'account' ? <>
        <div className="account-menu-summary"><span className="account-menu-gamerpic">{accountAvatar ? <img src={accountAvatar} alt="" /> : <CircleUserRound/>}</span><span><strong>{accountName}</strong>{signedIn ? <span className="account-menu-membership">{accountDetails.gamerscore !== undefined ? <span>Ⓖ {accountDetails.gamerscore.toLocaleString()}</span> : null}<SubscriptionBadge value={data.auth.profile?.subscription ?? data.auth.subscription}/></span> : null}</span></div>
        {signedIn ? <><button className="account-menu-presence" disabled title={text('Presence controls are not supplied by the connected account service.', 'Η συνδεδεμένη υπηρεσία λογαριασμού δεν παρέχει έλεγχο παρουσίας.')}><span>{text('Presence', 'Παρουσία')}</span><ChevronDown/></button><button disabled={accountBusy} onClick={() => navigate('profile')}><CircleUserRound />{text('View profile', 'Προβολή προφίλ')}</button></> : <button disabled={data.auth.running} onClick={() => openSettings('account')}><CircleUserRound/>{text('Sign in', 'Σύνδεση')}</button>}
        <button disabled={!remotePlay || accountBusy} onClick={() => { if (accountPending.current) return; close(); remotePlay?.(); }}><MonitorPlay/>{text('Remote play', 'Απομακρυσμένο παιχνίδι')}</button>
        <button disabled={accountBusy} onClick={() => openSettings('account')}><Settings />{text('Settings', 'Ρυθμίσεις')}</button>
        <hr/><a href="https://redeem.microsoft.com/" target="_blank" rel="noreferrer" aria-disabled={accountBusy || undefined} tabIndex={accountBusy ? -1 : undefined} onClick={event => { if (accountPending.current) event.preventDefault(); }}>{text('Redeem a code', 'Εξαργύρωση κωδικού')}</a>
        <button disabled={accountBusy} data-shell-action="support" onClick={() => openAuxiliary('support')}>{text('Get help', 'Λήψη βοήθειας')}<ExternalLink/></button>
        <label className="account-menu-experience" title={text('XBOKS uses the new app experience.', 'Το XBOKS χρησιμοποιεί τη νέα εμπειρία εφαρμογής.')}><span>{text('New app experience', 'Νέα εμπειρία εφαρμογής')}</span><input type="checkbox" role="switch" checked disabled readOnly/></label>
        <hr/><button disabled={accountBusy} data-shell-action="feedback" onClick={() => openAuxiliary('feedback')}><Info />{text('Give feedback', 'Αποστολή σχολίων')}</button>
        {signedIn ? <button disabled={accountBusy || !data.backend.capabilities.logout} onClick={() => void signOut()}><LogOut/>{text('Sign out', 'Αποσύνδεση')}</button> : null}
        {accountBusy ? <p role="status">{text('Signing out…', 'Αποσύνδεση…')}</p> : null}
        {accountError ? <p role="alert">{accountError}</p> : null}
      </> : <>
        <header><h2>{title}</h2>{panel === 'notifications' ? <button ref={notificationAnchor} aria-label="Notification options" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(value => !value)}><MoreHorizontal /></button> : null}<button aria-label={`Close ${title}`} data-gamepad-cancel onClick={close}><X /></button></header>
        {panel === 'notifications' ? <>
          {menu && notificationAnchor.current ? <ReferenceMenu id="notification-options" className="shell-notification-menu" label={text('Notification options', 'Επιλογές ειδοποιήσεων')} anchor={{ element: notificationAnchor.current }} onDismiss={() => setMenu(false)} items={[
            { id: 'read', label: text('Mark all as read', 'Σήμανση όλων ως αναγνωσμένων'), icon: <CheckCheck />, onSelect: markAllRead },
            { id: 'settings', label: text('Settings', 'Ρυθμίσεις'), icon: <Settings />, onSelect: () => openSettings('notifications') },
          ]} /> : null}
          <label className="shell-unread-toggle">{text('Show unread only', 'Εμφάνιση μόνο μη αναγνωσμένων')}<input type="checkbox" role="switch" checked={unread} onChange={event => setUnread(event.target.checked)} /></label>
          <div className="shell-notification-list">{visibleNotifications.length ? visibleNotifications.map(task => <button key={task.id} onClick={() => navigate('downloads')} className={readIds.includes(`${task.id}:${task.status}`) ? 'read' : ''}>{task.status === 'failed' ? <CircleAlert /> : <Download />}<span><strong>{task.title}</strong><small>{task.status === 'failed' ? 'Installation needs attention' : 'Installation complete'}</small></span><ChevronRight /></button>) : <p className="shell-panel-empty"><Bell />No new notifications</p>}</div>
        </> : <XboxSocialPanel auth={data.auth} accountSettings={() => openSettings('account')} initialRoute={socialRoute} />}

      </>}
    </div>
  </div>;
}

export { GamePassPage } from './GamePassPage';
