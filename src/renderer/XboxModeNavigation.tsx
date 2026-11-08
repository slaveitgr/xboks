import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { AppSnapshot, Page } from '../shared/types';
import { Bell, ChevronLeft, CircleUserRound, Cloud, Download, GamePassBadge, Home, Library, MonitorPlay, MoreHorizontal, Search, Settings, Store, Users } from './XboxIcons';
import { SubscriptionBadge } from './SubscriptionBadge';
import { ReferenceMenu } from './ReferenceMenu';
import { useReferenceLocale } from './ReferenceLocale';
import type { ShellPanel } from './XboxShell';
import './xbox-mode-navigation.css';

export const xboxModePrimaryPages: readonly Page[] = ['home', 'library', 'store', 'gamepass'];

export interface XboxModeNavigationProps {
  data: AppSnapshot;
  page?: Page;
  go: (page: Page) => void;
  onSearch: () => void;
  onAccount?: () => void;
  onPanel?: (panel: ShellPanel) => void;
  back?: () => void;
  status?: ReactNode;
}

/** A single console navigation surface is shared by Home and every destination.
 * Account facts are hidden during account changes, just as on desktop. */
export function XboxModeNavigation({ data, page = 'home', go, onSearch, onAccount, onPanel, back, status }: XboxModeNavigationProps) {
  const { text, language } = useReferenceLocale();
  const [failedAvatar, setFailedAvatar] = useState<string>();
  const [more, setMore] = useState<HTMLButtonElement>();
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    const header = root.current, shell = header?.closest<HTMLElement>('.app-shell');
    if (!header || !shell) return;
    const previous = shell.style.getPropertyValue('--xboks-header-height');
    const measure = () => shell.style.setProperty('--xboks-header-height', `${header.getBoundingClientRect().height}px`);
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    observer?.observe(header);
    return () => { observer?.disconnect(); if (previous) shell.style.setProperty('--xboks-header-height', previous); else shell.style.removeProperty('--xboks-header-height'); };
  }, []);
  const signedIn = data.auth.stored === true && !data.auth.running;
  const account = signedIn ? data.auth.gamertag ?? data.auth.profile?.gamertag ?? data.auth.username
    ?? text('Your profile', 'Το προφίλ σας') : text('Sign in', 'Σύνδεση');
  const avatar = signedIn ? data.auth.avatarDataUrl ?? data.auth.profile?.avatarDataUrl : undefined;
  const score = signedIn ? data.auth.profile?.gamerscore : undefined;
  const hasScore = typeof score === 'number' && Number.isSafeInteger(score) && score >= 0;
  const primary = [
    { id: 'home' as const, label: text('For you', 'Για εσάς'), icon: <Home /> },
    { id: 'library' as const, label: text('My Library', 'Η βιβλιοθήκη μου'), icon: <Library /> },
    { id: 'store' as const, label: 'Store', icon: <Store /> },
    { id: 'gamepass' as const, label: 'Game Pass', icon: <GamePassBadge /> },
  ];
  return <header ref={root} className="console-shell-header console-home-header" data-console-navigation="">
    <button className="console-home-account" aria-label={signedIn ? text(`View profile: ${account}`, `Προβολή προφίλ: ${account}`) : account}
      onClick={onAccount ?? (() => go(signedIn ? 'profile' : 'settings'))}>
      <span className="console-home-avatar">{avatar && failedAvatar !== avatar
        ? <img src={avatar} alt="" onError={() => setFailedAvatar(avatar)} /> : <CircleUserRound />}</span>
      <span className="console-home-account-copy"><span><strong>{account}</strong>{signedIn ? <SubscriptionBadge value={data.auth.subscription} /> : null}</span>
        {hasScore ? <span className="console-home-score" aria-label={text(`Gamerscore ${score}`, `Βαθμολογία παίκτη ${score}`)}><b aria-hidden="true">G</b>{new Intl.NumberFormat(language).format(score)}</span> : null}</span>
    </button>
    <nav className="console-home-shortcuts" data-gamepad-action-row="" aria-label={text('Xbox mode navigation', 'Πλοήγηση λειτουργίας Xbox')}>
      <span className="console-bumper" aria-hidden="true">LB</span>
      {primary.map(item => <button key={item.id} className={page === item.id ? 'selected' : undefined} aria-current={page === item.id ? 'page' : undefined}
        title={item.label} aria-label={item.label} onClick={() => go(item.id)}>{item.icon}{page === item.id ? <span className="console-nav-label">{item.label}</span> : null}</button>)}
      <button title={text('Search', 'Αναζήτηση')} aria-label={text('Search', 'Αναζήτηση')} onClick={onSearch}><Search /></button>
      <button className={page === 'settings' ? 'selected' : undefined} aria-current={page === 'settings' ? 'page' : undefined} title={text('Settings', 'Ρυθμίσεις')} aria-label={text('Settings', 'Ρυθμίσεις')} onClick={() => go('settings')}><Settings /></button>
      <button title={text('More', 'Περισσότερα')} aria-label={text('More', 'Περισσότερα')} aria-haspopup="menu" aria-expanded={Boolean(more)} onClick={event => setMore(event.currentTarget)}><MoreHorizontal /></button>
      <span className="console-bumper" aria-hidden="true">RB</span>
    </nav>
    <div className="console-home-status xbox-mode-home-status">{status}</div>
    {back ? <button className="console-page-back" aria-label={text('Back', 'Πίσω')} onClick={back}><ChevronLeft /><span>{text('Back', 'Πίσω')}</span></button> : null}
    {more ? <ReferenceMenu id="console-navigation-more" className="console-navigation-menu" label={text('More', 'Περισσότερα')} anchor={{ element: more, align: 'end' }} onDismiss={() => setMore(undefined)} items={[
      { id: 'cloud', label: text('Cloud gaming', 'Παιχνίδια στο cloud'), icon: <Cloud />, onSelect: () => go('cloud') },
      { id: 'remote-play', label: 'Remote Play', icon: <MonitorPlay />, disabled: !onPanel, onSelect: () => onPanel?.('remote-play') },
      { id: 'friends', label: text('Friends and chats', 'Φίλοι και συνομιλίες'), icon: <Users />, disabled: !onPanel, onSelect: () => onPanel?.('friends') },
      { id: 'notifications', label: text('Notifications', 'Ειδοποιήσεις'), icon: <Bell />, disabled: !onPanel, onSelect: () => onPanel?.('notifications') },
      { id: 'queue', label: text('Install queue', 'Ουρά εγκαταστάσεων'), icon: <Download />, onSelect: () => go('downloads') },
    ]} /> : null}
  </header>;
}
