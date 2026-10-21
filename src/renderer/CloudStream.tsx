import {useEffect, useRef, useState} from 'react';
import type {CloudProduct, CloudStreamApi} from '../shared/cloud-library';
import type {CloudSessionState} from '../shared/cloud-stream';
import type {DiagnosticLog} from '../shared/types';
import {Cloud, Gamepad2, Maximize, Play, Volume2, VolumeX, X} from './XboxIcons';
import {CLOUD_PLAYER_STAGES, CloudPlayerError, connectCloudPlayer, type CloudPlayerHandle, type CloudPlayerStage} from './cloud-player';
import {useReferenceLocale} from './ReferenceLocale';
import {useBackHandler} from './GamepadNavigation';
import {claimStreamInput, releaseStreamInput, useStreamObscured} from './stream-input';
import {LoaderCircle} from 'lucide-react';
import './cloud-stream.css';

type Bridge = Partial<CloudStreamApi> & {setWindowFullscreen?: (enabled: boolean) => Promise<unknown>; readBackendDiagnosticLog?: () => Promise<DiagnosticLog>};
const closed: CloudSessionState = {phase: 'closed'};
export interface CloudVideoStatus {
  connection: 'connecting' | 'connected' | 'disconnected' | 'error';
  stage?: CloudPlayerStage;
  failure?: {stage: CloudPlayerStage; code: CloudPlayerError['code']};
}
/** A session owns its callbacks and late player; replacing it resets diagnostics. */
export function ownCloudVideo(options: {
  id: string; bridge: Pick<CloudStreamApi, 'exchangeCloudSdp' | 'exchangeCloudIce'>;
  changed: (state: CloudVideoStatus) => void;
  message: Parameters<typeof connectCloudPlayer>[0]['message'];
  ready: (handle: CloudPlayerHandle) => void;
  connect?: typeof connectCloudPlayer;
}) {
  const controller = new AbortController(); let active = true, handle: CloudPlayerHandle | undefined;
  let status: CloudVideoStatus = {connection: 'connecting'};
  const publish = (patch: Partial<CloudVideoStatus>) => {if (active) {status = {...status, ...patch}; options.changed(status);}};
  options.changed(status);
  const pending = (options.connect ?? connectCloudPlayer)({container: 'xboks-cloud-video', id: options.id, bridge: options.bridge, signal: controller.signal,
    changed: connection => publish({connection}), diagnostic: stage => publish({stage}),
    message: value => {if (active) options.message(value);},
  }).then(created => {
    if (!active) {created.close(); return;} handle = created; options.ready(created);
  }).catch(error => {
    if (!active || controller.signal.aborted || error instanceof CloudPlayerError && error.code === 'cancelled') return;
    const stage = error instanceof CloudPlayerError && CLOUD_PLAYER_STAGES.includes(error.stage) ? error.stage : status.stage ?? 'load-player';
    publish({connection: 'error', failure: {stage, code: error instanceof CloudPlayerError && error.code === 'timeout' ? 'timeout' : 'failed'}});
  });
  return {pending, close() {if (!active) return; active = false; controller.abort(); handle?.close(); handle = undefined;}};
}
const serviceStages: NonNullable<CloudSessionState['errorStage']>[] = ['credential','transfer-credential','connect','login','catalog','recent','play','state','sdp-send','sdp-receive','ice-send','ice-receive','keepalive','stop'];
export function CloudFailureDetails({state, transport}: {state: CloudSessionState; transport: CloudVideoStatus}) {
  const {text: t} = useReferenceLocale();
  const renderer = transport.failure;
  const service = state.errorStage && serviceStages.includes(state.errorStage) ? state.errorStage : undefined;
  const status = Number.isInteger(state.httpStatus) && state.httpStatus! >= 100 && state.httpStatus! <= 599 ? state.httpStatus : undefined;
  if (!renderer && !service) return null;
  return <details className="cloud-stream-diagnostic"><summary>{t('Connection details', 'Λεπτομέρειες σύνδεσης')}</summary>
    {service ? <p>{t('Cloud service stage', 'Στάδιο υπηρεσίας cloud')}: <code>{service}</code>{status ? <> · HTTP {status}</> : null}</p> : null}
    {renderer ? <p>{t('Player stage', 'Στάδιο αναπαραγωγής')}: <code>{renderer.stage}</code> · <code>{renderer.code}</code></p> : null}
  </details>;
}
export function observeCloudSession(bridge: Bridge | undefined, changed: (state: CloudSessionState) => void) {
  let active = true, revision = 0;
  const dispose = bridge?.onCloudStreamState?.(value => {if (active) {revision++; changed(value);}}), before = revision;
  void bridge?.getCloudStreamState?.().then(value => {if (active && before === revision) changed(value);}).catch(() => {});
  return () => {active = false; dispose?.();};
}
export function CloudStreamHost({bridge = typeof window === 'undefined' ? undefined : window.launcher}: {bridge?: Bridge}) {
  const {text: t} = useReferenceLocale();
  const [state, setState] = useState(closed), [transport, setTransport] = useState<CloudVideoStatus>({connection: 'connecting'}), [video, setVideo] = useState(false);
  const connection = transport.connection;
  const [diagnosticLog, setDiagnosticLog] = useState<DiagnosticLog>(), [readingLog, setReadingLog] = useState(false), [logFailed, setLogFailed] = useState(false);
  const [menu, setMenu] = useState(false), [muted, setMuted] = useState(false), [product, setProduct] = useState<CloudProduct>();
  const [message, setMessage] = useState<Parameters<Parameters<typeof connectCloudPlayer>[0]['message']>[0]>();
  const root = useRef<HTMLDivElement>(null), player = useRef<CloudPlayerHandle>(), stopping = useRef<{id?: string}>(), previous = useRef<HTMLElement | null>(null);
  const stateRef = useRef(state), revision = useRef(0); stateRef.current = state;
  const inputOwner = useRef(Symbol('cloud-stream'));
  const obscured = useStreamObscured(state.phase !== 'closed');
  const showControlsRef = useRef(true);
  const preparing = ['starting','queued','provisioning'].includes(state.phase);
  const setConnection = (value: CloudVideoStatus['connection']) => setTransport(previous => ({...previous, connection: value}));
  useEffect(() => {setVideo(false); setMenu(false); setMuted(false); setMessage(undefined); setTransport({connection: 'connecting'}); setDiagnosticLog(undefined); setReadingLog(false); setLogFailed(false);}, [state.id, state.productId]);
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
    if (!state.id || !preparing || !bridge?.getCloudStreamState) return;
    const id = state.id;
    let cancelled = false; let timer: ReturnType<typeof setTimeout>;
    const ownsSession = () => !cancelled && stateRef.current.id === id;
    const poll = async () => {
      const before = revision.current; let failed = false;
      try {
        const next = await bridge.getCloudStreamState!(id);
        if (ownsSession() && before === revision.current && (next.id === id || next.phase === 'closed' && !next.id)) {stateRef.current = next; setState(next);}
      } catch {
        if (ownsSession() && before === revision.current) {failed = true; setConnection('error');}
      } finally {
        // Main publishes its state before the IPC reply. A newer push can make
        // that reply stale without ending this session's provisioning loop.
        if (!failed && ownsSession() && ['starting','queued','provisioning'].includes(stateRef.current.phase)) timer = setTimeout(poll, 2000);
      }
    };
    timer = setTimeout(poll, 1000); return () => {cancelled = true; clearTimeout(timer);};
  }, [state.id, preparing, bridge]);
  useEffect(() => {
    if (state.phase !== 'ready' || !state.id || !bridge?.exchangeCloudSdp || !bridge.exchangeCloudIce) return;
    setVideo(false); setMenu(false); setMuted(false);
    const container = document.getElementById('xboks-cloud-video');
    let active = true; const watched = new Set<HTMLVideoElement>();
    const played = (event: Event) => {if (active && container?.contains(event.currentTarget as Node)) setVideo(true);};
    const watch = () => {for (const video of container?.querySelectorAll('video') ?? []) if (!watched.has(video)) {watched.add(video); video.addEventListener('playing', played, {once: true});}};
    const observer = new MutationObserver(watch); watch();
    if (container) observer.observe(container, {childList: true, subtree: true});
    const owned = ownCloudVideo({id: state.id, bridge: bridge as CloudStreamApi, changed: setTransport, message: setMessage,
      ready: handle => {player.current = handle; handle.pause(showControlsRef.current);}});
    return () => {active = false; owned.close(); observer.disconnect(); watched.forEach(video => video.removeEventListener('playing', played)); watched.clear(); player.current = undefined; setMessage(undefined);};
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
    if (!bridge?.stopCloudStream || stopping.current && stopping.current.id === state.id) return;
    const before = revision.current, request = {id: state.id};
    stopping.current = request; player.current?.pause(true);
    try {await bridge.stopCloudStream(request.id); if (before === revision.current && stateRef.current.id === request.id) {stateRef.current = closed; setState(closed);}} catch {if (before === revision.current && stateRef.current.id === request.id) setConnection('error');}
    finally {if (stopping.current === request) stopping.current = undefined;}
  }
  async function readDiagnostics() {
    if (!bridge?.readBackendDiagnosticLog || readingLog) return;
    const before = revision.current; setReadingLog(true); setLogFailed(false);
    try {const log = await bridge.readBackendDiagnosticLog(); if (before === revision.current) setDiagnosticLog(log);}
    catch {if (before === revision.current) setLogFailed(true);}
    finally {if (before === revision.current) setReadingLog(false);}
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
      {failure ? <><CloudFailureDetails state={state} transport={transport}/>
        {bridge?.readBackendDiagnosticLog ? <button onClick={() => void readDiagnostics()} disabled={readingLog}>{t('Read diagnostic log', 'Ανάγνωση διαγνωστικού αρχείου')}</button> : null}
        {logFailed ? <p role="alert">{t('The diagnostic log could not be read.', 'Δεν ήταν δυνατή η ανάγνωση του διαγνωστικού αρχείου.')}</p> : null}
        {diagnosticLog ? <details className="cloud-stream-diagnostic" open><summary>{t('Diagnostic log', 'Διαγνωστικό αρχείο')}</summary><pre>{diagnosticLog.content}</pre></details> : null}
      </> : null}
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
