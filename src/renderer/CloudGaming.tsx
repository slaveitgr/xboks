import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {ArrowLeft, Gamepad2, Home, RefreshCw, X} from './XboxIcons';
import {CLOUD_GAMING_TOOLBAR_HEIGHT, type CloudGamingCommand, type CloudGamingState} from '../shared/cloud-gaming';
import {useBackHandler} from './GamepadNavigation';
import {useReferenceLocale} from './ReferenceLocale';
import './cloud-gaming.css';

export interface CloudGamingBridge {
  openCloudGaming(): Promise<void>;
  getCloudGamingState(): Promise<CloudGamingState>;
  onCloudGamingState(callback: (state: CloudGamingState) => void): () => void;
  controlCloudGaming(command: CloudGamingCommand): Promise<CloudGamingState>;
}
const closed: CloudGamingState = {open: false, phase: 'closed', canGoBack: false};
const browserLayout = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** This landing page performs no network/account action until Open is chosen. */
export function CloudGamingPage({open}: {open?: () => Promise<void>}) {
  const {text: t} = useReferenceLocale();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const pending = useRef(false), mounted = useRef(false);
  useEffect(() => {mounted.current = true; return () => {mounted.current = false;};}, []);
  const start = open ?? (typeof window === 'undefined' ? undefined : (window.launcher as Partial<CloudGamingBridge>)?.openCloudGaming);
  async function launch() {
    if (pending.current || !start) return;
    pending.current = true; setBusy(true); setError('');
    try {await start();}
    catch {if (mounted.current) setError(t('Cloud gaming could not open. Try again.', 'Το Cloud gaming δεν άνοιξε. Δοκιμάστε ξανά.'));}
    finally {pending.current = false; if (mounted.current) setBusy(false);}
  }
  return <main className="cloud-gaming-page">
    <section className="cloud-gaming-intro"><Gamepad2 size={48}/><p className="cloud-gaming-eyebrow">XBOX CLOUD GAMING</p>
      <h1>{t('Your games, from the cloud', 'Τα παιχνίδια σας, από το cloud')}</h1>
      <p>{t('Browse and play through the official Xbox Cloud Gaming website inside xboks. Choose a game and start it on Xbox’s page.', 'Περιηγηθείτε και παίξτε από την επίσημη ιστοσελίδα Xbox Cloud Gaming μέσα στο xboks. Επιλέξτε και ξεκινήστε ένα παιχνίδι στη σελίδα Xbox.')}</p>
      <button className="primary" disabled={busy || !start} data-gamepad-initial onClick={() => void launch()}><Gamepad2/>{busy ? t('Opening…', 'Άνοιγμα…') : t('Open Xbox Cloud Gaming', 'Άνοιγμα Xbox Cloud Gaming')}</button>
      {error ? <p role="alert">{error}</p> : null}
      {!start ? <p role="status">{t('Cloud gaming requires the desktop xboks application.', 'Το Cloud gaming απαιτεί την εφαρμογή xboks για υπολογιστή.')}</p> : null}
    </section>
    <section className="cloud-gaming-details" aria-label={t('Before you play', 'Πριν παίξετε')}>
      <div><h2>{t('Sign in on Xbox', 'Συνδεθείτε στο Xbox')}</h2><p>{t('Your Microsoft sign-in here is separate from the launcher account. Sign in only on Microsoft’s page when you choose to; xboks does not fill in your credentials.', 'Η σύνδεση Microsoft εδώ είναι ξεχωριστή από τον λογαριασμό της εφαρμογής. Συνδεθείτε στη σελίδα Microsoft μόνο όταν το επιλέξετε· το xboks δεν συμπληρώνει τα στοιχεία σας.')}</p></div>
      <div><h2>{t('What you need', 'Τι χρειάζεστε')}</h2><p>{t('Availability depends on your region, account and game. A compatible controller and fast internet are recommended. Eligible games may require a supported Game Pass plan or ownership.', 'Η διαθεσιμότητα εξαρτάται από την περιοχή, τον λογαριασμό και το παιχνίδι. Προτείνονται συμβατό χειριστήριο και γρήγορο internet. Ορισμένα παιχνίδια απαιτούν υποστηριζόμενο πρόγραμμα Game Pass ή αγορά.')}</p></div>
      <div><h2>{t('Browser compatibility', 'Συμβατότητα προγράμματος περιήγησης')}</h2><p>{t('Microsoft lists Edge, Chrome and Safari. This embedded Linux browser is not an officially supported Xbox browser; compatibility can vary.', 'Η Microsoft αναφέρει Edge, Chrome και Safari. Αυτό το ενσωματωμένο πρόγραμμα περιήγησης Linux δεν είναι επίσημα υποστηριζόμενο πρόγραμμα Xbox· η συμβατότητα μπορεί να διαφέρει.')}</p></div>
    </section>
  </main>;
}

/** Subscribe before reading so a delayed initial read never replaces an event. */
export function observeCloudGaming(bridge: Partial<CloudGamingBridge> | undefined, changed: (state: CloudGamingState) => void) {
  let active = true, revision = 0;
  const update = (state: CloudGamingState) => {if (active) {revision++; changed(state);}};
  const unsubscribe = bridge?.onCloudGamingState?.(update), before = revision;
  if (bridge?.getCloudGamingState) void bridge.getCloudGamingState().then(state => {if (active && revision === before) changed(state);}).catch(() => {});
  return () => {active = false; unsubscribe?.();};
}
export function cloudGamingStatusLabel(state: CloudGamingState, language: 'en' | 'el') {
  const t = (en: string, el: string) => language === 'el' ? el : en;
  if (state.phase === 'loading') return t('Loading the official Xbox website…', 'Φόρτωση της επίσημης ιστοσελίδας Xbox…');
  if (state.phase === 'error') return t('Cloud gaming needs attention', 'Το Cloud gaming χρειάζεται προσοχή');
  if (state.blockedNavigation) return t('That link is outside Xbox and Microsoft sign-in.', 'Αυτός ο σύνδεσμος είναι εκτός Xbox και σύνδεσης Microsoft.');
  return state.origin && !['https://www.xbox.com', 'https://xbox.com'].includes(state.origin)
    ? t('Microsoft sign-in · separate from your launcher account', 'Σύνδεση Microsoft · ξεχωριστή από τον λογαριασμό της εφαρμογής')
    : t('Choose a game on Xbox · Ctrl + F6 returns to these controls', 'Επιλέξτε παιχνίδι στο Xbox · Ctrl + F6 για επιστροφή στα στοιχεία ελέγχου');
}

export function CloudGamingSurface({state, busy = false, error = '', command, canControl = true}: {
  state: CloudGamingState; busy?: boolean; error?: string; command: (command: CloudGamingCommand) => void; canControl?: boolean;
}) {
  const {text: t, language} = useReferenceLocale();
  if (!state.open) return null;
  const back = state.canGoBack ? 'back' : 'close';
  return <>
    <header className="cloud-gaming-toolbar"><button data-cloud-gaming-back data-gamepad-cancel disabled={busy} aria-label={state.canGoBack ? t('Back in Cloud gaming', 'Πίσω στο Cloud gaming') : t('Return to xboks', 'Επιστροφή στο xboks')} onClick={() => command(back)}><ArrowLeft/></button>
      <div><h1>Xbox Cloud Gaming <span>{state.origin ?? 'https://www.xbox.com'}</span></h1><p role={error ? 'alert' : 'status'}>{error || cloudGamingStatusLabel(state, language)}</p></div>
      <button disabled={busy || !canControl} aria-label={t('Cloud gaming home', 'Αρχική Cloud gaming')} onClick={() => command('home')}><Home/></button>
      <button disabled={busy || !canControl} aria-label={t('Reload Cloud gaming', 'Επαναφόρτωση Cloud gaming')} onClick={() => command('retry')}><RefreshCw/></button>
      <button disabled={busy} aria-label={t('Close Cloud gaming', 'Κλείσιμο Cloud gaming')} onClick={() => command('close')}><X/></button>
    </header>
    {state.phase === 'loading' ? <div className="cloud-gaming-state" role="status"><div className="cloud-gaming-loading"/><h2>{t('Opening Xbox Cloud Gaming', 'Άνοιγμα Xbox Cloud Gaming')}</h2><p>{t('Sign in on Microsoft’s page if asked, then choose a game. Your launcher sign-in is separate.', 'Συνδεθείτε στη σελίδα Microsoft αν ζητηθεί και επιλέξτε παιχνίδι. Η σύνδεση της εφαρμογής είναι ξεχωριστή.')}</p></div> : null}
    {state.phase === 'error' ? <div className="cloud-gaming-state"><h2>{t('Cloud gaming could not load', 'Το Cloud gaming δεν φορτώθηκε')}</h2><p role="alert">{error || (state.error === 'crashed' ? t('The Xbox page stopped. Reload it to try again.', 'Η σελίδα Xbox σταμάτησε. Επαναφορτώστε τη για να δοκιμάσετε ξανά.') : t('Check your connection and try again. Browser compatibility or region restrictions may also apply.', 'Ελέγξτε τη σύνδεσή σας και δοκιμάστε ξανά. Ενδέχεται να ισχύουν περιορισμοί συμβατότητας ή περιοχής.'))}</p><div><button disabled={busy || !canControl} onClick={() => command('retry')}><RefreshCw/>{t('Try again', 'Δοκιμή ξανά')}</button><button disabled={busy} onClick={() => command('close')}>{t('Return to xboks', 'Επιστροφή στο xboks')}</button></div></div> : null}
  </>;
}

export function CloudGamingHost({bridge = typeof window === 'undefined' ? undefined : window.launcher as Partial<CloudGamingBridge>}: {bridge?: Partial<CloudGamingBridge>}) {
  const {text: t} = useReferenceLocale();
  const [state, setState] = useState<CloudGamingState>(closed), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const root = useRef<HTMLDivElement>(null), pending = useRef(false), mounted = useRef(false), events = useRef(0), previous = useRef<HTMLElement | null>(null);
  useEffect(() => {
    mounted.current = true;
    const stop = observeCloudGaming(bridge, value => {events.current++; setState(value); if (!value.open) setError('');});
    return () => {mounted.current = false; stop();};
  }, [bridge]);
  browserLayout(() => {
    if (!state.open) return;
    previous.current = document.activeElement as HTMLElement | null; root.current?.querySelector<HTMLElement>('[data-cloud-gaming-back]')?.focus();
    return () => {if (previous.current?.isConnected) previous.current.focus({preventScroll: true});};
  }, [state.open]);
  async function command(value: CloudGamingCommand) {
    if (pending.current || !bridge?.controlCloudGaming) return;
    pending.current = true; const before = events.current; setBusy(true); setError('');
    try {const result = await bridge.controlCloudGaming(value); if (mounted.current && events.current === before) setState(result);}
    catch {if (mounted.current && events.current === before) setError(t('The Cloud gaming action failed. Try again.', 'Η ενέργεια Cloud gaming απέτυχε. Δοκιμάστε ξανά.'));}
    finally {pending.current = false; if (mounted.current) setBusy(false);}
  }
  useBackHandler(() => {void command(state.canGoBack ? 'back' : 'close'); return true;}, state.open, () => root.current);
  if (!state.open) return null;
  return <div className="cloud-gaming-host" ref={root} role="dialog" aria-modal="true" aria-label="Xbox Cloud Gaming" data-cloud-gaming-phase={state.phase} style={{'--cloud-gaming-toolbar-height': `${CLOUD_GAMING_TOOLBAR_HEIGHT}px`} as React.CSSProperties} onKeyDown={event => {
    if (event.key === 'Escape') {event.preventDefault(); event.stopPropagation(); void command('close');}
    if (event.key === 'Tab') {
      const nodes = [...root.current!.querySelectorAll<HTMLElement>('button:not(:disabled)')].filter(node => node.getClientRects().length);
      if (event.shiftKey && document.activeElement === nodes[0]) {event.preventDefault(); nodes.at(-1)?.focus();}
      else if (!event.shiftKey && document.activeElement === nodes.at(-1)) {event.preventDefault(); nodes[0]?.focus();}
    }
  }}><CloudGamingSurface state={state} busy={busy} error={error} command={value => void command(value)} canControl={Boolean(bridge?.controlCloudGaming)}/></div>;
}
