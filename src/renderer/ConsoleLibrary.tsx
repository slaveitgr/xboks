import {useEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import type {AuthStatus} from '../shared/types';
import type {ConsoleStreamApi, ConsoleStreamDevice, ConsoleStreamList} from '../shared/console-stream';
import {Gamepad2, MonitorPlay, Play, RefreshCw, X} from './XboxIcons';
import {LoaderCircle} from 'lucide-react';
import {useBackHandler} from './GamepadNavigation';
import {useReferenceLocale} from './ReferenceLocale';
import {observeConsoleSession} from './ConsoleStream';
import './console-library.css';

type Bridge = Partial<ConsoleStreamApi>;
type Listing = {key: string; value?: ConsoleStreamList; loading: boolean; error: boolean};
export function ConsoleLibrary({auth, close, signIn, bridge = typeof window === 'undefined' ? undefined : window.launcher as Bridge}: {
  auth?: AuthStatus; close: () => void; signIn?: () => void; bridge?: Bridge;
}) {
  const {text: t} = useReferenceLocale();
  const account = `${Boolean(auth?.stored)}:${auth?.username ?? ''}:${Boolean(auth?.running)}`;
  const [listing, setListing] = useState<Listing>({key: account, loading: true, error: false});
  const [selected, setSelected] = useState<string>(), [busy, setBusy] = useState(false), [failure, setFailure] = useState(false);
  const [covered, setCovered] = useState(false);
  const root = useRef<HTMLElement>(null), generation = useRef(0), mounted = useRef(true), currentAccount = useRef(account);
  const pending = useRef<{generation: number; consoleId: string}>();
  currentAccount.current = account;
  const current = listing.key === account ? listing : {key: account, loading: true, error: false};
  const devices = current.value?.status === 'ready' ? current.value.consoles : [];
  const device = devices.find(value => value.id === selected);
  const dismiss = () => {if (!pending.current) close();};
  useBackHandler(() => {dismiss(); return true;}, !covered, () => root.current);
  useEffect(() => observeConsoleSession(bridge, value => setCovered(value.phase !== 'closed')), [bridge]);
  useEffect(() => {if (root.current) root.current.inert = covered;}, [covered]);
  useEffect(() => {
    mounted.current = true;
    const previous = document.activeElement as HTMLElement | null;
    const background = [...document.querySelectorAll<HTMLElement>('.app-shell > .sidebar,.app-shell > .content-shell')], inert = background.map(node => node.inert);
    background.forEach(node => {node.inert = true;});
    root.current?.querySelector<HTMLButtonElement>('.console-library-close')?.focus();
    return () => {mounted.current = false; generation.current++; pending.current = undefined; background.forEach((node, index) => {node.inert = inert[index];}); if (previous?.isConnected) previous.focus({preventScroll: true});};
  }, []);
  async function load(refresh: boolean) {
    if (pending.current) return;
    const epoch = ++generation.current, key = account;
    setSelected(undefined); setFailure(false); setListing({key, loading: true, error: false});
    try {
      if (!bridge?.getConsoleStreamDevices) {setListing({key, loading: false, error: false, value: {status: 'unsupported', consoles: [], checkedAt: ''}}); return;}
      const value = await bridge.getConsoleStreamDevices(refresh);
      if (!mounted.current || epoch !== generation.current || currentAccount.current !== key) return;
      setListing({key, loading: false, error: false, value});
    } catch {if (mounted.current && epoch === generation.current && currentAccount.current === key) setListing({key, loading: false, error: true});}
  }
  useEffect(() => {
    pending.current = undefined; setBusy(false); void load(false);
    return () => {generation.current++;};
  }, [account, bridge]);
  async function connect() {
    if (!device?.canStream || !bridge?.startConsoleStream || pending.current || current.loading || current.error) return;
    const request = {generation: generation.current, consoleId: device.id}, key = account;
    pending.current = request; setBusy(true); setFailure(false);
    try {
      const state = await bridge.startConsoleStream(request.consoleId);
      if (!mounted.current || pending.current !== request || request.generation !== generation.current || currentAccount.current !== key) return;
      if (state.phase === 'error' || state.phase === 'closed') setFailure(true);
      else close();
    } catch {if (mounted.current && pending.current === request && request.generation === generation.current && currentAccount.current === key) setFailure(true);}
    finally {if (pending.current === request) {pending.current = undefined; if (mounted.current) setBusy(false);}}
  }
  function powerLabel(power: ConsoleStreamDevice['powerState']) {
    return power === 'on' ? t('On', 'Ενεργή') : power === 'standby' ? t('Standby', 'Αναμονή') : power === 'off' ? t('Off', 'Απενεργοποιημένη') : t('Power state unavailable', 'Η κατάσταση λειτουργίας δεν είναι διαθέσιμη');
  }
  const signedOut = current.value?.status === 'signed-out';
  return createPortal(<div className="console-library-backdrop" style={covered ? {visibility: 'hidden'} : undefined} aria-hidden={covered || undefined} onMouseDown={event => {if (event.target === event.currentTarget) dismiss();}}>
    <section ref={root} className="console-library" role="dialog" aria-modal={!covered || undefined} aria-label={t('Xbox consoles', 'Κονσόλες Xbox')} data-console-account={account} onKeyDown={event => {
      if (event.key === 'Escape') {event.preventDefault(); event.stopPropagation(); dismiss();}
      if (event.key !== 'Tab') return;
      const controls = [...(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],select:not(:disabled)') ?? [])].filter(node => node.getClientRects().length);
      if (event.shiftKey && document.activeElement === controls[0]) {event.preventDefault(); controls.at(-1)?.focus();}
      else if (!event.shiftKey && document.activeElement === controls.at(-1)) {event.preventDefault(); controls[0]?.focus();}
    }}>
      <header><div><h1>{t('Xbox consoles', 'Κονσόλες Xbox')}</h1><p>{t('Remote play from your console', 'Απομακρυσμένο παιχνίδι από την κονσόλα σας')}</p></div><button className="console-library-close" data-gamepad-cancel aria-label={t('Close Xbox consoles', 'Κλείσιμο κονσολών Xbox')} disabled={busy} onClick={dismiss}><X/></button></header>
      <div className="console-library-account"><Gamepad2/><span>{t('Your XBOKS account', 'Ο λογαριασμός XBOKS σας')}</span><button className="console-library-refresh" disabled={busy || current.loading} onClick={() => void load(true)}><RefreshCw/>{t('Refresh', 'Ανανέωση')}</button></div>
      <div className="console-library-body" aria-busy={current.loading || busy}>
        {current.loading ? <div className="console-library-empty"><LoaderCircle className="spin"/><h2>{t('Finding your consoles', 'Εύρεση των κονσολών σας')}</h2><p>{t('Checking the consoles connected to this account.', 'Έλεγχος των κονσολών που είναι συνδεδεμένες σε αυτόν τον λογαριασμό.')}</p></div>
          : current.error || current.value?.status === 'error' ? <div className="console-library-empty" role="alert"><MonitorPlay/><h2>{t('Your consoles could not load', 'Οι κονσόλες σας δεν φορτώθηκαν')}</h2><p>{t('Check your connection and try again.', 'Ελέγξτε τη σύνδεσή σας και δοκιμάστε ξανά.')}</p><button onClick={() => void load(true)}>{t('Try again', 'Δοκιμάστε ξανά')}</button></div>
          : signedOut ? <div className="console-library-empty"><Gamepad2/><h2>{t('Sign in to see your consoles', 'Συνδεθείτε για να δείτε τις κονσόλες σας')}</h2><p>{t('Use the same Microsoft account as your Xbox console.', 'Χρησιμοποιήστε τον ίδιο λογαριασμό Microsoft με την κονσόλα Xbox σας.')}</p><button disabled={!signIn} onClick={signIn}>{t('Sign in', 'Σύνδεση')}</button></div>
          : current.value?.status === 'unsupported' ? <div className="console-library-empty"><MonitorPlay/><h2>{t('Remote play is unavailable', 'Το απομακρυσμένο παιχνίδι δεν είναι διαθέσιμο')}</h2><p>{t('This XBOKS installation cannot connect to the console service.', 'Αυτή η εγκατάσταση XBOKS δεν μπορεί να συνδεθεί στην υπηρεσία κονσόλας.')}</p></div>
          : !devices.length ? <div className="console-library-empty"><MonitorPlay/><h2>{t('No consoles found', 'Δεν βρέθηκαν κονσόλες')}</h2><p>{t('Sign in on your Xbox and enable remote features in its settings, then refresh this list.', 'Συνδεθείτε στο Xbox και ενεργοποιήστε τις απομακρυσμένες δυνατότητες στις ρυθμίσεις του. Έπειτα ανανεώστε τη λίστα.')}</p></div>
          : <><h2>{t('Your consoles', 'Οι κονσόλες σας')}</h2><div className="console-device-list" role="group" aria-label={t('Choose a console', 'Επιλέξτε κονσόλα')}>{devices.map(value => <button key={value.id} className={`console-device${selected === value.id ? ' selected' : ''}`} data-console-id={value.id} aria-pressed={selected === value.id} disabled={busy} onClick={() => {setSelected(value.id); setFailure(false);}}><span className="console-device-art"><MonitorPlay size={42}/></span><span className="console-device-copy"><strong>{value.name}</strong>{value.consoleType ? <span>{value.consoleType}</span> : null}<span className={`console-device-power ${value.powerState}`}><i/>{powerLabel(value.powerState)}</span></span><span className="console-device-radio" aria-hidden="true"/></button>)}</div>
            <div className="console-connection-options"><strong>{t('Stream quality', 'Ποιότητα streaming')}</strong><span>{t('Automatic', 'Αυτόματη')}</span><p>{t('The connection negotiates stream quality with your console. The actual resolution appears after video starts.', 'Η σύνδεση διαπραγματεύεται την ποιότητα streaming με την κονσόλα σας. Η πραγματική ανάλυση εμφανίζεται όταν ξεκινήσει το βίντεο.')}</p></div>
            {device?.outOfHomeWarning ? <p className="console-library-warning">{t('This console may require setup on your home network before remote play is available away from home.', 'Αυτή η κονσόλα ενδέχεται να χρειάζεται ρύθμιση στο οικιακό δίκτυο πριν από το απομακρυσμένο παιχνίδι εκτός σπιτιού.')}</p> : null}
            {device && !device.canStream ? <p className="console-library-warning">{t('This console cannot accept a remote-play connection right now. Turn it on and check its remote features, then refresh.', 'Αυτή η κονσόλα δεν μπορεί να δεχτεί σύνδεση απομακρυσμένου παιχνιδιού τώρα. Ενεργοποιήστε την, ελέγξτε τις απομακρυσμένες δυνατότητες και ανανεώστε.')}</p> : null}
            {device?.powerState === 'standby' ? <p className="console-library-warning">{t('Connect to try remote play from standby.', 'Επιλέξτε Σύνδεση για να επιχειρήσετε απομακρυσμένο παιχνίδι από την αναμονή.')}</p> : null}
          </>}
        {failure ? <p className="console-library-warning" role="alert">{t('Your console could not connect. Check its network and remote features, then try again.', 'Η κονσόλα σας δεν συνδέθηκε. Ελέγξτε το δίκτυο και τις απομακρυσμένες δυνατότητές της και δοκιμάστε ξανά.')}</p> : null}
      </div>
      <footer><p>{t('A controller is recommended for remote play.', 'Συνιστάται χειριστήριο για απομακρυσμένο παιχνίδι.')}</p><button className="console-connect primary" disabled={!device?.canStream || !bridge?.startConsoleStream || busy || current.loading || current.error} onClick={() => void connect()}>{busy ? <LoaderCircle className="spin"/> : <Play/>}{busy ? t('Connecting…', 'Σύνδεση…') : t('Connect', 'Σύνδεση')}</button></footer>
    </section>
  </div>, document.body);
}
