import { useEffect, useRef, useState } from 'react';
import { HelpCircle, Shield } from './XboxIcons';
import { Bell, CheckCheck, ChevronRight, CircleAlert, CircleUserRound, Download, ExternalLink, Gift, Info, MoreHorizontal, Search, Settings, Users, X } from './XboxIcons';
import { GamePassBadge } from './XboxIcons';
import type { SettingsSection } from './SettingsFrame';
import { useReferenceLocale } from './ReferenceLocale';
import { useBackHandler } from './GamepadNavigation';
import { ReferenceMenu } from './ReferenceMenu';
import type { AccountLibraryPage, AppSnapshot, CatalogProduct, Page } from '../shared/types';
import { XboxSocialPanel } from './XboxSocialPanel';

export type ShellPanel = 'account' | 'friends' | 'notifications' | 'remote-play';
export function GamePassIcon({ wordmark = false }: { wordmark?: boolean }) {
  const [missing, setMissing] = useState(false);
  return wordmark ? <span className="game-pass-wordmark" aria-hidden="true">{missing ? 'XBOX GAME PASS' : <img src="./original-xbox/icons/GamePassInline5.svg" alt="" onError={() => setMissing(true)} />}</span> : <GamePassBadge className="game-pass-icon" />;
}

export function ShellFlyout({ panel, data, close, go, settings }: { panel: ShellPanel; data: AppSnapshot; close: () => void; go: (page: Page) => void; settings?: (section: SettingsSection) => void }) {
  const { text } = useReferenceLocale();
  const root = useRef<HTMLDivElement>(null);
  const notificationAnchor = useRef<HTMLButtonElement>(null);
  const [auxiliary, setAuxiliary] = useState<'support' | 'feedback'>();
  const [accountError, setAccountError] = useState('');
  const [accountBusy, setAccountBusy] = useState(false);
  const [remoteBusy, setRemoteBusy] = useState(false);
  const [remoteError, setRemoteError] = useState('');
  const remotePending=useRef(false);
  const openRemotePlay = async () => {
    if(remotePending.current)return;remotePending.current=true;setRemoteBusy(true); setRemoteError('');
    try { await window.launcher.openRemotePlay(); close(); }
    catch { setRemoteError(text('Remote Play could not open. Try again.','Το Remote Play δεν άνοιξε. Δοκιμάστε ξανά.')); }
    finally {remotePending.current=false; setRemoteBusy(false); }
  };
  const [unread, setUnread] = useState(false);
  const [readIds, setReadIds] = useState<string[]>(() => {
    try { const value: unknown = JSON.parse(localStorage.getItem('xboks.read-notifications.v1') ?? '[]'); return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []; } catch { return []; }
  });
  const [menu, setMenu] = useState(false);
  const title = auxiliary === 'support' ? text('Support', 'Υποστήριξη') : auxiliary === 'feedback' ? text('Feedback', 'Σχόλια') : panel === 'account' ? text('Account menu', 'Μενού λογαριασμού') : panel === 'friends' ? text('Friends', 'Φίλοι') : panel === 'remote-play' ? 'Remote Play' : text('Notifications', 'Ειδοποιήσεις');
  const closeSurface = () => { if (accountBusy || remoteBusy) return true; if (auxiliary) setAuxiliary(undefined); else close(); return true; };
  useBackHandler(closeSurface, true, () => root.current);
  useEffect(() => { const closed = () => { if (panel === 'friends') close(); }; window.addEventListener('xboks-close-social', closed); return () => window.removeEventListener('xboks-close-social', closed); }, [panel, close]);
  async function signOut() {
    setAccountBusy(true); setAccountError('');
    try { await window.launcher.logout(); close(); }
    catch (error) { setAccountError(error instanceof Error ? error.message : text('Sign out failed.', 'Η αποσύνδεση απέτυχε.')); }
    finally { setAccountBusy(false); }
  }
  const name = data.auth.gamertag ?? data.auth.username ?? 'Sign in';
  const navigate = (page: Page) => { close(); go(page); };
  const openSettings = (section: SettingsSection) => { close(); if (settings) settings(section); else go('settings'); };
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const shell = document.querySelector<HTMLElement>('.app-shell');
    const wasInert = shell?.inert ?? false;
    if (shell) shell.inert = true;
    root.current?.querySelector<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled)')?.focus();
    return () => { if (shell) shell.inert = wasInert; previous?.isConnected && previous.focus(); };
  }, []);
  useEffect(() => { root.current?.querySelector<HTMLElement>('button:not(:disabled),a[href]')?.focus(); }, [auxiliary]);
  const notifications = data.downloads.filter(task => ['failed', 'complete'].includes(task.status));
  const visibleNotifications = notifications.filter(task => !unread || !readIds.includes(`${task.id}:${task.status}`));
  const markAllRead = () => {
    const ids = [...new Set([...readIds, ...notifications.map(task => `${task.id}:${task.status}`)])].slice(-500);
    setReadIds(ids); try { localStorage.setItem('xboks.read-notifications.v1', JSON.stringify(ids)); } catch { /* Keep read state for this session. */ }
    setMenu(false);
  };
  return <div className={`shell-flyout-backdrop ${panel === 'account' && !auxiliary ? 'account-flyout-backdrop' : panel === 'remote-play' ? 'remote-play-backdrop' : ''}`} onMouseDown={event => { if (event.target === event.currentTarget) closeSurface(); }}>
    <div className={`shell-flyout ${auxiliary ? 'shell-auxiliary-dialog' : panel === 'account' ? 'shell-account-menu' : panel === 'remote-play' ? 'remote-play-dialog' : ''}`} ref={root} role="dialog" aria-modal="true" aria-label={title} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeSurface(); }
      if (event.key === 'Tab') {
        const nodes = Array.from(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled)') ?? []).filter(el => el.getClientRects().length);
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
      {auxiliary ? <><header><h2>{title}</h2><button aria-label={text('Close', 'Κλείσιμο')} data-gamepad-cancel onClick={() => setAuxiliary(undefined)}><X /></button></header>
        {auxiliary === 'support' ? <div className="shell-support-content"><h3>{text('How can we help?', 'Πώς μπορούμε να βοηθήσουμε;')}</h3><a href="https://support.xbox.com/" target="_blank" rel="noreferrer">{text('Xbox support', 'Υποστήριξη Xbox')}<ExternalLink /></a><a href="https://github.com/slaveitgr/xboks/issues" target="_blank" rel="noreferrer">{text('XBOKS support and known issues', 'Υποστήριξη XBOKS και γνωστά προβλήματα')}<ExternalLink /></a></div> : <div className="shell-support-content"><p>{text('Share feedback about XBOKS. Review your report before submitting it on GitHub.', 'Στείλτε σχόλια για το XBOKS. Ελέγξτε την αναφορά σας πριν την υποβολή στο GitHub.')}</p><a href="https://github.com/slaveitgr/xboks/issues/new" target="_blank" rel="noreferrer">{text('Open feedback form', 'Άνοιγμα φόρμας σχολίων')}<ExternalLink /></a></div>}
      </> : panel === 'account' ? <>
        {data.auth.stored === true ? <><button onClick={() => navigate('profile')}><CircleUserRound />{text('View profile', 'Προβολή προφίλ')}<ChevronRight /></button>
        <button onClick={() => openSettings('subscriptions')}><GamePassIcon />{text('My subscriptions', 'Οι συνδρομές μου')}</button>
        <a href="https://www.xbox.com/promotions" target="_blank" rel="noreferrer"><Gift />{text('Offers and discounts', 'Προσφορές και πωλήσεις')}<ExternalLink /></a></> : null}
        <a href="https://insider.xbox.com/" target="_blank" rel="noreferrer"><Shield />Xbox Insider Program<ExternalLink /></a>
        <button onClick={() => openSettings('account')}><Settings />{text('Settings', 'Ρυθμίσεις')}</button>
        <button onClick={() => setAuxiliary('support')}><HelpCircle />{text('Support', 'Υποστήριξη')}</button>
        <button onClick={() => setAuxiliary('feedback')}><Info />{text('Feedback', 'Σχόλια')}</button>
        <hr />{data.auth.stored === true ? <><button disabled title={text('Xbox presence controls are unavailable', 'Οι ρυθμίσεις παρουσίας Xbox δεν είναι διαθέσιμες')}>{text('Appear offline', 'Εμφάνιση εκτός σύνδεσης')}</button><button disabled={accountBusy || !data.backend.capabilities.logout || data.auth.running} onClick={() => void signOut()}>{text('Sign out', 'Αποσύνδεση')}</button></> : null}
        {!data.desktopSettings?.fullscreenExperience ? <button disabled={accountBusy} onClick={() => void window.launcher.quitLauncher().catch(error => setAccountError(error instanceof Error ? error.message : 'Could not quit XBOKS.'))}>{text('Quit', 'Έξοδος')}</button> : null}
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
        </> : panel === 'friends' ? <XboxSocialPanel auth={data.auth} accountSettings={() => openSettings('account')} /> : <div className="remote-play-content"><p>{text('Turn on your console and enable remote features in its settings.', 'Ενεργοποιήστε την κονσόλα σας και τις απομακρυσμένες λειτουργίες στις ρυθμίσεις της.')}</p><button className="remote-play-profile" disabled={remoteBusy} aria-label={text('Open Xbox Remote Play', 'Άνοιγμα του Xbox Remote Play')} onClick={() => void openRemotePlay()}>{data.auth.stored&&data.auth.avatarDataUrl ? <img src={data.auth.avatarDataUrl} alt="Xbox profile" /> : <CircleUserRound />}<span>{data.auth.stored?name:'Xbox Remote Play'}</span></button><p className="remote-play-signin-note">{text('Continue inside XBOKS. Xbox may ask you to sign in again before showing your consoles.','Συνεχίστε μέσα στο XBOKS. Το Xbox μπορεί να ζητήσει ξανά σύνδεση πριν εμφανίσει τις κονσόλες σας.')}</p>{remoteBusy ? <p role="status">{text('Loading Remote Play…', 'Φόρτωση Remote Play…')}</p> : null}{remoteError ? <p className="remote-play-error" role="alert">{remoteError}</p> : null}</div>}

      </>}
    </div>
  </div>;
}

/** Account-backed Game Pass list: membership labels never come from Store promotions. */
export function GamePassPage({ data, go, select, playLater }: { data: AppSnapshot; go: (page: Page) => void; select: (product: CatalogProduct) => void; playLater?: () => void }) {
  const { text } = useReferenceLocale();
  const [genre, setGenre] = useState('');
  const [genreAnchor, setGenreAnchor] = useState<HTMLElement>();
  const [result, setResult] = useState<AccountLibraryPage>();
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    window.launcher.getAccountLibrary('gamepass').then(value => { if (!cancelled) setResult(value); }).catch(() => { if (!cancelled) setError('The Game Pass catalog could not be loaded.'); });
    return () => { cancelled = true; };
  }, [data.auth.stored]);
  const allProducts = result?.products ?? [];
  const genres = [...new Set(allProducts.flatMap(product => product.categories))].sort();
  const products = genre ? allProducts.filter(product => product.categories.includes(genre)) : allProducts;
  return <main className="page game-pass-page">
    <button className="game-pass-banner" onClick={() => document.getElementById('game-pass-games')?.scrollIntoView({ behavior: 'smooth' })}><strong>{text('Discover Xbox Game Pass', 'Ανακαλύψτε το XBOX Game Pass')}</strong><span>{products.length ? `${products.length}${result?.cursor ? '+' : ''} games` : 'Explore Game Pass'}<ChevronRight /></span></button>
    <div className="game-pass-hero-row">{products.slice(0, 3).map(product => <button className="home-feature-tile" key={product.productId} onClick={() => select(product)}>{product.heroUrl || product.posterUrl ? <img src={product.heroUrl ?? product.posterUrl} alt="" /> : null}<span className="feature-copy"><strong>{product.title}</strong><span>{product.publisher}</span></span></button>)}</div>
    <div className="game-pass-actions"><button onClick={() => { setGenre(''); document.getElementById('game-pass-games')?.scrollIntoView({ behavior: 'smooth' }); }}><GamePassIcon />{text('All games', 'Όλα τα παιχνίδια')}</button><button disabled={!genres.length} aria-haspopup="menu" aria-expanded={Boolean(genreAnchor)} onClick={event => setGenreAnchor(event.currentTarget)}><Gift />{genre || text('Pin a genre', 'Καρφίτσωμα είδους')}</button><button onClick={() => playLater ? playLater() : go('library')}>{text('Play later', 'Αναπαραγωγή αργότερα')}<ChevronRight /></button><button disabled title={text('Game Pass benefits are not returned by the connected service', 'Η συνδεδεμένη υπηρεσία δεν επιστρέφει τα πλεονεκτήματα του Game Pass')}><Gift />{text('My benefits', 'Τα πλεονεκτήματά μου')}</button><a href="https://www.xbox.com/xbox-game-pass" target="_blank" rel="noreferrer">{text('Get Game Pass', 'Αποκτήστε το Game Pass')}<ExternalLink /></a></div>
    {genreAnchor ? <ReferenceMenu id="game-pass-genres" label={text('Pin a genre', 'Καρφίτσωμα είδους')} anchor={{ element: genreAnchor }} onDismiss={() => setGenreAnchor(undefined)} items={genres.map(category => ({ id: category, label: category, onSelect: () => setGenre(category) }))} /> : null}
    <section id="game-pass-games"><h1>Game Pass games</h1><p>Explore games available through your Xbox account.</p><div className="home-catalog-row">{products.map(product => <button className="home-product" key={product.productId} data-product-id={product.productId} onClick={() => select(product)}>{product.posterUrl ? <img src={product.posterUrl} alt="" /> : <GamePassIcon />}<span><strong>{product.title}</strong><small>{product.publisher}</small></span></button>)}</div>
      {!products.length ? <div className="home-catalog-state" role="status">{error || (result ? data.auth.stored ? 'No Game Pass games were returned for this account.' : 'Sign in to see your Game Pass games.' : 'Loading Game Pass games…')}<button onClick={() => go('settings')}>Account settings</button></div> : null}
    </section>
  </main>;
}
