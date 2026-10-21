import { useEffect, useRef, type ReactNode } from 'react';
import { X } from './XboxIcons';
import { useBackHandler } from './GamepadNavigation';
import type { InterfaceLanguage } from './ReferenceLocale';
export const settingsSections = [
  ['account', 'Account'], ['application', 'Application'], ['subscriptions', 'Subscriptions'],
  ['notifications', 'Notifications'], ['install', 'Install options'], ['library', 'Library and extensions'],
  ['audio', 'Audio'], ['accessibility', 'Accessibility'], ['about', 'About'],
] as const;
export type SettingsSection = typeof settingsSections[number][0];
const greekSections: Record<SettingsSection, string> = { account: 'Λογαριασμός', application: 'Εφαρμογή', subscriptions: 'Συνδρομές', notifications: 'Ειδοποιήσεις', install: 'Επιλογές εγκατάστασης', library: 'Βιβλιοθήκη και επεκτάσεις', audio: 'Ήχος', accessibility: 'Προσβασιμότητα', about: 'Πληροφορίες' };
/** A nested provider/license pane consumes Back before the enclosing dialog. */
export function handleSettingsBack(surface: Pick<HTMLElement, 'querySelector'> | null, busy: boolean, close: () => void) {
  if (busy) return true;
  const back = surface?.querySelector<HTMLButtonElement>('[data-settings-subpage-back]');
  if (back && !back.disabled) back.click();
  else close();
  return true;
}
export function SettingsFrame({ active, select, close, busy, children, language = 'en' }: { active: SettingsSection; select: (section: SettingsSection) => void; close: () => void; busy: boolean; children: ReactNode; language?: InterfaceLanguage }) {
  const root = useRef<HTMLDivElement>(null);
  const title = language === 'el' ? 'Ρυθμίσεις' : 'Settings';
  useBackHandler(() => handleSettingsBack(root.current, busy, close), true, () => root.current);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const background = Array.from(document.querySelectorAll<HTMLElement>('.app-shell > .sidebar,.app-shell > .content-shell'));
    const inert = background.map(el => el.inert); background.forEach(el => { el.inert = true; });
    root.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
    return () => { background.forEach((el, index) => { el.inert = inert[index]; }); if (previous?.isConnected) previous.focus(); };
  }, []);
  useEffect(() => {
    const change = (event: Event) => {
      const delta = (event as CustomEvent<number>).detail;
      if (delta !== -1 && delta !== 1) return;
      const index = settingsSections.findIndex(item => item[0] === active);
      const next = settingsSections[(index + delta + settingsSections.length) % settingsSections.length][0];
      select(next); root.current?.querySelector<HTMLButtonElement>(`#settings-tab-${next}`)?.focus();
    };
    window.addEventListener('xboks-settings-section', change);
    return () => window.removeEventListener('xboks-settings-section', change);
  }, [active, select]);
  useEffect(() => { const content = root.current?.querySelector('.xbox-settings-content'); if (content) content.scrollTop = 0; }, [active]);
  return <div className="xbox-settings-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) close(); }}>
    <div ref={root} className="xbox-settings-dialog" data-gamepad-sections role="dialog" aria-modal="true" aria-label={title} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); handleSettingsBack(root.current, busy, close); }
      if (event.key !== 'Tab') return;
      const nodes = Array.from(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href],summary') ?? []).filter(el => el.getClientRects().length);
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
      <aside className="xbox-settings-nav"><h1>{title}</h1><div role="tablist" aria-label={language === 'el' ? 'Κατηγορίες ρυθμίσεων' : 'Settings categories'} aria-orientation="vertical">{settingsSections.map(([id, label]) => <button key={id} role="tab" aria-selected={active === id} id={`settings-tab-${id}`} aria-controls="settings-content" onClick={() => select(id)} onKeyDown={event => {
        if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault(); const index = settingsSections.findIndex(item => item[0] === id);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? settingsSections.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + settingsSections.length) % settingsSections.length;
        root.current?.querySelector<HTMLButtonElement>(`#settings-tab-${settingsSections[next][0]}`)?.focus();
      }}>{language === 'el' ? greekSections[id] : label}</button>)}</div></aside>
      <button className="xbox-settings-close" aria-label={language === 'el' ? 'Κλείσιμο ρυθμίσεων' : 'Close settings'} data-gamepad-cancel disabled={busy} onClick={close}><X /></button>
      <div className="xbox-settings-content" id="settings-content" role="tabpanel" aria-labelledby={`settings-tab-${active}`}>{children}</div>
    </div>
  </div>;
}
