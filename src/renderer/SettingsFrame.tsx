import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X, ChevronLeft, ChevronRight, CircleUserRound, ExternalLink, MonitorPlay, Gift, GamePassBadge, Shield, LogOut, HelpCircle } from './XboxIcons';
import { SettingsV2RouteProvider, settingsV2Groups, settingsV2Routes, settingsV2RouteForSection, settingsV2RouteParent, settingsV2CategoryRoutes, type SettingsV2Group, type SettingsV2Route } from './settings-v2';
import './settings-v2.css';
import { useBackHandler } from './GamepadNavigation';
import type { InterfaceLanguage } from './ReferenceLocale';
export const settingsSections = [
  ['account', 'Account'], ['application', 'Application'], ['subscriptions', 'Subscriptions'],
  ['notifications', 'Notifications'], ['install', 'Install options'], ['library', 'Library and extensions'],
  ['audio', 'Audio'], ['accessibility', 'Accessibility'], ['about', 'About'],
] as const;
export type SettingsSection = typeof settingsSections[number][0];
/** Shell mode changes replace direct background surfaces while Settings stays
 * mounted. Own each surface's prior state, including later replacements, and
 * leave the enclosing app's inert state to its separate modal owner. */
export function inertSettingsBackground(shell: HTMLElement | null): () => void {
  if (!shell) return () => {};
  const owned = new Map<HTMLElement, boolean>();
  const synchronize = () => {
    const current = new Set(shell.querySelectorAll<HTMLElement>(':scope > .sidebar,:scope > .content-shell,:scope > .desktop-topbar,:scope > .console-shell-header'));
    for (const [element, previous] of owned) if (!current.has(element)) { element.inert = previous; owned.delete(element); }
    for (const element of current) {
      if (!owned.has(element)) owned.set(element, element.inert);
      element.inert = true;
    }
  };
  const observer = new MutationObserver(synchronize);
  observer.observe(shell, { childList: true });
  synchronize();
  return () => { observer.disconnect(); for (const [element, previous] of owned) element.inert = previous; owned.clear(); };
}
/** A nested provider/license pane consumes Back before the enclosing dialog. */
export function handleSettingsBack(surface: Pick<HTMLElement, 'querySelector'> | null, busy: boolean, close: () => void) {
  if (busy) return true;
  const back = surface?.querySelector<HTMLButtonElement>('[data-settings-subpage-back]:not([data-settings-category-back])') ?? surface?.querySelector<HTMLButtonElement>('[data-settings-category-back]');
  if (back && !back.disabled) back.click();
  else close();
  return true;
}
export function SettingsFrame({ active, select, close, busy, children, language = 'en', consoleMode = false, onRemotePlay, profile, onHelpFeedback, onViewProfile, onSignOut, canSignOut = false, signedIn = Boolean(profile?.gamertag), developerEnabled = false }: {
  active: SettingsSection; select: (section: SettingsSection) => void; close: () => void; busy: boolean; children: ReactNode;
  language?: InterfaceLanguage; consoleMode?: boolean; onRemotePlay?: () => void; onCloud?: () => void;
  profile?: {gamertag?: string; avatarDataUrl?: string}; onHelpFeedback?: () => void; onViewProfile?: () => void; onSignOut?: () => void; canSignOut?: boolean; onSignIn?: () => void; signedIn?: boolean; developerEnabled?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null), scroll = useRef(new Map<string, number>());
  const title = language === 'el' ? 'Ρυθμίσεις' : 'Settings';
  const initialRoute = settingsV2RouteForSection(active);
  const [group, setGroup] = useState<SettingsV2Group>(initialRoute.group);
  const [route, setRoute] = useState<SettingsV2Route>(initialRoute.id);
  const [detail, setDetail] = useState(!['account', 'library', 'accessibility'].includes(active));
  const [avatarFailed, setAvatarFailed] = useState<string>();
  const [narrow, setNarrow] = useState(false);
  const [narrowCategory, setNarrowCategory] = useState(false);
  useEffect(() => { const media = window.matchMedia?.('(max-width: 760px)'); if (!media) return; const change = () => setNarrow(media.matches); change(); media.addEventListener('change', change); return () => media.removeEventListener('change', change); }, []);
  const groupInfo = settingsV2Groups.find(item => item.id === group)!;
  const routeInfo = settingsV2Routes.find(item => item.id === route)!;
  const label = (item: { en: string; el: string }) => language === 'el' ? item.el : item.en;
  const description = (item: { description: string; descriptionEl: string }) => language === 'el' ? item.descriptionEl : item.description;
  const key = detail ? route : `category:${group}`;
  const inlineCategory = group === 'account' || group === 'devices' || group === 'apps' || group === 'accessibility';
  const inlineRoute = group === 'account' ? 'profile' : group === 'devices' ? 'input' : group === 'accessibility' ? 'accessibility' : 'library';
  const rememberScroll = () => { const content = root.current?.querySelector('.xbox-settings-content'); if (content) scroll.current.set(key, content.scrollTop); };
  const focusAfter = (selector: string) => requestAnimationFrame(() => root.current?.querySelector<HTMLButtonElement>(selector)?.focus());
  useEffect(() => {
    const current = settingsV2Routes.find(item => item.id === route);
    const next = current?.section === active ? current : settingsV2RouteForSection(active);
    setRoute(next.id); setGroup(next.group);
  }, [active]);
  const returnToCategory = () => {
    if (busy) return;
    rememberScroll();
    const parent = settingsV2RouteParent(route);
    if (parent) { const next = settingsV2Routes.find(item => item.id === parent)!; setRoute(parent); select(next.section); }
    else {
      const first = settingsV2CategoryRoutes(group)[0];
      setRoute(first.id); setDetail(false); setNarrowCategory(narrow); select(first.section);
    }
    focusAfter(`[data-settings-v2-open="${route}"]`);
  };
  const chooseGroup = (next: SettingsV2Group) => {
    if (busy) return;
    rememberScroll();
    const first = settingsV2CategoryRoutes(next)[0];
    setGroup(next); setRoute(first.id); setDetail(false); setNarrowCategory(narrow); select(first.section);
  };
  const chooseRoute = (next: typeof settingsV2Routes[number]) => {
    if (busy) return;
    rememberScroll(); setGroup(next.group); setRoute(next.id); setDetail(true); select(next.section);
    focusAfter('[data-settings-category-back]');
  };
  useBackHandler(() => handleSettingsBack(root.current, busy, close), true, () => root.current);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const restoreBackground = inertSettingsBackground(document.querySelector<HTMLElement>('.app-shell'));
    root.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
    return () => { restoreBackground(); if (previous?.isConnected) previous.focus(); };
  }, []);
  useEffect(() => {
    const change = (event: Event) => {
      const delta = (event as CustomEvent<number>).detail;
      if ((delta !== -1 && delta !== 1) || busy) return;
      const index = settingsV2Groups.findIndex(item => item.id === group);
      const next = settingsV2Groups[(index + delta + settingsV2Groups.length) % settingsV2Groups.length].id;
      chooseGroup(next); focusAfter(`#settings-v2-tab-${next}`);
    };
    window.addEventListener('xboks-settings-section', change);
    return () => window.removeEventListener('xboks-settings-section', change);
  }, [active, select, group, busy, key]);
  useEffect(() => { const content = root.current?.querySelector('.xbox-settings-content'); if (content) content.scrollTop = scroll.current.get(key) ?? 0; }, [key]);
  const categoryRoutes = settingsV2CategoryRoutes(group).filter(item => (item.id !== 'developer' || developerEnabled) && (item.id !== 'notifications' || signedIn !== false) && item.id !== 'manage-games' && item.id !== 'audio-visual' && item.id !== 'high-contrast');
  const notificationRoutes = settingsV2Routes.filter(item => settingsV2RouteParent(item.id) === 'notifications');
  const routeButton = (item: typeof settingsV2Routes[number]) => <button key={item.id} data-settings-v2-open={item.id} className="settings-v2-route" disabled={busy} onClick={() => chooseRoute(item)}><span><strong>{label(item)}</strong><small>{description(item)}</small></span><ChevronRight /></button>;
  const accountAction = (label: string, icon: ReactNode, press?: () => void, disabled = false, routeId?: SettingsV2Route) => <button data-settings-v2-open={routeId} className="settings-v2-route" disabled={busy || disabled || !press} onClick={press}>{icon}<span><strong>{label}</strong></span><ChevronRight /></button>;
  const accountLink = (label: string, href: string, icon?: ReactNode) => <a className="settings-v2-route" href={href} target="_blank" rel="noreferrer" aria-disabled={busy || undefined} tabIndex={busy ? -1 : undefined} onClick={event => { if (busy) event.preventDefault(); }}>{icon}<span><strong>{label}</strong></span>{icon ? <ChevronRight /> : <ExternalLink />}</a>;
  const accountActions = <div className="settings-v2-route-list settings-v2-account-actions">
    {accountAction(language === 'el' ? 'Προβολή προφίλ' : 'View profile', <CircleUserRound />, onViewProfile)}
    {accountLink(language === 'el' ? 'Εξαργύρωση κωδικού' : 'Redeem a code', 'https://redeem.microsoft.com/', <Gift />)}
    {accountAction(language === 'el' ? 'Συνδρομές' : 'Subscriptions', <GamePassBadge />, () => chooseRoute(settingsV2Routes.find(item => item.id === 'subscriptions')!), false, 'subscriptions')}
    {accountAction(language === 'el' ? 'Απόρρητο και ασφάλεια' : 'Privacy & safety', <Shield />, () => chooseRoute(settingsV2Routes.find(item => item.id === 'privacy')!), false, 'privacy')}
    {accountLink(language === 'el' ? 'Αλλαγή εικόνας παίκτη' : 'Change gamerpic', 'https://account.xbox.com/profile', <CircleUserRound />)}
    {accountLink(language === 'el' ? 'Αλλαγή ετικέτας παίκτη' : 'Change gamertag', 'https://social.xbox.com/changegamertag', <CircleUserRound />)}
    {accountLink(language === 'el' ? 'Προβολή ιστορικού παραγγελιών' : 'View order history', 'https://account.microsoft.com/billing/orders')}
    {accountLink(language === 'el' ? 'Αίτηση επιστροφής χρημάτων' : 'Request a refund', 'https://support.xbox.com/help/subscriptions-billing/buy-games-apps/refund-orders')}
    {accountLink(language === 'el' ? 'Διαχείριση λογαριασμού Microsoft Store' : 'Manage Microsoft Store account', 'https://account.microsoft.com/')}
    <button className="settings-v2-route" disabled={busy || !canSignOut || !onSignOut} onClick={onSignOut}><span><strong>{language === 'el' ? 'Αποσύνδεση' : 'Sign out'}</strong></span><LogOut /></button>
  </div>;
  return <div className={`xbox-settings-backdrop settings-v2-backdrop ${consoleMode ? 'settings-v2-fullscreen' : 'settings-v2-desktop'}`} onMouseDown={event => { if (event.target === event.currentTarget && !busy) close(); }}>
    <div ref={root} className={`xbox-settings-dialog settings-v2-dialog ${consoleMode ? 'settings-v2-low' : 'settings-v2-high'}`} data-gamepad-sections data-settings-group={group} data-settings-detail={detail || narrow && narrowCategory} role="dialog" aria-modal="true" aria-label={title} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); handleSettingsBack(root.current, busy, close); }
      if (event.key !== 'Tab') return;
      const nodes = Array.from(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href],summary') ?? []).filter(el => el.getClientRects().length);
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
      <aside className="xbox-settings-nav settings-v2-nav">
        <div className="settings-v2-profile"><span className="settings-v2-avatar">{profile?.avatarDataUrl && avatarFailed !== profile.avatarDataUrl ? <img src={profile.avatarDataUrl} alt="" onError={() => setAvatarFailed(profile.avatarDataUrl)} /> : <CircleUserRound />}</span><strong>{profile?.gamertag || title}</strong></div>
        <div role="tablist" aria-label={language === 'el' ? 'Πλοήγηση ρυθμίσεων' : 'Settings navigation'} aria-orientation="vertical">{settingsV2Groups.map(item => <button key={item.id} role="tab" aria-selected={group === item.id} id={`settings-v2-tab-${item.id}`} aria-controls="settings-content" disabled={busy} onClick={() => chooseGroup(item.id)} onKeyDown={event => {
          if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const index = settingsV2Groups.findIndex(value => value.id === item.id);
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? settingsV2Groups.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + settingsV2Groups.length) % settingsV2Groups.length;
          focusAfter(`#settings-v2-tab-${settingsV2Groups[next].id}`);
        }}><span>{label(item)}</span></button>)}</div>
        <button className="settings-v2-help" disabled={busy} onClick={onHelpFeedback ?? (() => window.open('https://support.xbox.com/', '_blank', 'noopener,noreferrer'))}><HelpCircle />{language === 'el' ? 'Βοήθεια και σχόλια' : 'Help & feedback'}</button>
      </aside>
      <section className="settings-v2-main">
        <header className="settings-v2-titlebar">{detail || narrow && narrowCategory ? <button className="settings-v2-back" data-settings-subpage-back data-settings-category-back disabled={busy} onClick={() => { if (detail) returnToCategory(); else if (!busy) { setNarrowCategory(false); focusAfter(`#settings-v2-tab-${group}`); } }} aria-label={language === 'el' ? 'Πίσω' : 'Back'}><ChevronLeft /></button> : null}{detail ? <nav className="settings-v2-breadcrumb" aria-label={language === 'el' ? 'Διαδρομή ρυθμίσεων' : 'Breadcrumb'}><button disabled={busy} onClick={returnToCategory}>{settingsV2RouteParent(route) ? label(settingsV2Routes.find(item => item.id === settingsV2RouteParent(route))!) : label(groupInfo)}</button><ChevronRight /></nav> : null}<h1 id="settings-v2-heading">{detail ? label(routeInfo) : label(groupInfo)}</h1><button className="settings-v2-close" aria-label={language === 'el' ? 'Κλείσιμο ρυθμίσεων' : 'Close settings'} data-gamepad-cancel disabled={busy} onClick={close}><X /></button></header>
        <div className="xbox-settings-content settings-v2-content" id="settings-content" role="tabpanel" aria-labelledby={`settings-v2-tab-${group}`} data-settings-v2-route={detail ? route : inlineCategory ? inlineRoute : undefined}>
          {detail ? route === 'notifications' ? <div className="settings-v2-route-list">{notificationRoutes.map(routeButton)}</div> : <SettingsV2RouteProvider value={route}>{children}</SettingsV2RouteProvider> : group === 'account' && signedIn ? accountActions : <>
            {inlineCategory ? <SettingsV2RouteProvider value={inlineRoute}>{children}</SettingsV2RouteProvider> : null}
            <div className="settings-v2-route-list">{categoryRoutes.filter(item => !inlineCategory || item.id !== inlineRoute).map(routeButton)}
              {group === 'play-social' ? <button className="settings-v2-route" disabled={busy || !onRemotePlay} onClick={onRemotePlay}><MonitorPlay /><span><strong>{language === 'el' ? 'Απομακρυσμένο παιχνίδι' : 'Remote Play'}</strong><small>{language === 'el' ? 'Οι κονσόλες Xbox σας' : 'Your Xbox consoles'}</small></span><ChevronRight /></button> : null}
            </div>
          </>}
        </div>
      </section>
      {consoleMode ? <footer className="settings-v2-footer"><kbd>B</kbd><span>{detail ? (language === 'el' ? 'Πίσω' : 'Back') : (language === 'el' ? 'Κλείσιμο' : 'Close')}</span><kbd>A</kbd><span>{language === 'el' ? 'Επιλογή' : 'Select'}</span></footer> : null}
    </div>
  </div>;
}
