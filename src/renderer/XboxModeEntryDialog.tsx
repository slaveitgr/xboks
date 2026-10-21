import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useBackHandler } from './GamepadNavigation';
import { useReferenceLocale } from './ReferenceLocale';
import './xbox-mode-entry-dialog.css';

export interface XboxModeRestartBridge {
  getXboxModeRestartStatus?(): Promise<{ available: boolean; reason?: string }>;
  prepareXboxModeRestart?(): Promise<{ token: string; expiresAt: string }>;
  restartIntoXboxMode?(token: string): Promise<void>;
}

/** Prepare only after the explicit Restart choice. A dismissed dialog or an
 * expired preparation must never dispatch a later restart. */
export async function confirmXboxModeRestart(bridge: XboxModeRestartBridge, current = () => true, beforeDispatch = () => {}): Promise<boolean> {
  if (!current()) return false;
  if (!bridge.prepareXboxModeRestart || !bridge.restartIntoXboxMode) throw new Error('Restart into Xbox mode is unavailable in this session.');
  const prepared = await bridge.prepareXboxModeRestart();
  if (!current()) return false;
  if (!prepared || typeof prepared.token !== 'string' || !prepared.token.trim() || !Number.isFinite(Date.parse(prepared.expiresAt)) || Date.parse(prepared.expiresAt) <= Date.now()) {
    throw new Error('The restart confirmation expired. Choose Restart again.');
  }
  beforeDispatch();
  await bridge.restartIntoXboxMode(prepared.token);
  return true;
}

export function XboxModeEntryDialog({ startNow, close, bridge = typeof window === 'undefined' ? undefined : window.launcher as XboxModeRestartBridge }: {
  startNow: () => Promise<void>; close: () => void; bridge?: XboxModeRestartBridge;
}) {
  const { text, language } = useReferenceLocale();
  const root = useRef<HTMLElement>(null), mounted = useRef(false), dismissed = useRef(false), pending = useRef(false), locked = useRef(false);
  const closeRef = useRef(close); closeRef.current = close;
  const [status, setStatus] = useState<{ available: boolean; reason?: string }>();
  const [busy, setBusy] = useState(false), [dispatching, setDispatching] = useState(false), [error, setError] = useState('');
  const complete = () => { dismissed.current = true; closeRef.current(); };
  const dismiss = () => { if (!locked.current) complete(); };
  useBackHandler(() => { dismiss(); return true; }, true, () => root.current);
  useEffect(() => {
    mounted.current = true; dismissed.current = false;
    const shell = document.querySelector<HTMLElement>('.app-shell'), inert = shell?.inert ?? false;
    if (shell) shell.inert = true;
    root.current?.querySelector<HTMLButtonElement>('[data-gamepad-cancel]')?.focus({ preventScroll: true });
    return () => { mounted.current = false; dismissed.current = true; if (shell) shell.inert = inert; };
  }, []);
  useEffect(() => {
    let cancelled = false;
    const unavailable = text('Restart into Xbox mode is unavailable in this session.', 'Η επανεκκίνηση σε λειτουργία Xbox δεν είναι διαθέσιμη σε αυτήν τη συνεδρία.');
    setStatus(undefined);
    if (!bridge?.getXboxModeRestartStatus || !bridge.prepareXboxModeRestart || !bridge.restartIntoXboxMode) setStatus({ available: false, reason: unavailable });
    else void bridge.getXboxModeRestartStatus().then(value => {
      if (!cancelled) setStatus(value.available === true ? { available: true } : { available: false, reason: value.reason || unavailable });
    }).catch(() => { if (!cancelled) setStatus({ available: false, reason: unavailable }); });
    return () => { cancelled = true; };
  }, [bridge, language]);
  const current = () => mounted.current && !dismissed.current;
  const failure = (value: unknown) => {
    const message = value instanceof Error ? value.message.replace(/^Error invoking remote method '[^']+': Error:\s*/, '') : '';
    setError(message === 'The restart confirmation expired. Choose Restart again.' ? text(message, 'Η επιβεβαίωση επανεκκίνησης έληξε. Επιλέξτε ξανά Επανεκκίνηση.')
      : message === 'Restart into Xbox mode is unavailable in this session.' ? text(message, 'Η επανεκκίνηση σε λειτουργία Xbox δεν είναι διαθέσιμη σε αυτήν τη συνεδρία.')
      : message || text('Xbox mode could not be started. Please try again.', 'Δεν ήταν δυνατή η έναρξη της λειτουργίας Xbox. Δοκιμάστε ξανά.'));
  };
  async function perform(restart: boolean) {
    if (pending.current || !current() || restart && (!status?.available || !bridge)) return;
    pending.current = true; setBusy(true); setError('');
    // Once a native entry/restart request is dispatched, cancellation cannot
    // promise the desktop will remain unchanged. Keep the choice visible until
    // its result arrives; read-only token preparation is still cancellable.
    const lock = () => { locked.current = true; setDispatching(true); };
    try {
      let completed: boolean;
      if (restart) completed = await confirmXboxModeRestart(bridge!, current, lock);
      else { lock(); await startNow(); completed = true; }
      if (completed && current()) complete();
    } catch (value) { if (current()) failure(value); }
    finally { pending.current = false; locked.current = false; if (current()) { setDispatching(false); setBusy(false); } }
  }
  const content = <div className="xbox-mode-entry-backdrop">
    <section ref={root} className="xbox-mode-entry-dialog" role="dialog" aria-modal="true" aria-labelledby="xbox-mode-entry-title" aria-describedby="xbox-mode-entry-description" aria-busy={busy || undefined} onKeyDown={event => {
      if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); dismiss(); }
      if (event.key === 'Tab') {
        const buttons = [...(root.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
        if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1)?.focus(); }
        else if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0]?.focus(); }
      }
    }}>
      <div className="xbox-mode-entry-message">
        <h2 id="xbox-mode-entry-title">{text('Restart into Xbox mode', 'Επανεκκίνηση σε λειτουργία Xbox')}</h2>
        <p id="xbox-mode-entry-description">{text('Restart your PC to open Xbox mode after you sign in, or start now without restarting. Restarting GNOME does not apply additional performance optimizations.', 'Κάντε επανεκκίνηση για να ανοίξει η λειτουργία Xbox μετά τη σύνδεση ή ξεκινήστε τώρα. Η επανεκκίνηση του GNOME δεν εφαρμόζει πρόσθετες βελτιστοποιήσεις επιδόσεων.')}</p>
        {!status ? <p className="xbox-mode-entry-status" role="status">{text('Checking restart availability…', 'Έλεγχος διαθεσιμότητας επανεκκίνησης…')}</p> : !status.available ? <p className="xbox-mode-entry-status" role="status">{status.reason}</p> : null}
        {error ? <p className="xbox-mode-entry-error" role="alert">{error}</p> : null}
      </div>
      <div className="xbox-mode-entry-actions">
        <button className="xbox-mode-entry-restart" data-xbox-mode-action="restart" disabled={busy || !status?.available} onClick={() => void perform(true)}>{text('Restart', 'Επανεκκίνηση')}</button>
        <button data-xbox-mode-action="start" disabled={busy} onClick={() => void perform(false)}>{text('Start now (no performance changes)', 'Έναρξη τώρα (δεν υπάρχουν αλλαγές επιδόσεων)')}</button>
        <button data-xbox-mode-action="remain" data-gamepad-initial data-gamepad-cancel disabled={dispatching} onClick={dismiss}>{text('Remain on desktop', 'Παραμείνετε στην επιφάνεια εργασίας')}</button>
      </div>
    </section>
  </div>;
  return typeof document === 'undefined' ? content : createPortal(content, document.body);
}
