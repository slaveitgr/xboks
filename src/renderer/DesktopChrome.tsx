import { useId, useRef, useState, type ReactNode } from 'react';
import type { AppSnapshot, Page } from '../shared/types';
import { subscriptionBadge } from '../shared/subscription';
import { Bell, ChevronLeft, CircleUserRound, Cloud, GamePassBadge, Home, Library, MonitorPlay, MoreHorizontal, Settings, Store, Users } from './XboxIcons';
import { ReferenceMenu, type ReferenceMenuItem } from './ReferenceMenu';
import { SubscriptionBadge } from './SubscriptionBadge';
import { useReferenceLocale } from './ReferenceLocale';
import type { ShellPanel } from './XboxShell';
import './desktop-chrome.css';

const logo = new URL('../../assets/icon.png', import.meta.url).href;
export const desktopPrimaryPages = ['home', 'library', 'gamepass', 'store'] as const;
type Text = (en: string, el: string) => string;

export function desktopMoreActions(go: (page: Page) => void, onPanel: (panel: ShellPanel) => void, t: Text): ReferenceMenuItem[] {
  return [
    { id: 'cloud', label: t('Cloud gaming', 'Παιχνίδι στο cloud'), icon: <Cloud />, onSelect: () => go('cloud') },
    { id: 'remote-play', label: 'Remote Play', icon: <MonitorPlay />, onSelect: () => onPanel('remote-play') },
    { id: 'settings', label: t('Settings', 'Ρυθμίσεις'), icon: <Settings />, onSelect: () => go('settings') },
  ];
}

function DesktopAvatar({ auth }: { auth: AppSnapshot['auth'] }) {
  const [failed, setFailed] = useState<string>();
  const source = auth.stored === true && !auth.running ? auth.avatarDataUrl : undefined;
  return <span className="desktop-avatar">{source && failed !== source
    ? <img src={source} alt="" onError={() => setFailed(source)} />
    : <CircleUserRound />}</span>;
}

export function DesktopHeader({ data, search, controls, collapsed, onCollapsed, onPanel, back }: {
  data: AppSnapshot;
  search: ReactNode;
  controls?: ReactNode;
  collapsed: boolean;
  onCollapsed: (collapsed: boolean) => void;
  onPanel: (panel: ShellPanel) => void;
  back?: () => void;
}) {
  const { text: t } = useReferenceLocale();
  const signedIn = data.auth.stored === true && !data.auth.running;
  const name = signedIn ? data.auth.gamertag ?? data.auth.username ?? t('Microsoft account', 'Λογαριασμός Microsoft')
    : data.auth.running ? t('Connecting…', 'Σύνδεση…') : t('Sign in', 'Σύνδεση');
  const membership = signedIn ? subscriptionBadge(data.auth.subscription) : undefined;
  const profileTitle = [name, membership].filter(Boolean).join(' · ');
  return <header className="desktop-topbar">
    <div className="desktop-brand-controls">
      <span className="desktop-brand" aria-label="XBOKS" title="XBOKS"><img src={logo} alt="" /></span>
      <button className="desktop-collapse" type="button" aria-label={collapsed ? t('Expand sidebar', 'Ανάπτυξη πλαϊνής γραμμής') : t('Collapse sidebar', 'Σύμπτυξη πλαϊνής γραμμής')}
        title={collapsed ? t('Expand sidebar', 'Ανάπτυξη πλαϊνής γραμμής') : t('Collapse sidebar', 'Σύμπτυξη πλαϊνής γραμμής')}
        aria-expanded={!collapsed} aria-controls="desktop-sidebar" onClick={() => onCollapsed(!collapsed)}>
        <span className={`desktop-collapse-icon${collapsed ? ' is-collapsed' : ''}`}><ChevronLeft /></span>
      </button>
    </div>
    <div className="desktop-search-area">
      {back ? <button className="desktop-back" type="button" aria-label={t('Back', 'Πίσω')} title={t('Back', 'Πίσω')} onClick={back}><ChevronLeft /></button> : <span className="desktop-back-space" aria-hidden="true" />}
      {search}
    </div>
    <div className="desktop-header-actions">
      {controls ? <div className="desktop-mode-controls">{controls}</div> : null}
      <button className="desktop-notifications" type="button" aria-label={t('Notifications', 'Ειδοποιήσεις')} title={t('Notifications', 'Ειδοποιήσεις')} aria-haspopup="dialog" onClick={() => onPanel('notifications')}><Bell /></button>
      <button className="desktop-account" type="button" aria-label={`${t('Account menu', 'Μενού λογαριασμού')}: ${profileTitle}`} title={profileTitle} aria-haspopup="dialog" onClick={() => onPanel('account')}>
        <DesktopAvatar auth={data.auth} />
        <span className="desktop-account-copy"><strong>{name}</strong>{signedIn ? <SubscriptionBadge value={data.auth.subscription} /> : null}</span>
      </button>
    </div>
  </header>;
}

export function DesktopSidebar({ page, go, onPanel, collapsed, social, queue }: {
  page: Page;
  go: (page: Page) => void;
  onPanel: (panel: ShellPanel) => void;
  collapsed: boolean;
  social: ReactNode;
  queue: ReactNode;
}) {
  const { text: t } = useReferenceLocale();
  const [more, setMore] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const destinations = {
    home: { label: t('Home', 'Αρχική οθόνη'), icon: <Home /> },
    library: { label: t('Library', 'Βιβλιοθήκη'), icon: <Library /> },
    gamepass: { label: 'Game Pass', icon: <GamePassBadge /> },
    store: { label: 'Store', icon: <Store /> },
  };
  return <aside id="desktop-sidebar" className="sidebar desktop-sidebar" data-collapsed={collapsed || undefined}>
    <div className="desktop-navigation-panel">
      <nav className="desktop-primary-nav" aria-label={t('Main navigation', 'Κύρια πλοήγηση')}>
        {desktopPrimaryPages.map(destination => <button key={destination} type="button" className={`nav-item${page === destination ? ' active' : ''}`}
          data-desktop-page={destination} data-gamepad-auto-select="" aria-current={page === destination ? 'page' : undefined}
          aria-label={destinations[destination].label} title={destinations[destination].label} onClick={() => go(destination)}>
          {destinations[destination].icon}<span className="desktop-nav-label">{destinations[destination].label}</span>
        </button>)}
      </nav>
      <div className="desktop-navigation-tools"><button ref={anchor} className={`desktop-more${page === 'cloud' ? ' active' : ''}`} type="button"
        aria-label={t('More destinations', 'Περισσότεροι προορισμοί')} title={t('Cloud gaming, Remote Play and Settings', 'Παιχνίδι στο cloud, Remote Play και Ρυθμίσεις')}
        aria-haspopup="menu" aria-expanded={more} aria-controls={more ? menuId : undefined} onClick={() => setMore(value => !value)}><MoreHorizontal /></button></div>
      {more && anchor.current ? <ReferenceMenu id={menuId} label={t('More destinations', 'Περισσότεροι προορισμοί')} anchor={{ element: anchor.current }}
        items={desktopMoreActions(go, onPanel, t)} onDismiss={() => setMore(false)} /> : null}
    </div>
    <div className="desktop-sidebar-social">
      {!collapsed ? <div className="desktop-social-expanded">{social}</div> : null}
      <button className="desktop-social-collapsed" type="button" aria-label={t('Friends', 'Φίλοι')} title={t('Friends', 'Φίλοι')} onClick={() => onPanel('friends')}><Users /></button>
    </div>
    <div className="desktop-sidebar-queue">{queue}</div>
  </aside>;
}
