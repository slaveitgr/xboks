import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Mic } from './XboxIcons';
import { Camera, ChevronRight, Cog, Download, ExternalLink, Gamepad2, Globe, Home, Library, Maximize, Search, Users, Volume2, VolumeX, X } from './XboxIcons';
import { GuideHomeIcon, GuideSettingsIcon, GuideFriendsIcon, GuideAudioIcon, GuideCaptureIcon } from './XboxIcons';
import type { AppSnapshot, GuideAudio, Page } from '../shared/types';
import { useBackHandler } from './GamepadNavigation';
import { dispatchBackHandlers } from './gamepad-navigation';
import { useReferenceLocale } from './ReferenceLocale';
import { GuideSystemControls } from './GuideSystemControls';
import { XboxSocialPanel } from './XboxSocialPanel';
import { LocalVoiceTest } from './LocalVoiceTest';
import './guide-overlay.css';

export const guideTabs = ['home', 'settings', 'browser', 'social', 'audio', 'capture'] as const;
export type GuideTab = typeof guideTabs[number];
const tabs = [
  { id: 'home', label: 'Home', greek: 'Αρχική οθόνη', icon: GuideHomeIcon }, { id: 'settings', label: 'Settings', greek: 'Ρυθμίσεις', icon: GuideSettingsIcon },
  { id: 'browser', label: 'Browser', greek: 'Πρόγραμμα περιήγησης', icon: Globe }, { id: 'social', label: 'Friends', greek: 'Φίλοι', icon: GuideFriendsIcon },
  { id: 'audio', label: 'Audio', greek: 'Ήχος', icon: GuideAudioIcon }, { id: 'capture', label: 'Capture', greek: 'Καταγραφή', icon: GuideCaptureIcon },
] as const;
const useGuideLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;
const visible = (element: HTMLElement) => {
  if (!element.isConnected || element.closest('[hidden],[inert],[aria-hidden="true"]') || !element.getClientRects().length) return false;
  const style = element.ownerDocument.defaultView?.getComputedStyle?.(element);
  return !style || (style.visibility !== 'hidden' && style.visibility !== 'collapse' && style.display !== 'none');
};
/** Keyboard fallback uses the same active-scope boundary as controller Back.
 * An unknown inner modal consumes Escape even without its own registration. */
export function handleGuideBack(guide: HTMLElement | null, close: () => void): boolean {
  if (!guide?.isConnected) return false;
  const owner = guide.ownerDocument;
  const scope = [...owner.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"],[data-game-menu],[data-guide-system-subpage]')].filter(visible).at(-1) ?? guide;
  if (scope !== guide) {
    if (owner.defaultView && dispatchBackHandlers(owner.defaultView, scope)) return true;
    const cancel = scope.querySelector<HTMLElement>('[data-gamepad-cancel]');
    if (cancel && visible(cancel) && !cancel.matches(':disabled,[aria-disabled="true"]')) cancel.click();
    return true;
  }
  close(); return true;
}
export interface GuideFullscreenSurface {
  fullscreenElement: unknown;
  fullscreenEnabled?: boolean;
  exitFullscreen?: () => Promise<void>;
  documentElement: { requestFullscreen?: () => Promise<void> };
}
export function guideWindowFullscreenAvailable(surface: GuideFullscreenSurface | undefined, desktopGuide: boolean): boolean {
  return !desktopGuide && Boolean(surface && (surface.fullscreenElement ? typeof surface.exitFullscreen === 'function'
    : surface.fullscreenEnabled !== false && typeof surface.documentElement.requestFullscreen === 'function'));
}
/** This changes only the inline launcher's browser window. It never enters an
 * OS gaming session or changes the separate desktop overlay window. */
export async function toggleGuideWindowFullscreen(surface: GuideFullscreenSurface | undefined, desktopGuide: boolean): Promise<boolean> {
  if (!guideWindowFullscreenAvailable(surface, desktopGuide) || !surface) return false;
  if (surface.fullscreenElement) await surface.exitFullscreen!();
  else await surface.documentElement.requestFullscreen!();
  return true;
}

export function GuideOverlay({ data, tab, setTab, close, go, openGame }: {
  data: AppSnapshot; tab: GuideTab; setTab: (tab: GuideTab) => void; close: () => void;
  go: (page: Page) => void; openGame: (id: string) => void;
}) {
  const locale = useReferenceLocale(), t = locale.text;
  const root = useRef<HTMLDivElement>(null), pending = useRef(false);
  const [audio, setAudio] = useState<GuideAudio>();
  const [volume, setVolume] = useState(0), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [query, setQuery] = useState(''), [capturePath, setCapturePath] = useState('');
  const [now, setNow] = useState(() => new Date());
  const surface = typeof document === 'undefined' ? undefined : document;
  // The bridge is also exposed in the main window; the dedicated route identifies its host.
  const desktopGuide = typeof window !== 'undefined' && window.location?.hash === '#desktop-guide' && Boolean(window.desktopGuide);
  const [windowFullscreen, setWindowFullscreen] = useState(() => Boolean(surface?.fullscreenElement));
  const canFullscreen = guideWindowFullscreenAvailable(surface, desktopGuide);
  const canCapture = typeof window !== 'undefined' && typeof window.launcher?.captureLauncher === 'function';
  useBackHandler(() => handleGuideBack(root.current, close), true, () => root.current);
  useGuideLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const shell = document.querySelector<HTMLElement>('.app-shell'), wasInert = shell?.inert ?? false;
    if (shell) shell.inert = true;
    root.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
    return () => { if (shell) shell.inert = wasInert; if (previous?.isConnected) previous.focus(); };
  }, []);
  useEffect(() => {
    let cancelled = false;
    const unavailable = () => { if (!cancelled) setAudio({ available:false, reason: t('System audio is unavailable.', 'Ο ήχος συστήματος δεν είναι διαθέσιμος.') }); };
    if (typeof window.launcher?.getGuideAudio === 'function') void window.launcher.getGuideAudio().then(value => { if (!cancelled) { setAudio(value); if (value.available) setVolume(value.volume); } }).catch(unavailable);
    else unavailable();
    return () => { cancelled = true; };
  }, [locale.language]);
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 30000); return () => window.clearInterval(timer); }, []);
  useEffect(() => { const changed = () => setWindowFullscreen(Boolean(document.fullscreenElement)); document.addEventListener('fullscreenchange', changed); return () => document.removeEventListener('fullscreenchange', changed); }, []);
  const navigate = (page: Page) => { close(); go(page); };
  async function updateAudio(patch: { volume?: number; muted?: boolean }) {
    if (pending.current || typeof window.launcher?.setGuideAudio !== 'function') return;
    pending.current = true; setBusy(true); setMessage('');
    try { const value = await window.launcher.setGuideAudio(patch); setAudio(value); if (value.available) setVolume(value.volume); }
    catch { setMessage(t('The audio setting could not be applied.', 'Δεν ήταν δυνατή η εφαρμογή της ρύθμισης ήχου.')); }
    finally { pending.current = false; setBusy(false); }
  }
  async function capture() {
    if (pending.current || !canCapture) return;
    pending.current = true; setBusy(true); setMessage('');
    try {
      document.documentElement.setAttribute('data-guide-capture', '');
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const path = await window.launcher.captureLauncher(); setCapturePath(path); setMessage(t('Screenshot saved to Pictures/xboks.', 'Το στιγμιότυπο αποθηκεύτηκε στον φάκελο Εικόνες/xboks.'));
    } catch { setMessage(t('The screenshot could not be saved.', 'Δεν ήταν δυνατή η αποθήκευση του στιγμιότυπου.')); }
    finally { document.documentElement.removeAttribute('data-guide-capture'); pending.current = false; setBusy(false); }
  }
  const audioReason = (reason: string) => {
    if (locale.language !== 'el') return reason;
    return ({ 'System audio controls are disabled in demo mode.':'Τα στοιχεία ήχου συστήματος είναι απενεργοποιημένα στη λειτουργία επίδειξης.',
      'System audio needs PipeWire/WirePlumber and the wpctl utility.':'Ο ήχος συστήματος απαιτεί PipeWire/WirePlumber και το εργαλείο wpctl.',
      'The audio service returned an unsupported response.':'Η υπηρεσία ήχου επέστρεψε μη υποστηριζόμενη απόκριση.',
      'Audio volume is unavailable.':'Η ένταση ήχου δεν είναι διαθέσιμη.' } as Record<string,string>)[reason] ?? reason;
  };
  const audioControls = <>
    {!audio ? <p className="guide-muted" role="status">{t('Checking system audio…', 'Έλεγχος ήχου συστήματος…')}</p> : audio.available ? <div className="guide-volume">
      <button aria-label={audio.muted ? t('Unmute system audio', 'Κατάργηση σίγασης ήχου συστήματος') : t('Mute system audio', 'Σίγαση ήχου συστήματος')} disabled={busy || typeof window.launcher?.setGuideAudio !== 'function'} onClick={() => void updateAudio({ muted: !audio.muted })}>{audio.muted ? <VolumeX /> : <Volume2 />}</button>
      <label><span>{t('System volume', 'Ένταση συστήματος')} <b>{volume}%</b></span><input aria-label={t('System volume', 'Ένταση συστήματος')} type="range" min="0" max="100" value={volume} disabled={busy || typeof window.launcher?.setGuideAudio !== 'function'} onChange={event => setVolume(Number(event.target.value))} onPointerUp={() => void updateAudio({ volume })} onKeyUp={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) void updateAudio({ volume }); }} onBlur={() => { if (volume !== audio.volume) void updateAudio({ volume }); }} /></label>
    </div> : <p className="guide-note" role="status">{audioReason(audio.reason)}</p>}
  </>;
  return <div ref={root} className="guide-overlay" data-gamepad-sections role="dialog" aria-modal="true" aria-label="xboks Game Bar" aria-busy={busy || undefined} onMouseDown={event => { if (event.target === event.currentTarget) handleGuideBack(root.current, close); }} onKeyDown={event => {
    if (event.key === 'Escape' && !event.defaultPrevented) { if (handleGuideBack(root.current, close)) { event.preventDefault(); event.stopPropagation(); } }
    if (event.key === 'Tab' && !event.defaultPrevented) {
      const nodes = Array.from(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled)') ?? []).filter(visible);
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }}>
    <div className="guide-tabs" role="tablist" aria-label={t('Game Bar sections', 'Καρτέλες Game Bar')}>{tabs.map(({ id, label, greek, icon: Icon }) => <button key={id} role="tab" id={`guide-tab-${id}`} aria-label={t(label,greek)} title={t(label,greek)} aria-selected={tab === id} aria-controls="guide-panel" onClick={() => setTab(id)} onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation(); const index = guideTabs.indexOf(id);
      const next = event.key === 'Home' ? guideTabs[0] : event.key === 'End' ? guideTabs.at(-1)! : guideTabs[(index + (event.key === 'ArrowRight' ? 1 : -1) + guideTabs.length) % guideTabs.length];
      setTab(next); root.current?.querySelector<HTMLButtonElement>(`#guide-tab-${next}`)?.focus();
    }}><Icon /></button>)}</div>
    <div className="guide-system"><time>{now.toLocaleTimeString(locale.language === 'el' ? 'el-GR' : undefined, { hour: '2-digit', minute: '2-digit' })}</time><button data-gamepad-cancel aria-label={t('Close Game Bar', 'Κλείσιμο Game Bar')} onClick={close}><X /></button></div>
    <section className="guide-panel" id="guide-panel" role="tabpanel" aria-labelledby={`guide-tab-${tab}`} tabIndex={-1}>
      <h2>{tabs.filter(item => item.id === tab).map(item => t(item.label,item.greek))}</h2>
      <div className="guide-panel-scroll">
        {tab === 'home' ? <>
          <div className="guide-action-pair"><button onClick={() => navigate('home')}><Home />{t('Home', 'Αρχική οθόνη')}</button><button onClick={() => navigate('library')}><Library />{t('Library', 'Βιβλιοθήκη')}</button></div>
          <div className="guide-recent-list">{data.games.slice(0, 4).map(game => <button key={game.id} onClick={() => { close(); openGame(game.id); }}>{game.coverUrl || game.coverDataUrl ? <img src={game.coverUrl ?? game.coverDataUrl} alt="" /> : <Gamepad2 />}<span><strong>{game.title}</strong><small>{game.installState === 'ready' ? t('Installed', 'Εγκατεστημένο') : t('View game', 'Προβολή παιχνιδιού')}</small></span><ChevronRight /></button>)}</div>
          {!data.games.length ? <p className="guide-muted">{t('Your recent games will appear here after you add games to the library.', 'Τα πρόσφατα παιχνίδια σας θα εμφανιστούν εδώ μετά την προσθήκη τους στη βιβλιοθήκη.')}</p> : null}
          <hr /><button className="guide-row" onClick={() => navigate('downloads')}><Download />{t('Install queue', 'Ουρά εγκατάστασης')}<ChevronRight /></button>
        </> : null}
        {tab === 'settings' ? <>{audioControls}<button className="guide-wide" disabled={!desktopGuide && !canFullscreen} onClick={() => { if (desktopGuide) { navigate('settings'); return; } void toggleGuideWindowFullscreen(surface, false).then(changed => { if (!changed) setMessage(t('Window fullscreen is unavailable.', 'Η πλήρης οθόνη παραθύρου δεν είναι διαθέσιμη.')); }).catch(() => setMessage(t('Window fullscreen could not be changed.', 'Δεν ήταν δυνατή η αλλαγή πλήρους οθόνης παραθύρου.'))); }}>{desktopGuide ? <Cog /> : <Maximize />}{desktopGuide ? t('Open app settings', 'Άνοιγμα ρυθμίσεων εφαρμογής') : windowFullscreen ? t('Exit window fullscreen', 'Έξοδος από πλήρη οθόνη παραθύρου') : t('Enter window fullscreen', 'Πλήρης οθόνη παραθύρου')}</button>{!desktopGuide ? <p className="guide-muted">{t('Changes the app window only. Fullscreen Experience is managed by the gaming session.', 'Αλλάζει μόνο το παράθυρο της εφαρμογής. Το Fullscreen Experience ελέγχεται από τη συνεδρία παιχνιδιών.')}</p> : null}<hr /><button className="guide-row" onClick={() => navigate('settings')}><Cog />{t('More settings', 'Περισσότερες ρυθμίσεις')}<ChevronRight /></button><GuideSystemControls /></> : null}
        {tab === 'audio' ? <>{audioControls}<hr /><h3>{t('Default output', 'Προεπιλεγμένη έξοδος')}</h3><p className="guide-muted">{audio?.available ? t('Uses the current system output through PipeWire.', 'Χρησιμοποιεί την τρέχουσα έξοδο συστήματος μέσω PipeWire.') : t('System output controls require an available audio service.', 'Τα στοιχεία εξόδου συστήματος απαιτούν διαθέσιμη υπηρεσία ήχου.')}</p><LocalVoiceTest /><h3>{t('App mixer', 'Μείκτης εφαρμογών')}</h3><p className="guide-note">{t('Individual app volume controls are not connected yet.', 'Η ένταση ανά εφαρμογή δεν έχει συνδεθεί ακόμη.')}</p></> : null}
        {tab === 'capture' ? <><button className="guide-wide guide-capture" disabled={busy || !canCapture} onClick={() => void capture()}><Camera />{busy ? t('Saving…', 'Αποθήκευση…') : t('Take screenshot', 'Λήψη στιγμιότυπου')}</button><p className="guide-muted">{t('Captures the xboks window without this overlay. Saved as PNG in Pictures/xboks.', 'Καταγράφει το παράθυρο xboks χωρίς αυτήν την επικάλυψη. Αποθηκεύεται ως PNG στον φάκελο Εικόνες/xboks.')}</p>{capturePath ? <button className="guide-wide" disabled={typeof window.launcher?.openPath !== 'function'} onClick={() => void window.launcher.openPath(capturePath).catch(() => setMessage(t('The screenshot could not be opened.', 'Δεν ήταν δυνατό το άνοιγμα του στιγμιότυπου.')))}>{t('Open screenshot', 'Άνοιγμα στιγμιότυπου')}<ExternalLink /></button> : null}<hr /><p className="guide-note">{t('Game video recording and capture outside xboks are not connected yet.', 'Η εγγραφή βίντεο παιχνιδιών και η καταγραφή εκτός xboks δεν έχουν συνδεθεί ακόμη.')}</p></> : null}
        {tab === 'social' ? <XboxSocialPanel auth={data.auth} variant="guide" accountSettings={() => navigate('settings')} /> : null}
        {tab === 'browser' ? <><form className="guide-web-search" onSubmit={event => { event.preventDefault(); const text = query.trim(); if (text) window.open(`https://www.bing.com/search?q=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer'); }}><Search /><input aria-label={t('Search the web', 'Αναζήτηση στο Web')} placeholder={t('Search the web', 'Αναζήτηση στο Web')} value={query} onChange={event => setQuery(event.target.value)} /><button type="submit" disabled={!query.trim()} aria-label={t('Open search in browser', 'Άνοιγμα αναζήτησης στο πρόγραμμα περιήγησης')}><ChevronRight /></button></form><p className="guide-muted">{t('Search opens in your default browser. An embedded browser widget is not available yet.', 'Η αναζήτηση ανοίγει στο προεπιλεγμένο πρόγραμμα περιήγησης. Δεν υπάρχει ακόμη ενσωματωμένο γραφικό στοιχείο περιήγησης.')}</p><a className="guide-wide" href="https://www.xbox.com/play" target="_blank" rel="noreferrer">{t('Xbox on the web', 'Xbox στο Web')}<ExternalLink /></a></> : null}
        {message ? <p className="guide-message" role="status">{message}</p> : null}
      </div>
    </section>
    <div className="guide-hints">{t('A Select · B Back · LB / RB Sections · Win + G when configured', 'A Επιλογή · B Πίσω · LB / RB Καρτέλες · Win + G εφόσον ρυθμιστεί')}</div>
  </div>;
}
