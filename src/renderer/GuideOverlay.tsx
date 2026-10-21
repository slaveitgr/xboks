import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Mic, ChevronLeft, Images, GuideWidgetsIcon } from './XboxIcons';
import { Pin, Keyboard, Plane, MousePointer2, History, Circle, MicOff, AppWindow } from 'lucide-react';
import { Camera, ChevronRight, Cog, Download, ExternalLink, Gamepad2, Globe, Home, Library, Maximize, Search, Users, Volume2, VolumeX, X } from './XboxIcons';
import { GuideHomeIcon, GuideSettingsIcon, GuideFriendsIcon, GuideAudioIcon, GuideCaptureIcon } from './XboxIcons';
import type { AppSnapshot, GuideAudio, Page } from '../shared/types';
import { useBackHandler } from './GamepadNavigation';
import { dispatchBackHandlers } from './gamepad-navigation';
import { useReferenceLocale } from './ReferenceLocale';
import { GuideSystemControls } from './GuideSystemControls';
import { XboxSocialPanel } from './XboxSocialPanel';
import { LocalVoiceTest } from './LocalVoiceTest';
import { GuideMixerWidget } from './GuideMixerWidget';
import { observeWindowFullscreen, type NativeFullscreenBridge, type WindowFullscreenState, formatShellClock } from './ShellHeaderControls';
import { GuideWidgetDirectory, guideWidgetDefinitions, guideWidgetDefinition } from './GuideWidgetDirectory';
import { GuideSettingsPanel } from './GuideSettingsPanel';
import { GuideGalleryWidget, GuidePerformanceWidget, GuideSpotifyWidget } from './GuideWidgets';
import { guideWidgetIds, readGuideWidgetPreferences, saveGuideWidgetPreferences, toggleGuideWidgetPreference, type GuideWidgetId, type GuideWidgetPreferences } from './guide-widget-preferences';
import { loadCollections } from './LibraryChrome';
import { guideHistoryKey, recentGuideGames } from './guide-home';
import './guide-overlay.css';

export const guideTabs = [...guideWidgetIds, 'widgets'] as const;
export type GuideTab = typeof guideTabs[number];
/** Controller shoulder navigation follows visible favorite shortcuts. */
export function cycleGuideTab(current:GuideTab,direction:number):GuideTab {const preferences=readGuideWidgetPreferences();const ids:GuideTab[]=[...preferences.favorites.filter(id=>!preferences.hidden.includes(id)),'widgets'];const index=ids.indexOf(current);return ids[(Math.max(-1,index)+(direction>0?1:-1)+ids.length)%ids.length];}
const tabs = guideWidgetDefinitions;
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
export function guideWindowFullscreenAvailable(surface: GuideFullscreenSurface | undefined, desktopGuide: boolean, bridge?: NativeFullscreenBridge, nativeFullscreen = false): boolean {
  if (bridge?.setWindowFullscreen) return !desktopGuide || nativeFullscreen;
  return !desktopGuide && Boolean(surface && (surface.fullscreenElement ? typeof surface.exitFullscreen === 'function'
    : surface.fullscreenEnabled !== false && typeof surface.documentElement.requestFullscreen === 'function'));
}
/** Native controls address the main launcher, including from its separate
 * guide. A browser-only fallback never makes the overlay itself fullscreen. */
export async function toggleGuideWindowFullscreen(surface: GuideFullscreenSurface | undefined, desktopGuide: boolean, bridge?: NativeFullscreenBridge, nativeFullscreen = false): Promise<boolean> {
  if (!guideWindowFullscreenAvailable(surface, desktopGuide, bridge, nativeFullscreen)) return false;
  if (bridge?.setWindowFullscreen) {
    const enabled = !desktopGuide && !nativeFullscreen && !surface?.fullscreenElement;
    if (await bridge.setWindowFullscreen(enabled) !== enabled) throw new Error('The window fullscreen state could not be changed.');
    if (!enabled && !desktopGuide && surface?.fullscreenElement && surface.exitFullscreen) await surface.exitFullscreen();
    return true;
  }
  if (!surface) return false;
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
  const [, refreshHistory] = useState(0);
  const historyKey = guideHistoryKey(data.auth);
  const recentGames = historyKey ? recentGuideGames(data.games, loadCollections(historyKey).history) : [];
  useEffect(() => {
    const refresh = () => refreshHistory(value => value + 1);
    window.addEventListener('storage', refresh); window.addEventListener('xboks-library-collections', refresh);
    return () => { window.removeEventListener('storage', refresh); window.removeEventListener('xboks-library-collections', refresh); };
  }, []);
  const [preferences,setPreferences]=useState(readGuideWidgetPreferences);
  const [toolbarStart,setToolbarStart]=useState(()=>{
    const ids:GuideTab[]=tabs.filter(item=>preferences.favorites.includes(item.id)&&!preferences.hidden.includes(item.id)).map(item=>item.id);
    if(tab!=='widgets'&&!ids.includes(tab))ids.push(tab);
    return Math.floor(Math.max(0,ids.indexOf(tab))/6)*6;
  });
  const [settingsOpen,setSettingsOpen]=useState(false),[settingsWide,setSettingsWide]=useState(false);
  const [systemLight,setSystemLight]=useState(()=>typeof window!=='undefined'&&Boolean(window.matchMedia?.('(prefers-color-scheme: light)').matches));
  const changePreferences=(patch:Partial<GuideWidgetPreferences>)=>setPreferences(old=>{const value={...old,...patch};saveGuideWidgetPreferences(value);return value;});
  const togglePreference=(key:'favorites'|'pinned',id:GuideWidgetId)=>setPreferences(old=>{const value=toggleGuideWidgetPreference(old,key,id);saveGuideWidgetPreferences(value);return value;});
  const chooseTab=(value:GuideTab)=>{setSettingsOpen(false);setSettingsWide(false);setMessage('');setTab(value);};
  const toolbarWidgets=tabs.filter(item=>preferences.favorites.includes(item.id)&&!preferences.hidden.includes(item.id));
  const activeWidgets=toolbarWidgets.some(item=>item.id===tab)||tab==='widgets'?toolbarWidgets:[...toolbarWidgets,...tabs.filter(item=>item.id===tab)];
  const displayedWidgets=activeWidgets.slice(toolbarStart,toolbarStart+6);
  useEffect(()=>{if(preferences.startHome)setTab('home');},[]);
  useEffect(()=>{setSettingsOpen(false);setSettingsWide(false);const index=activeWidgets.findIndex(item=>item.id===tab);if(index>=0&&(index<toolbarStart||index>=toolbarStart+6))setToolbarStart(Math.floor(index/6)*6);},[tab]);
  useEffect(()=>{if(toolbarStart>=activeWidgets.length)setToolbarStart(0);},[activeWidgets.length]);
  useEffect(()=>{const refresh=()=>setPreferences(readGuideWidgetPreferences());window.addEventListener('storage',refresh);const media=window.matchMedia?.('(prefers-color-scheme: light)');const theme=()=>setSystemLight(Boolean(media?.matches));media?.addEventListener('change',theme);return()=>{window.removeEventListener('storage',refresh);media?.removeEventListener('change',theme);};},[]);
  const [now, setNow] = useState(() => new Date());
  const surface = typeof document === 'undefined' ? undefined : document;
  // The bridge is also exposed in the main window; the dedicated route identifies its host.
  const desktopGuide = typeof window !== 'undefined' && window.location?.hash === '#desktop-guide' && Boolean(window.desktopGuide);
  const nativeFullscreenBridge = typeof window === 'undefined' ? undefined : window.launcher;
  const [fullscreenState, setFullscreenState] = useState<WindowFullscreenState>(() => ({ documentFullscreen: Boolean(surface?.fullscreenElement), nativeFullscreen: false }));
  const windowFullscreen = fullscreenState.documentFullscreen || fullscreenState.nativeFullscreen;
  const canFullscreen = guideWindowFullscreenAvailable(surface, desktopGuide, nativeFullscreenBridge, fullscreenState.nativeFullscreen);
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
  useEffect(() => { const observer = observeWindowFullscreen(document, window.launcher, setFullscreenState); return () => observer.stop(); }, []);
  const navigate = (page: Page) => { close(); go(page); };
  async function changeFullscreen() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setMessage('');
    try {
      const changed = await toggleGuideWindowFullscreen(surface, desktopGuide, nativeFullscreenBridge, fullscreenState.nativeFullscreen);
      if (!changed) setMessage(t('Window fullscreen is unavailable.', 'Η πλήρης οθόνη παραθύρου δεν είναι διαθέσιμη.'));
      else if (windowFullscreen) close();
    } catch { setMessage(t('Window fullscreen could not be changed.', 'Δεν ήταν δυνατή η αλλαγή πλήρους οθόνης παραθύρου.')); }
    finally { pending.current = false; setBusy(false); }
  }
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
      const path = await window.launcher.captureLauncher(); setCapturePath(path); if(preferences.captureNotifications)setMessage(t('Screenshot saved to Pictures/xboks.', 'Το στιγμιότυπο αποθηκεύτηκε στον φάκελο Εικόνες/xboks.'));
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
      <label><span>{t('System volume', 'Ένταση συστήματος')} <b>{volume}%</b></span><input aria-label={t('System volume', 'Ένταση συστήματος')} type="range" min="0" max="100" value={volume} disabled={typeof window.launcher?.setGuideAudio !== 'function'} readOnly={busy} aria-disabled={busy || undefined} data-gamepad-pending={busy ? '' : undefined} onChange={event => { if (!pending.current) setVolume(Number(event.target.value)); }} onPointerDown={event => { if (pending.current) event.preventDefault(); }} onPointerUp={() => void updateAudio({ volume })} onKeyDown={event => { if (pending.current && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) event.preventDefault(); }} onKeyUp={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) void updateAudio({ volume }); }} onBlur={() => { if (volume !== audio.volume) void updateAudio({ volume }); }} /></label>
    </div> : <p className="guide-note" role="status">{audioReason(audio.reason)}</p>}
  </>;
  return <div ref={root} className={`guide-overlay${preferences.compact?' guide-compact':''}${preferences.largerText?' guide-larger-text':''}${preferences.reducedMotion?' guide-reduced-motion':''}${preferences.theme==='light'||preferences.theme==='system'&&systemLight?' guide-light':''}`} data-gamepad-sections role="dialog" aria-modal="true" aria-label="xboks Game Bar" aria-busy={busy || undefined} onMouseDown={event => { if (event.target === event.currentTarget) handleGuideBack(root.current, close); }} onKeyDown={event => {
    if (event.key === 'Escape' && !event.defaultPrevented) { if (handleGuideBack(root.current, close)) { event.preventDefault(); event.stopPropagation(); } }
    if (event.key === 'Tab' && !event.defaultPrevented) {
      const scope=[...document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')].filter(visible).at(-1)??root.current;
      const nodes = Array.from(scope?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled)') ?? []).filter(visible);
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }}>
    <div className="guide-tabs" role="tablist" aria-label={t('Game Bar sections', 'Καρτέλες Game Bar')}>
      {toolbarStart>0?<button className="guide-toolbar-page" aria-label={t('Previous widgets','Προηγούμενα γραφικά στοιχεία')} onClick={()=>setToolbarStart(Math.max(0,toolbarStart-6))}><ChevronLeft/></button>:null}
      {displayedWidgets.map(({id,label,greek,icon:Icon})=><button key={id} role="tab" id={`guide-tab-${id}`} data-gamepad-initial={tab===id?'':undefined} aria-label={t(label,greek)} title={t(label,greek)} aria-selected={tab===id} aria-controls="guide-panel" onClick={()=>chooseTab(id)} onKeyDown={event=>{
        if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();event.stopPropagation();const ids=activeWidgets.map(item=>item.id),index=ids.indexOf(id);const next=event.key==='Home'?ids[0]:event.key==='End'?ids.at(-1)!:ids[(index+(event.key==='ArrowRight'?1:-1)+ids.length)%ids.length];chooseTab(next);requestAnimationFrame(()=>root.current?.querySelector<HTMLElement>(`#guide-tab-${next}`)?.focus());
      }}><Icon/></button>)}
      {toolbarStart+6<activeWidgets.length?<button className="guide-toolbar-page" aria-label={t('More widgets','Περισσότερα γραφικά στοιχεία')} onClick={()=>setToolbarStart(toolbarStart+6)}><ChevronRight/></button>:null}
      <button role="tab" id="guide-tab-widgets" data-gamepad-initial={tab==='widgets'?'':undefined} aria-label={t('Widgets','Γραφικά στοιχεία')} title={t('Widgets','Γραφικά στοιχεία')} aria-selected={tab==='widgets'} onClick={()=>chooseTab('widgets')}><GuideWidgetsIcon/></button>
    </div>
    <div className="guide-system"><time>{formatShellClock(now,locale.language)}</time><button data-gamepad-cancel aria-label={t('Close Game Bar', 'Κλείσιμο Game Bar')} onClick={close}><X /></button></div>
    <section className={`guide-panel guide-panel-${tab}${settingsWide?' guide-panel-wide-settings':''}`} id="guide-panel" role="tabpanel" aria-label={tab==='widgets'?t('Widgets','Γραφικά στοιχεία'):t(guideWidgetDefinition(tab).label,guideWidgetDefinition(tab).greek)} tabIndex={-1}>
      <div className="guide-panel-heading"><h2>{tab==='widgets'?t('Widgets','Γραφικά στοιχεία'):tabs.filter(item=>item.id===tab).map(item=>t(item.label,item.greek))}</h2>{['performance','spotify','gallery'].includes(tab)?<button className="guide-widget-pin" aria-label={t('Keep open in Game Bar','Διατήρηση ανοικτού στο Game Bar')} aria-pressed={preferences.pinned.includes(tab as GuideWidgetId)} onClick={()=>togglePreference('pinned',tab as GuideWidgetId)}><Pin/></button>:null}</div>
      <div className="guide-panel-scroll">
        {tab === 'home' ? <>
          {data.guideForeground ? <div className="guide-active-application"><h3>{t('Active application', 'Ενεργή εφαρμογή')}</h3><button data-guide-return-to-app aria-label={`${t('Return to', 'Επιστροφή σε')} ${data.guideForeground.name}`} onClick={close}><AppWindow/><span><strong>{data.guideForeground.name}</strong>{data.guideForeground.title && data.guideForeground.title !== data.guideForeground.name ? <small>{data.guideForeground.title}</small> : null}</span><ChevronRight/></button></div> : null}
          <div className="guide-action-pair"><button onClick={() => navigate('home')}><Home />{t('Home', 'Αρχική οθόνη')}</button><button onClick={() => navigate('library')}><Library />{t('Library', 'Βιβλιοθήκη')}</button></div>
          <h3>{t('Recently played games', 'Πρόσφατα παιχνίδια')}</h3>
          <div className="guide-recent-list">{recentGames.map(game => <button key={game.id} onClick={() => { close(); openGame(game.id); }}>{game.coverUrl || game.coverDataUrl ? <img src={game.coverUrl ?? game.coverDataUrl} alt="" /> : <Gamepad2 />}<span><strong>{game.title}</strong><small>{game.installState === 'ready' ? t('Installed', 'Εγκατεστημένο') : t('View game', 'Προβολή παιχνιδιού')}</small></span><ChevronRight /></button>)}</div>
          {!recentGames.length ? <p className="guide-muted">{t('No recently played games for this account.', 'Δεν υπάρχουν πρόσφατα παιχνίδια για αυτόν τον λογαριασμό.')}</p> : null}
          <hr /><button className="guide-row" onClick={() => navigate('downloads')}><Download />{t('Install queue', 'Ουρά εγκατάστασης')}<ChevronRight /></button>
        </> : null}
        {tab === 'settings' && settingsOpen ? <GuideSettingsPanel data={data} preferences={preferences} change={changePreferences} wide={setSettingsWide} close={()=>{setSettingsOpen(false);requestAnimationFrame(()=>root.current?.querySelector<HTMLElement>('[data-guide-more-settings]')?.focus());}} accountSettings={()=>navigate('settings')} />:null}
        {tab === 'settings' && !settingsOpen ? <><button className="guide-wide" onClick={()=>chooseTab('audio')}><Mic/>{t('Local microphone test','Τοπική δοκιμή μικροφώνου')}</button>{audioControls}<button className="guide-wide" disabled title={t('The desktop on-screen keyboard is not connected to this version.','Το πληκτρολόγιο οθόνης της επιφάνειας εργασίας δεν έχει συνδεθεί σε αυτήν την έκδοση.')}><Keyboard/>{t('Show keyboard','Εμφάνιση πληκτρολογίου')}</button><button className="guide-wide" data-guide-fullscreen disabled={busy || (!desktopGuide && !canFullscreen)} onClick={() => { if (desktopGuide && !canFullscreen) { navigate('settings'); return; } void changeFullscreen(); }}>{desktopGuide && !canFullscreen ? <Cog /> : <Maximize />}{windowFullscreen ? t('Return to desktop', 'Επιστροφή στην επιφάνεια εργασίας') : desktopGuide ? t('Open app settings', 'Άνοιγμα ρυθμίσεων εφαρμογής') : nativeFullscreenBridge?.setWindowFullscreen ? t('Xbox mode', 'Λειτουργία Xbox') : t('Enter window fullscreen', 'Πλήρης οθόνη παραθύρου')}</button>{!desktopGuide && !nativeFullscreenBridge?.setWindowFullscreen ? <p className="guide-muted">{t('Changes the app window only. Fullscreen Experience is managed by the gaming session.', 'Αλλάζει μόνο το παράθυρο της εφαρμογής. Το Fullscreen Experience ελέγχεται από τη συνεδρία παιχνιδιών.')}</p> : null}<div className="guide-setting-option"><label><span>{t('Compact mode','Περιεκτική λειτουργία')}</span><input type="checkbox" role="switch" checked={preferences.compact} onChange={event=>changePreferences({compact:event.target.checked})}/></label></div><hr /><button className="guide-row" data-guide-more-settings onClick={() => setSettingsOpen(true)}><Cog />{t('More settings', 'Περισσότερες ρυθμίσεις')}<ChevronRight /></button><GuideSystemControls /><div className="guide-setting-option"><label><Plane/><span>{t('Airplane mode','Λειτουργία πτήσης')}</span><input type="checkbox" role="switch" disabled checked={false} readOnly/></label><p className="guide-muted">{t('Manage airplane mode in desktop network settings.','Διαχειριστείτε τη λειτουργία πτήσης στις ρυθμίσεις δικτύου της επιφάνειας εργασίας.')}</p></div><div className="guide-setting-option"><label><MousePointer2/><span>{t('Controller mouse cursor','Δρομέας χειριστηρίου παιχνιδιών')}</span><input type="checkbox" role="switch" disabled checked={false} readOnly/></label><p className="guide-muted">{t('Desktop pointer control from the controller is not available.','Ο έλεγχος δείκτη της επιφάνειας εργασίας με χειριστήριο δεν είναι διαθέσιμος.')}</p></div></> : null}
        {tab === 'audio' ? <>{audioControls}<hr/><GuideMixerWidget/><hr/><LocalVoiceTest/></> : null}
        {tab === 'capture' ? <><div className="guide-capture-tools"><button className="guide-wide guide-capture" disabled={busy || !canCapture} aria-label={t('Take screenshot','Λήψη στιγμιότυπου')} title={t('Take screenshot','Λήψη στιγμιότυπου')} onClick={()=>void capture()}><Images/><span className="guide-sr-only">{busy?t('Saving…','Αποθήκευση…'):t('Take screenshot','Λήψη στιγμιότυπου')}</span></button><button disabled aria-label={t('Record last 30 seconds','Εγγραφή τελευταίων 30 δευτερολέπτων')} title={t('Background video recording is not available.','Η εγγραφή βίντεο παρασκηνίου δεν είναι διαθέσιμη.')}><History/></button><button disabled aria-label={t('Start recording','Έναρξη εγγραφής')} title={t('Video recording is not available.','Η εγγραφή βίντεο δεν είναι διαθέσιμη.')}><Circle fill="currentColor"/></button><button disabled aria-label={t('Recording microphone','Μικρόφωνο εγγραφής')} title={t('Video microphone recording is not available. Use the local test in Audio.','Το μικρόφωνο εγγραφής βίντεο δεν είναι διαθέσιμο. Χρησιμοποιήστε την τοπική δοκιμή στον Ήχο.')}><MicOff/></button></div><p className="guide-muted">{t('Captures the xboks window without this overlay. Saved as PNG in Pictures/xboks.', 'Καταγράφει το παράθυρο xboks χωρίς αυτήν την επικάλυψη. Αποθηκεύεται ως PNG στον φάκελο Εικόνες/xboks.')}</p>{capturePath?<button className="guide-wide" disabled={typeof window.launcher?.openPath!=='function'} onClick={()=>void window.launcher.openPath(capturePath).catch(()=>setMessage(t('The screenshot could not be opened.','Δεν ήταν δυνατό το άνοιγμα του στιγμιότυπου.')))}>{t('Open screenshot','Άνοιγμα στιγμιότυπου')}<ExternalLink/></button>:null}<hr/><button className="guide-row" onClick={()=>chooseTab('gallery')}><Images/>{t('Show all captures','Εμφάνιση των καταγραφών μου')}<ChevronRight/></button><p className="guide-note">{t('Game video recording and capture outside xboks are not connected yet.', 'Η εγγραφή βίντεο παιχνιδιών και η καταγραφή εκτός xboks δεν έχουν συνδεθεί ακόμη.')}</p></> : null}
        {tab==='widgets'?<GuideWidgetDirectory preferences={preferences} toggle={togglePreference} open={chooseTab}/>:null}
        {tab==='performance'?<GuidePerformanceWidget/>:null}
        {tab==='spotify'?<GuideSpotifyWidget/>:null}
        {tab==='gallery'?<GuideGalleryWidget/>:null}
        {tab === 'social' ? <XboxSocialPanel auth={data.auth} variant="guide" accountSettings={() => navigate('settings')} /> : null}
        {tab === 'browser' ? <><form className="guide-web-search" onSubmit={event => { event.preventDefault(); const text = query.trim(); if (text) window.open(`https://www.bing.com/search?q=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer'); }}><Search /><input aria-label={t('Search the web', 'Αναζήτηση στο Web')} placeholder={t('Search the web', 'Αναζήτηση στο Web')} value={query} onChange={event => setQuery(event.target.value)} /><button type="submit" disabled={!query.trim()} aria-label={t('Open search in browser', 'Άνοιγμα αναζήτησης στο πρόγραμμα περιήγησης')}><ChevronRight /></button></form><p className="guide-muted">{t('Search opens in your default browser. An embedded browser widget is not available yet.', 'Η αναζήτηση ανοίγει στο προεπιλεγμένο πρόγραμμα περιήγησης. Δεν υπάρχει ακόμη ενσωματωμένο γραφικό στοιχείο περιήγησης.')}</p><a className="guide-wide" href="https://www.xbox.com/play" target="_blank" rel="noreferrer">{t('Xbox on the web', 'Xbox στο Web')}<ExternalLink /></a></> : null}
        {message ? <p className="guide-message" role="status">{message}</p> : null}
      </div>
    </section>
    <div className="guide-pinned-widgets">{preferences.pinned.filter(id=>id!==tab&&!preferences.hidden.includes(id)).map(id=><section key={id} className={`guide-pinned-widget guide-pinned-${id}`} style={{opacity:preferences.opacity/100}} aria-label={`${t('Pinned widget','Καρφιτσωμένο στοιχείο')}: ${t(guideWidgetDefinition(id).label,guideWidgetDefinition(id).greek)}`}><div className="guide-panel-heading"><h2>{t(guideWidgetDefinition(id).label,guideWidgetDefinition(id).greek)}</h2><button aria-label={`${t('Unpin','Ξεκαρφίτσωμα')}: ${t(guideWidgetDefinition(id).label,guideWidgetDefinition(id).greek)}`} onClick={()=>togglePreference('pinned',id)}><Pin/></button></div><div className="guide-pinned-scroll">{id==='performance'?<GuidePerformanceWidget/>:id==='spotify'?<GuideSpotifyWidget/>:id==='gallery'?<GuideGalleryWidget/>:null}</div></section>)}</div>
    {preferences.showHints?<div className="guide-hints">{t('A Select · B Back · LB / RB Sections · Win + G when configured', 'A Επιλογή · B Πίσω · LB / RB Καρτέλες · Win + G εφόσον ρυθμιστεί')}</div>:null}
  </div>;
}
