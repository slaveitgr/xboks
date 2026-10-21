import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Bluetooth, Moon, Power, Wifi } from 'lucide-react';
import { ArrowLeft, ChevronRight, ExternalLink, LockKeyhole, LogOut, RefreshCw } from './XboxIcons';
import type { GuideSystemAction, GuideSystemState, GuidePowerAction, GuideSystemSettingsSection as GuideSystemSection } from '../shared/guide-system';
import { useBackHandler } from './GamepadNavigation';
import { useReferenceLocale } from './ReferenceLocale';
import './guide-system-controls.css';

type Text = (english: string, greek: string) => string;
type PowerConfirmation = { action: GuidePowerAction; token: string; expiresAt: string };
export type GuideSystemBridge = Pick<Window['launcher'], 'getGuideSystem' | 'executeGuideSystem' | 'openGuideSystemSettings' | 'prepareGuidePower'>;
const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;
const powerOrder: GuidePowerAction[] = ['lock', 'logout', 'suspend', 'poweroff', 'reboot'];
const powerNames = (t: Text): Record<GuidePowerAction, string> => ({ lock: t('Lock', 'Κλείδωμα'), logout: t('Sign out', 'Αποσύνδεση'), suspend: t('Sleep', 'Αναστολή λειτουργίας'), reboot: t('Restart', 'Επανεκκίνηση'), poweroff: t('Shut down', 'Τερματισμός λειτουργίας') });
const sectionNames = (t: Text): Record<GuideSystemSection, string> => ({ network: t('Network', 'Δίκτυο'), bluetooth: 'Bluetooth', power: t('Power', 'Λειτουργία') });
const reason = (value: { available: boolean; reason?: string }, t: Text) => value.reason || t('Unavailable in this session.', 'Δεν είναι διαθέσιμο σε αυτήν τη συνεδρία.');

/** Recheck capability at the UI boundary as well as in the privileged adapter. */
export function guideSystemActionAvailable(state: GuideSystemState | undefined, action: GuideSystemAction): boolean {
  if (!state) return false;
  switch (action.type) {
    case 'wifi': return state.network.available && Boolean(state.network.wifi?.toggle.available && state.network.wifi.hardwareEnabled);
    case 'bluetooth': return state.bluetooth.available && Boolean(state.bluetooth.controller && state.bluetooth.toggle.available);
    case 'bluetooth-device': {
      const device = state.bluetooth.devices.find(item => item.address === action.address);
      return state.bluetooth.available && state.bluetooth.controller?.powered === true && Boolean(device && (action.connected ? device.connect.available : device.disconnect.available));
    }
    case 'power': return state.power.available && state.power.actions[action.action].available;
    case 'open-settings': return state[action.section].settings.available;
  }
}

/** Local expiry/action binding prevents accidental execution before IPC repeats
 * the sender-bound, single-use nonce and active-operation checks. */
export function guidePowerConfirmationToken(confirmation: PowerConfirmation | undefined, action: GuidePowerAction, now = Date.now()): string | undefined {
  return confirmation?.action === action && confirmation.token.length > 0 && Date.parse(confirmation.expiresAt) > now ? confirmation.token : undefined;
}

function SectionIcon({ section }: { section: GuideSystemSection }) { return section === 'network' ? <Wifi /> : section === 'bluetooth' ? <Bluetooth /> : <Power />; }
function PowerIcon({ action }: { action: GuidePowerAction }) { return action === 'lock' ? <LockKeyhole /> : action === 'logout' ? <LogOut /> : action === 'suspend' ? <Moon /> : action === 'reboot' ? <RefreshCw /> : <Power />; }
function networkSummary(state: GuideSystemState['network'], t: Text): string {
  if (!state.available) return reason(state, t);
  const connected = state.devices.filter(device => Boolean(device.connection) && device.connection !== '--').map(device => device.connection);
  if (connected.length) return connected.join(' · ');
  return state.state || t('Connection status unavailable', 'Η κατάσταση σύνδεσης δεν είναι διαθέσιμη');
}

export function GuideSystemContents({ state, section, busy, select, action, settings, back, refresh, t }: {
  state?: GuideSystemState; section?: GuideSystemSection; busy: boolean;
  select: (section: GuideSystemSection) => void; action: (action: GuideSystemAction) => void;
  settings: (section: GuideSystemSection) => void; back: () => void; refresh: () => void; t: Text;
}) {
  const names = sectionNames(t);
  const available = section && state?.[section];
  if (!section) return <div className="guide-system-rows">{(['network', 'bluetooth', 'power'] as const).map(value => <button className="guide-row guide-system-row" key={value} data-guide-system-open={value} onClick={() => select(value)} disabled={busy}>
    <SectionIcon section={value} /><span><strong>{names[value]}</strong><small>{!state ? t('Status unavailable', 'Η κατάσταση δεν είναι διαθέσιμη') : value === 'network' ? networkSummary(state.network, t) : value === 'bluetooth' ? !state.bluetooth.available ? reason(state.bluetooth, t) : state.bluetooth.controller?.powered ? state.bluetooth.devices.filter(device => device.connected).map(device => device.name).join(' · ') || t('On', 'Ενεργό') : t('Off', 'Ανενεργό') : !state.power.available ? reason(state.power, t) : undefined}</small></span><ChevronRight />
  </button>)}</div>;
  return <>
    <div className="guide-system-heading"><button data-guide-system-back data-gamepad-cancel onClick={back} disabled={busy}><ArrowLeft />{names[section]}</button><button aria-label={t('Refresh system status', 'Ανανέωση κατάστασης συστήματος')} onClick={refresh} disabled={busy}><RefreshCw /></button></div>
    {!state || !available?.available ? <p className="guide-note">{available ? reason(available, t) : t('System controls are unavailable in this session.', 'Τα στοιχεία συστήματος δεν είναι διαθέσιμα σε αυτήν τη συνεδρία.')}</p> : null}
    {section === 'network' && state?.network.available ? <>
      <p className="guide-muted">{networkSummary(state.network, t)}{state.network.connectivity ? ` · ${state.network.connectivity}` : ''}</p>
      {state.network.wifi ? <label className="guide-system-toggle"><Wifi /><span>Wi-Fi</span><input type="checkbox" role="switch" checked={state.network.wifi.enabled} disabled={busy || !guideSystemActionAvailable(state, { type: 'wifi', enabled: !state.network.wifi.enabled })} onChange={event => action({ type: 'wifi', enabled: event.target.checked })} /></label> : null}
      {state.network.wifi && !state.network.wifi.toggle.available ? <p className="guide-note">{reason(state.network.wifi.toggle, t)}</p> : state.network.wifi && !state.network.wifi.hardwareEnabled ? <p className="guide-note">{t('Wi-Fi is disabled by the hardware switch.', 'Το Wi-Fi είναι απενεργοποιημένο από τον διακόπτη υλικού.')}</p> : null}
      <div className="guide-system-device-list">{state.network.devices.map(device => <div className="guide-system-device" key={device.interface}><Wifi /><span><strong>{device.connection && device.connection !== '--' ? device.connection : device.interface}</strong><small>{device.interface} · {device.type} · {device.state}</small></span></div>)}</div>
      <p className="guide-muted">{t('Choose networks and enter passwords in your desktop network settings.', 'Επιλέξτε δίκτυα και πληκτρολογήστε κωδικούς στις ρυθμίσεις δικτύου της επιφάνειας εργασίας.')}</p>
    </> : null}
    {section === 'bluetooth' && state?.bluetooth.available ? <>
      {state.bluetooth.controller ? <label className="guide-system-toggle"><Bluetooth /><span>Bluetooth<small>{state.bluetooth.controller.name}</small></span><input type="checkbox" role="switch" checked={state.bluetooth.controller.powered} disabled={busy || !guideSystemActionAvailable(state, { type: 'bluetooth', enabled: !state.bluetooth.controller.powered })} onChange={event => action({ type: 'bluetooth', enabled: event.target.checked })} /></label> : null}
      {!state.bluetooth.toggle.available ? <p className="guide-note">{reason(state.bluetooth.toggle, t)}</p> : null}
      <h3>{t('Paired devices', 'Συζευγμένες συσκευές')}</h3>
      <div className="guide-system-device-list">{state.bluetooth.devices.map(device => {
        const next: GuideSystemAction = { type: 'bluetooth-device', address: device.address, connected: !device.connected };
        const capability = device.connected ? device.disconnect : device.connect;
        return <div className="guide-system-device" key={device.address}><Bluetooth /><span><strong>{device.name}</strong><small>{device.connected ? t('Connected', 'Σε σύνδεση') : t('Disconnected', 'Εκτός σύνδεσης')}</small>{!capability.available ? <small>{reason(capability, t)}</small> : null}</span><button disabled={busy || !guideSystemActionAvailable(state, next)} onClick={() => action(next)}>{device.connected ? t('Disconnect', 'Αποσύνδεση') : t('Connect', 'Σύνδεση')}</button></div>;
      })}</div>
      {!state.bluetooth.devices.length ? <p className="guide-muted">{t('No paired devices were reported.', 'Δεν αναφέρθηκαν συζευγμένες συσκευές.')}</p> : null}
      <p className="guide-muted">{t('Pair new devices in your desktop Bluetooth settings.', 'Συνδέστε νέες συσκευές στις ρυθμίσεις Bluetooth της επιφάνειας εργασίας.')}</p>
    </> : null}
    {section === 'power' && state?.power.available ? <div className="guide-power-actions">{powerOrder.map(value => <div key={value}><button className="guide-row" disabled={busy || !state.power.actions[value].available} onClick={() => action({ type: 'power', action: value })}><PowerIcon action={value} />{powerNames(t)[value]}<ChevronRight /></button>{!state.power.actions[value].available && state.power.actions[value].reason ? <p className="guide-muted">{state.power.actions[value].reason}</p> : null}</div>)}</div> : null}
    <button className="guide-wide" disabled={busy || !state?.[section].settings.available} title={state?.[section].settings.reason} onClick={() => settings(section)}>{t('Open desktop settings', 'Άνοιγμα ρυθμίσεων επιφάνειας εργασίας')}<ExternalLink /></button>
    {state?.[section].settings.requiresAuthorization ? <p className="guide-muted">{t('Your desktop may ask for authorization.', 'Η επιφάνεια εργασίας μπορεί να ζητήσει εξουσιοδότηση.')}</p> : null}
  </>;
}

export function GuideSystemControls() {
  const { text: t } = useReferenceLocale();
  const [state, setState] = useState<GuideSystemState>();
  const [section, setSection] = useState<GuideSystemSection>();
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState<PowerConfirmation>();
  const root = useRef<HTMLDivElement>(null), confirmRoot = useRef<HTMLDivElement>(null), previousPowerTrigger = useRef<HTMLElement | null>(null);
  const current = useRef(true), pending = useRef(false), request = useRef(0);
  const bridge = typeof window === 'undefined' ? undefined : window.launcher;
  const canRead = typeof bridge?.getGuideSystem === 'function';
  async function refresh() {
    const version = ++request.current;
    if (!canRead) { if (current.current) { setLoading(false); setState(undefined); } return; }
    try { const next = await bridge!.getGuideSystem(); if (current.current && version === request.current) setState(next); }
    catch (value) { if (current.current && version === request.current) { setState(undefined); setError(value instanceof Error ? value.message : t('Could not read system status.', 'Δεν ήταν δυνατή η ανάγνωση της κατάστασης συστήματος.')); } }
    finally { if (current.current && version === request.current) setLoading(false); }
  }
  useEffect(() => {
    current.current = true; void refresh();
    const reopen = () => { if (!pending.current) { setConfirmation(undefined); setError(''); void refresh(); } };
    const visible = () => { if (document.visibilityState === 'visible') reopen(); };
    window.addEventListener('focus', reopen); document.addEventListener('visibilitychange', visible);
    return () => { current.current = false; request.current++; window.removeEventListener('focus', reopen); document.removeEventListener('visibilitychange', visible); };
  }, []);
  const back = () => { if (pending.current) return; const previous = section; setSection(undefined); requestAnimationFrame(() => root.current?.querySelector<HTMLElement>(`[data-guide-system-open="${previous}"]`)?.focus()); };
  useBackHandler(() => { back(); return true; }, Boolean(section) || busy, () => root.current);
  useBackHandler(() => { if (!pending.current) setConfirmation(undefined); return true; }, Boolean(confirmation), () => confirmRoot.current);
  useBrowserLayoutEffect(() => {
    if (!confirmation || !confirmRoot.current) return;
    confirmRoot.current.querySelector<HTMLElement>('[data-gamepad-cancel]')?.focus();
    return () => { if (previousPowerTrigger.current?.isConnected) previousPowerTrigger.current.focus({ preventScroll: true }); };
  }, [confirmation]);
  async function perform(action: GuideSystemAction, token?: string) {
    if (pending.current || !guideSystemActionAvailable(state, action) || typeof bridge?.executeGuideSystem !== 'function') return;
    if (action.type === 'power' && !token) return;
    pending.current = true; setBusy(true); setError(''); setConfirmation(undefined);
    try { const result = await bridge.executeGuideSystem(action, token); if (current.current) { setState(result.state); if (!result.ok) setError(result.error || t('The system action failed.', 'Η ενέργεια συστήματος απέτυχε.')); } }
    catch (value) { if (current.current) setError(value instanceof Error ? value.message : t('The system action failed.', 'Η ενέργεια συστήματος απέτυχε.')); }
    finally { await refresh(); pending.current = false; if (current.current) setBusy(false); }
  }
  async function chooseAction(action: GuideSystemAction) {
    if (pending.current || !guideSystemActionAvailable(state, action)) return;
    if (action.type !== 'power') { await perform(action); return; }
    if (typeof bridge?.prepareGuidePower !== 'function') { setError(t('Power confirmation is unavailable.', 'Η επιβεβαίωση λειτουργίας δεν είναι διαθέσιμη.')); return; }
    previousPowerTrigger.current = document.activeElement as HTMLElement | null;
    pending.current = true; setBusy(true); setError('');
    try { const prepared = await bridge.prepareGuidePower(action.action); if (current.current) setConfirmation({ action: action.action, ...prepared }); }
    catch (value) { if (current.current) setError(value instanceof Error ? value.message : t('This power action is unavailable.', 'Αυτή η ενέργεια λειτουργίας δεν είναι διαθέσιμη.')); }
    finally { pending.current = false; if (current.current) setBusy(false); }
  }
  async function openSettings(value: GuideSystemSection) {
    if (pending.current || !state?.[value].settings.available || typeof bridge?.openGuideSystemSettings !== 'function') return;
    pending.current = true; setBusy(true); setError('');
    try { await bridge.openGuideSystemSettings(value); }
    catch (value) { if (current.current) setError(value instanceof Error ? value.message : t('Desktop settings could not be opened.', 'Δεν ήταν δυνατό το άνοιγμα των ρυθμίσεων επιφάνειας εργασίας.')); }
    finally { await refresh(); pending.current = false; if (current.current) setBusy(false); }
  }
  return <div ref={root} className="guide-system-controls" data-guide-system-subpage={section || (busy ? 'busy' : undefined)} aria-busy={busy || loading || undefined} onKeyDown={event => {
    if (event.key === 'Escape' && (section || busy) && !confirmation) { event.preventDefault(); event.stopPropagation(); back(); }
  }}>
    {loading ? <p className="guide-muted" role="status">{t('Checking system controls…', 'Έλεγχος στοιχείων συστήματος…')}</p> : null}
    {!loading && !state ? <p className="guide-note">{t('System controls are unavailable in this session.', 'Τα στοιχεία συστήματος δεν είναι διαθέσιμα σε αυτήν τη συνεδρία.')}</p> : null}
    <fieldset disabled={busy || Boolean(confirmation)}><GuideSystemContents state={state} section={section} busy={busy || loading} select={value => { setError(''); setSection(value); requestAnimationFrame(() => root.current?.querySelector<HTMLElement>('[data-guide-system-back]')?.focus()); }} action={value => void chooseAction(value)} settings={value => void openSettings(value)} back={back} refresh={() => { setError(''); void refresh(); }} t={t} /></fieldset>
    {!section ? <button className="guide-system-refresh" disabled={busy || loading || !canRead} onClick={() => { setError(''); void refresh(); }}><RefreshCw />{t('Refresh status', 'Ανανέωση κατάστασης')}</button> : null}
    {error ? <p className="guide-system-error" role="alert">{error}</p> : null}
    {confirmation ? <div className="guide-power-confirm-backdrop"><div ref={confirmRoot} className="guide-power-confirm" role="dialog" aria-modal="true" aria-label={t('Confirm power action', 'Επιβεβαίωση λειτουργίας')} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!busy) setConfirmation(undefined); }
      if (event.key === 'Tab') { event.preventDefault(); const nodes = [...confirmRoot.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []]; const index = nodes.indexOf(document.activeElement as HTMLButtonElement); nodes[(index + (event.shiftKey ? -1 : 1) + nodes.length) % nodes.length]?.focus(); }
    }}><h3>{powerNames(t)[confirmation.action]}</h3><p>{confirmation.action === 'lock' ? t('Lock this desktop session now?', 'Να κλειδωθεί τώρα αυτή η συνεδρία;') : t('Save your work before continuing. This affects the current desktop session.', 'Αποθηκεύστε την εργασία σας πριν συνεχίσετε. Αυτή η ενέργεια επηρεάζει την τρέχουσα συνεδρία.')}</p><div><button data-gamepad-cancel disabled={busy} onClick={() => setConfirmation(undefined)}>{t('Cancel', 'Άκυρο')}</button><button disabled={busy} onClick={() => { const token = guidePowerConfirmationToken(confirmation, confirmation.action); if (!token) { setConfirmation(undefined); setError(t('Confirmation expired. Choose the action again.', 'Η επιβεβαίωση έληξε. Επιλέξτε ξανά την ενέργεια.')); return; } void perform({ type: 'power', action: confirmation.action }, token); }}>{t('Confirm', 'Επιβεβαίωση')}</button></div></div></div> : null}
  </div>;
}
