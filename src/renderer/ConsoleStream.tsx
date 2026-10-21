import {useEffect, useRef, useState} from 'react';
import type {ConsoleStreamApi, ConsoleStreamDevice, ConsoleStreamState} from '../shared/console-stream';
import {Gamepad2, Maximize, MonitorPlay, Play, Volume2, VolumeX, X} from './XboxIcons';
import {LoaderCircle} from 'lucide-react';
import {connectCloudPlayer, type CloudPlayerHandle} from './cloud-player';
import {useBackHandler} from './GamepadNavigation';
import {useReferenceLocale} from './ReferenceLocale';
import {claimStreamInput, releaseStreamInput, useStreamObscured} from './stream-input';
import './cloud-stream.css';
import './console-library.css';

type Bridge = Partial<ConsoleStreamApi> & {setWindowFullscreen?: (enabled: boolean) => Promise<unknown>};
const closed: ConsoleStreamState = {phase: 'closed'};
/** Subscribe before reading so a late initial snapshot cannot replace a push. */
export function observeConsoleSession(bridge: Bridge | undefined, changed: (state: ConsoleStreamState) => void) {
  let active = true, revision = 0;
  const remove = bridge?.onConsoleStreamState?.(state => {if (active) {revision++; changed(state);}}), before = revision;
  void bridge?.getConsoleStreamState?.().then(state => {if (active && before === revision) changed(state);}).catch(() => {});
  return () => {active = false; remove?.();};
}
export function ConsoleStreamHost({bridge = typeof window === 'undefined' ? undefined : window.launcher as Bridge}: {bridge?: Bridge}) {
  const {text: t} = useReferenceLocale();
  const [state, setState] = useState(closed), [device, setDevice] = useState<ConsoleStreamDevice>(), [connection, setConnection] = useState('connecting');
  const [video, setVideo] = useState(false), [quality, setQuality] = useState(''), [menu, setMenu] = useState(false), [muted, setMuted] = useState(false);
  const [message, setMessage] = useState<Parameters<Parameters<typeof connectCloudPlayer>[0]['message']>[0]>();
  const root = useRef<HTMLDivElement>(null), player = useRef<CloudPlayerHandle>(), previous = useRef<HTMLElement | null>(null);
  const stateRef = useRef(state), revision = useRef(0), stopping = useRef<{id?: string}>(), inputOwner = useRef(Symbol('console-stream'));
  const controlsRef = useRef(true), obscured = useStreamObscured(state.phase !== 'closed');
  const preparing = ['starting','provisioning'].includes(state.phase);
  stateRef.current = state;
  useEffect(() => observeConsoleSession(bridge, value => {revision.current++; stateRef.current = value; setState(value);}), [bridge]);
  useEffect(() => {
    setDevice(undefined);
    if (!state.consoleId || !bridge?.getConsoleStreamDevices) return;
    let current = true;
    void bridge.getConsoleStreamDevices().then(value => {if (current) setDevice(value.consoles.find(item => item.id === state.consoleId));}).catch(() => {});
    return () => {current = false;};
  }, [state.consoleId, bridge]);
  useEffect(() => {setVideo(false); setQuality(''); setMenu(false); setMessage(undefined); setConnection('connecting'); setMuted(false);}, [state.id]);
  useEffect(() => {
    if (state.phase === 'closed') return;
    previous.current = document.activeElement as HTMLElement | null;
    return () => {if (previous.current?.isConnected) previous.current.focus({preventScroll: true});};
  }, [state.phase === 'closed']);
  useEffect(() => {
    if (!state.id || !preparing || !bridge?.getConsoleStreamState) return;
    const id = state.id;
    let cancelled = false; let timer: ReturnType<typeof setTimeout>;
    const ownsSession = () => !cancelled && stateRef.current.id === id;
    const poll = async () => {
      const before = revision.current; let failed = false;
      try {
        const value = await bridge.getConsoleStreamState!(id);
        if (ownsSession() && before === revision.current && (value.id === id || value.phase === 'closed' && !value.id)) {stateRef.current = value; setState(value);}
      } catch {
        if (ownsSession() && before === revision.current) {failed = true; setConnection('error');}
      } finally {
        // A state push sent before the IPC reply supersedes its value, not the
        // next poll. The loop belongs to the still-preparing current session.
        if (!failed && ownsSession() && ['starting','provisioning'].includes(stateRef.current.phase)) timer = setTimeout(poll, 2000);
      }
    };
    timer = setTimeout(poll, 1000);
    return () => {cancelled = true; clearTimeout(timer);};
  }, [state.id, preparing, bridge]);
  useEffect(() => {
    if (state.phase !== 'ready' || !state.id || !bridge?.exchangeConsoleStreamSdp || !bridge.exchangeConsoleStreamIce) return;
    const controller = new AbortController(), container = document.getElementById('xboks-console-video');
    let boundVideo: HTMLVideoElement | null = null, handle: CloudPlayerHandle | undefined;
    const dimensions = () => {if (boundVideo?.videoWidth && boundVideo.videoHeight) setQuality(`${boundVideo.videoWidth} × ${boundVideo.videoHeight}`);};
    const played = () => {setVideo(true); dimensions();};
    const bindVideo = () => {
      const next = container?.querySelector('video') ?? null;
      if (next === boundVideo) return;
      boundVideo?.removeEventListener('playing', played); boundVideo?.removeEventListener('loadedmetadata', dimensions); boundVideo?.removeEventListener('resize', dimensions);
      boundVideo = next;
      next?.addEventListener('playing', played); next?.addEventListener('loadedmetadata', dimensions); next?.addEventListener('resize', dimensions); dimensions();
    };
    const observer = new MutationObserver(bindVideo);
    if (container) observer.observe(container, {childList: true, subtree: true});
    bindVideo(); setConnection('connecting');
    void connectCloudPlayer({container: 'xboks-console-video', id: state.id, signal: controller.signal,
      bridge: {exchangeCloudSdp: (id, sdp) => bridge.exchangeConsoleStreamSdp!(id, sdp), exchangeCloudIce: (id, candidates) => bridge.exchangeConsoleStreamIce!(id, candidates)},
      changed: value => {if (!controller.signal.aborted) setConnection(value);}, message: value => {if (!controller.signal.aborted) setMessage(value);},
    }).then(value => {if (controller.signal.aborted) value.close(); else {handle = value; player.current = value; value.pause(controlsRef.current);}}).catch(() => {});
    return () => {
      controller.abort(); observer.disconnect(); boundVideo?.removeEventListener('playing', played); boundVideo?.removeEventListener('loadedmetadata', dimensions); boundVideo?.removeEventListener('resize', dimensions);
      handle?.close(); if (player.current === handle) player.current = undefined;
    };
  }, [state.id, state.phase === 'ready', bridge]);
  const showControls = menu || Boolean(message) || !video || connection !== 'connected';
  controlsRef.current = showControls || obscured;
  useEffect(() => {
    const active = state.phase !== 'closed' && !obscured, owner = inputOwner.current;
    if (active) claimStreamInput(document, owner, showControls ? 'menu' : 'active'); else releaseStreamInput(document, owner);
    player.current?.pause(showControls || obscured);
    if (active && showControls) root.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
    return () => releaseStreamInput(document, owner);
  }, [state.phase, showControls, obscured]);
  useEffect(() => {
    if (state.phase === 'closed' || obscured) return;
    const escape = (event: KeyboardEvent) => {if (event.key === 'Escape') {event.preventDefault(); event.stopImmediatePropagation(); setMenu(value => !value);}};
    window.addEventListener('keydown', escape, true); return () => window.removeEventListener('keydown', escape, true);
  }, [state.phase, obscured]);
  async function stop() {
    if (!bridge?.stopConsoleStream || (stopping.current && stopping.current.id === state.id)) return;
    const request = {id: state.id}, before = revision.current;
    stopping.current = request; player.current?.pause(true);
    try {await bridge.stopConsoleStream(request.id); if (before === revision.current && stateRef.current.id === request.id) {stateRef.current = closed; setState(closed);}}
    catch {if (before === revision.current && stateRef.current.id === request.id) setConnection('error');}
    finally {if (stopping.current === request) stopping.current = undefined;}
  }
  useBackHandler(() => {if (message) return true; if (menu) setMenu(false); else if (video) setMenu(true); else void stop(); return true;}, state.phase !== 'closed' && !obscured, () => root.current);
  if (state.phase === 'closed') return null;
  const failure = state.phase === 'error' || ['disconnected','error'].includes(connection);
  const explanation = state.error === 'signed-out' || state.error === 'account-changed' ? t('Sign in to XBOKS with your console account, then try again.', 'Συνδεθείτε στο XBOKS με τον λογαριασμό της κονσόλας σας και δοκιμάστε ξανά.')
    : state.error === 'busy' ? t('Another streaming session is active. End it before connecting to your console.', 'Μια άλλη συνεδρία streaming είναι ενεργή. Τερματίστε την πριν συνδεθείτε στην κονσόλα.')
    : state.error === 'transfer-token-required' ? t('Your console requires an additional session transfer that is not supported yet.', 'Η κονσόλα σας απαιτεί πρόσθετη μεταφορά συνεδρίας που δεν υποστηρίζεται ακόμη.')
    : state.error === 'unsupported' ? t('This XBOKS installation cannot connect to the console service.', 'Αυτή η εγκατάσταση XBOKS δεν μπορεί να συνδεθεί στην υπηρεσία κονσόλας.')
    : t('Check your console is available, remote features are enabled, and both devices have a working network connection.', 'Ελέγξτε ότι η κονσόλα είναι διαθέσιμη, ότι οι απομακρυσμένες δυνατότητες είναι ενεργές και ότι και οι δύο συσκευές έχουν σύνδεση δικτύου.');
  return <div ref={root} className={`cloud-stream-host console-stream-host${obscured ? ' stream-obscured' : ''}`} role="dialog" aria-modal="true" aria-hidden={obscured || undefined} aria-label={t('Console remote-play session', 'Συνεδρία απομακρυσμένου παιχνιδιού κονσόλας')} data-console-session-phase={state.phase}>
    <div className="cloud-stream-video" id="xboks-console-video"/>
    {(!video || failure) && !message ? <section className="cloud-stream-loading"><MonitorPlay size={48}/><h1>{device?.name ?? t('Xbox remote play', 'Απομακρυσμένο παιχνίδι Xbox')}</h1>{failure ? <><h2>{t('Your console could not connect', 'Η κονσόλα σας δεν συνδέθηκε')}</h2><p>{explanation}</p></> : <><LoaderCircle className="spin"/><h2>{state.phase === 'provisioning' ? t('Preparing your console', 'Προετοιμασία κονσόλας') : t('Connecting to your console', 'Σύνδεση με την κονσόλα σας')}</h2><p>{t('Using your signed-in XBOKS account', 'Με τον συνδεδεμένο λογαριασμό XBOKS')}</p><p>{t('Stream quality is negotiated when the console connects.', 'Η ποιότητα streaming διαπραγματεύεται όταν συνδεθεί η κονσόλα.')}</p></>}<button data-gamepad-cancel onClick={() => void stop()}><X/>{t('Return to XBOKS', 'Επιστροφή στο XBOKS')}</button></section> : null}
    <nav className={`cloud-stream-toolbar${showControls ? ' visible' : ''}`} aria-label={t('Remote-play controls', 'Στοιχεία ελέγχου απομακρυσμένου παιχνιδιού')}>
      <button aria-label={t('Xbox guide', 'Οδηγός Xbox')} disabled={!video} onClick={() => {setMenu(false); player.current?.guide();}}><Gamepad2/></button><strong>{device?.name ?? t('Xbox remote play', 'Απομακρυσμένο παιχνίδι Xbox')}</strong>{quality ? <span className="console-stream-quality" aria-label={t('Decoded video resolution', 'Ανάλυση αποκωδικοποιημένου βίντεο')}>{quality}</span> : null}
      {video ? <button onClick={() => setMenu(false)}><Play/>{t('Resume', 'Συνέχεια')}</button> : null}<button aria-label={muted ? t('Unmute stream', 'Ενεργοποίηση ήχου') : t('Mute stream', 'Σίγαση ήχου')} onClick={() => {player.current?.mute(!muted); setMuted(value => !value);}}>{muted ? <VolumeX/> : <Volume2/>}</button><button aria-label={t('Fullscreen', 'Πλήρης οθόνη')} onClick={() => void bridge?.setWindowFullscreen?.(true)}><Maximize/></button><button aria-label={t('End remote play', 'Τέλος απομακρυσμένου παιχνιδιού')} onClick={() => setMenu(value => !value)}><X/></button>
    </nav>
    {menu && video && !message ? <section className="cloud-stream-menu" role="dialog" aria-modal="true" aria-label={t('Remote-play menu', 'Μενού απομακρυσμένου παιχνιδιού')}><h2>{t('Remote play', 'Απομακρυσμένο παιχνίδι')}</h2><p>{t('Return to your console or end this streaming session.', 'Επιστρέψτε στην κονσόλα σας ή τερματίστε αυτή τη συνεδρία streaming.')}</p><button data-gamepad-initial data-gamepad-cancel onClick={() => setMenu(false)}><Play/>{t('Keep playing', 'Συνέχεια παιχνιδιού')}</button><button onClick={() => void stop()}><X/>{t('End session', 'Τερματισμός συνεδρίας')}</button></section> : null}
    {message ? <section className="cloud-stream-menu" role="dialog" aria-modal="true" aria-label={message.title}><h2>{message.title}</h2><p>{message.text}</p>{message.buttons.map((label, index) => label ? <button key={index} onClick={() => message.respond(index)}>{label}</button> : null)}</section> : null}
  </div>;
}
