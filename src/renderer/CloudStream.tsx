import {useEffect, useRef, useState} from 'react';
import type {CloudProduct, CloudStreamApi} from '../shared/cloud-library';
import type {CloudSessionState} from '../shared/cloud-stream';
import {Cloud, Gamepad2, Maximize, Play, Volume2, VolumeX, X} from './XboxIcons';
import {connectCloudPlayer, type CloudPlayerHandle} from './cloud-player';
import {useReferenceLocale} from './ReferenceLocale';
import {useBackHandler} from './GamepadNavigation';
import {claimStreamInput, releaseStreamInput, useStreamObscured} from './stream-input';
import {LoaderCircle} from 'lucide-react';
import './cloud-stream.css';

type Bridge = Partial<CloudStreamApi> & {setWindowFullscreen?: (enabled: boolean) => Promise<unknown>};
const closed: CloudSessionState = {phase: 'closed'};
export function observeCloudSession(bridge: Bridge | undefined, changed: (state: CloudSessionState) => void) {
  let active = true, revision = 0;
  const dispose = bridge?.onCloudStreamState?.(value => {if (active) {revision++; changed(value);}}), before = revision;
  void bridge?.getCloudStreamState?.().then(value => {if (active && before === revision) changed(value);}).catch(() => {});
  return () => {active = false; dispose?.();};
}
export function CloudStreamHost({bridge = typeof window === 'undefined' ? undefined : window.launcher}: {bridge?: Bridge}) {
  const {text: t} = useReferenceLocale();
  const [state, setState] = useState(closed), [connection, setConnection] = useState('connecting'), [video, setVideo] = useState(false);
  const [menu, setMenu] = useState(false), [muted, setMuted] = useState(false), [product, setProduct] = useState<CloudProduct>();
  const [message, setMessage] = useState<Parameters<Parameters<typeof connectCloudPlayer>[0]['message']>[0]>();
  const root = useRef<HTMLDivElement>(null), player = useRef<CloudPlayerHandle>(), stopping = useRef(false), previous = useRef<HTMLElement | null>(null);
  const stateRef = useRef(state), revision = useRef(0); stateRef.current = state;
  const inputOwner = useRef(Symbol('cloud-stream'));
  const obscured = useStreamObscured(state.phase !== 'closed');
  const showControlsRef = useRef(true);
  useEffect(() => observeCloudSession(bridge, value => {revision.current++; stateRef.current = value; setState(value);}), [bridge]);
  useEffect(() => {
    if (!state.productId || !bridge?.getCloudProducts) {setProduct(undefined); return;}
    let current = true; void bridge.getCloudProducts([state.productId]).then(products => {if (current) setProduct(products.find(product => product.productId === state.productId));}).catch(() => {});
    return () => {current = false;};
  }, [state.productId, bridge]);
  useEffect(() => {
    if (state.phase === 'closed') return;
    previous.current = document.activeElement as HTMLElement | null;
    return () => {if (previous.current?.isConnected) previous.current.focus({preventScroll: true});};
  }, [state.phase === 'closed']);
  useEffect(() => {
    if (!state.id || !['starting','queued','provisioning'].includes(state.phase) || !bridge?.getCloudStreamState) return;
    let cancelled = false; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {const before = revision.current; try {const next = await bridge.getCloudStreamState!(state.id); if (!cancelled && before === revision.current && stateRef.current.id === state.id) {stateRef.current = next; setState(next); if (['starting','queued','provisioning'].includes(next.phase)) timer = setTimeout(poll, 2000);}} catch {if (!cancelled && before === revision.current) setConnection('error');}};
    timer = setTimeout(poll, 1000); return () => {cancelled = true; clearTimeout(timer);};
  }, [state.id, state.phase, bridge]);
  useEffect(() => {
    if (state.phase !== 'ready' || !state.id || !bridge?.exchangeCloudSdp || !bridge.exchangeCloudIce) return;
    const controller = new AbortController(); setConnection('connecting'); setVideo(false); setMenu(false); setMuted(false);
    const container = document.getElementById('xboks-cloud-video');
    const played = () => setVideo(true);
    const observer = new MutationObserver(() => {container?.querySelector('video')?.addEventListener('playing', played, {once: true});});
    if (container) observer.observe(container, {childList: true, subtree: true});
    void connectCloudPlayer({container: 'xboks-cloud-video', id: state.id, bridge: bridge as CloudStreamApi, signal: controller.signal,
      changed: value => {if (!controller.signal.aborted) setConnection(value);}, message: value => {if (!controller.signal.aborted) setMessage(value);}}).then(handle => {if (!controller.signal.aborted) {player.current = handle; handle.pause(showControlsRef.current);} else handle.close();}).catch(() => {});
    return () => {controller.abort(); observer.disconnect(); container?.querySelector('video')?.removeEventListener('playing', played); player.current?.close(); player.current = undefined; setMessage(undefined);};
  }, [state.id, state.phase === 'ready', bridge]);
  const showControls = menu || Boolean(message) || !video || connection !== 'connected';
  showControlsRef.current = showControls || obscured;
  useEffect(() => {
    const active = state.phase !== 'closed' && !obscured, owner = inputOwner.current;
    if (active) claimStreamInput(document, owner, showControls ? 'menu' : 'active');
    else releaseStreamInput(document, owner);
    player.current?.pause(showControls || obscured);
    if (active && showControls) root.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
    return () => releaseStreamInput(document, owner);
  }, [state.phase, showControls, obscured]);
  useEffect(() => {
    if (state.phase === 'closed' || obscured) return;
    const key = (event: KeyboardEvent) => {if (event.key === 'Escape') {event.preventDefault(); event.stopImmediatePropagation(); setMenu(value => !value);}};
    window.addEventListener('keydown', key, true); return () => window.removeEventListener('keydown', key, true);
  }, [state.phase, obscured]);
  async function stop() {
    if (!bridge?.stopCloudStream || stopping.current) return;
    const before = revision.current, id = state.id;
    stopping.current = true; player.current?.pause(true);
    try {await bridge.stopCloudStream(id); if (before === revision.current && stateRef.current.id === id) setState(closed);} catch {if (stateRef.current.id === id) setConnection('error');}
    finally {stopping.current = false;}
  }
  useBackHandler(() => {
    if (message) return true;
    if (menu) setMenu(false);
    else if (video) setMenu(true);
    else void stop();
    return true;
  }, state.phase !== 'closed' && !obscured, () => root.current);
  if (state.phase === 'closed') return null;
  const failure = state.phase === 'error' || ['disconnected','error'].includes(connection);
  const phase = state.phase === 'queued' ? t('Waiting for your turn', 'Αναμονή για τη σειρά σας') : state.phase === 'starting' || state.phase === 'provisioning' ? t('Preparing your cloud game', 'Προετοιμασία παιχνιδιού cloud') : t('Connecting to your game', 'Σύνδεση με το παιχνίδι');
  return <div className={`cloud-stream-host${obscured ? ' stream-obscured' : ''}`} ref={root} role="dialog" aria-modal="true" aria-hidden={obscured || undefined} aria-label={t('Cloud game session', 'Συνεδρία παιχνιδιού cloud')} data-cloud-session-phase={state.phase}>
    <div className="cloud-stream-video" id="xboks-cloud-video"/>
    {(!video || failure) && !message ? <section className="cloud-stream-loading" style={product?.heroUrl ? {backgroundImage: `linear-gradient(#0b1114bb,#0b1114ee),url(${JSON.stringify(product.heroUrl)})`} : undefined}>
      <Cloud size={45}/><h1>{product?.title ?? t('Xbox Cloud Gaming', 'Xbox Cloud Gaming')}</h1>{failure ? <><h2>{t('Your cloud game could not connect', 'Το παιχνίδι cloud δεν συνδέθηκε')}</h2><p>{state.error === 'region-not-supported' ? t('Xbox Cloud Gaming is not available in your current country.', 'Το Xbox Cloud Gaming δεν είναι διαθέσιμο στην τρέχουσα χώρα σας.') : state.error === 'transfer-token-required' ? t('This game requires an additional session transfer that is not supported yet.', 'Αυτό το παιχνίδι απαιτεί πρόσθετη μεταφορά συνεδρίας που δεν υποστηρίζεται ακόμη.') : state.error === 'signed-out' ? t('Sign in to XBOKS, then try again.', 'Συνδεθείτε στο XBOKS και δοκιμάστε ξανά.') : t('Check your connection, cloud availability and game access, then return to the catalog to try again.', 'Ελέγξτε τη σύνδεση, τη διαθεσιμότητα cloud και την πρόσβαση στο παιχνίδι. Επιστρέψτε στον κατάλογο για νέα προσπάθεια.')}</p></> : <><LoaderCircle className="spin"/><h2>{phase}</h2>{state.waitSeconds !== undefined ? <p>{t('Estimated wait', 'Εκτιμώμενη αναμονή')}: {Math.ceil(state.waitSeconds / 60)} {t('min', 'λεπτά')}</p> : null}<p>{t('Using your signed-in XBOKS account', 'Με τον συνδεδεμένο λογαριασμό XBOKS')}</p></>}
      <button data-gamepad-cancel onClick={() => void stop()}><X/>{t('Return to cloud games', 'Επιστροφή στα παιχνίδια cloud')}</button>
    </section> : null}
    <nav className={`cloud-stream-toolbar${showControls ? ' visible' : ''}`} aria-label={t('Cloud session controls', 'Στοιχεία ελέγχου συνεδρίας cloud')}>
      <button aria-label={t('Xbox guide', 'Οδηγός Xbox')} onClick={() => {setMenu(false); player.current?.pause(false); player.current?.guide();}} disabled={!video}><Gamepad2/></button><strong>{product?.title ?? 'Xbox Cloud Gaming'}</strong>
      {video ? <button onClick={() => {setMenu(false); player.current?.pause(false);}}><Play/>{t('Resume', 'Συνέχεια')}</button> : null}
      <button aria-label={muted ? t('Unmute stream', 'Ενεργοποίηση ήχου') : t('Mute stream', 'Σίγαση ήχου')} onClick={() => {player.current?.mute(!muted); setMuted(value => !value);}}>{muted ? <VolumeX/> : <Volume2/>}</button>
      <button aria-label={t('Fullscreen', 'Πλήρης οθόνη')} onClick={() => void bridge?.setWindowFullscreen?.(true)}><Maximize/></button>
      <button aria-label={t('End cloud session', 'Τέλος συνεδρίας cloud')} onClick={() => setMenu(value => !value)}><X/></button>
    </nav>
    {menu && video && !message ? <section className="cloud-stream-menu" role="dialog" aria-modal="true" aria-label={t('Cloud session menu', 'Μενού συνεδρίας cloud')}><h2>{t('Cloud session', 'Συνεδρία cloud')}</h2><p>{t('Return to your game or end this streaming session.', 'Συνεχίστε το παιχνίδι ή τερματίστε αυτή τη συνεδρία streaming.')}</p><button data-gamepad-initial data-gamepad-cancel onClick={() => setMenu(false)}><Play/>{t('Keep playing', 'Συνέχεια παιχνιδιού')}</button><button onClick={() => void stop()}><X/>{t('End session', 'Τερματισμός συνεδρίας')}</button></section> : null}
    {message ? <section className="cloud-stream-menu" role="dialog" aria-modal="true" aria-label={message.title}><h2>{message.title}</h2><p>{message.text}</p>{message.buttons.map((label, index) => label ? <button key={index} onClick={() => message.respond(index)}>{label}</button> : null)}</section> : null}
  </div>;
}
