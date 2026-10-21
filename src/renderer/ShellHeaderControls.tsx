import { useEffect, useRef, useState } from 'react';
import { Maximize } from './XboxIcons';
import { BatteryStatus } from './BatteryStatus';
import { useReferenceLocale } from './ReferenceLocale';
import './shell-header-controls.css';
import { XboxModeEntryDialog } from './XboxModeEntryDialog';

export interface NativeFullscreenBridge {
  getWindowFullscreen?(): Promise<boolean>;
  onWindowFullscreenChanged?(callback: (fullscreen: boolean) => void): () => void;
  setWindowFullscreen?(fullscreen: boolean): Promise<boolean>;
  getFullscreenExperience?(): Promise<{ available: boolean }>;
}
export type FullscreenDocument = Pick<Document, 'fullscreenElement' | 'addEventListener' | 'removeEventListener'> & {
  fullscreenEnabled?: boolean;
  documentElement: { requestFullscreen?: () => Promise<void> };
};
export interface WindowFullscreenState { documentFullscreen: boolean; nativeFullscreen: boolean }

export function shellIsFullscreen(sessionFullscreen: boolean, state: WindowFullscreenState): boolean {
  return sessionFullscreen || state.documentFullscreen || state.nativeFullscreen;
}

/** Main confirms focus before sending. Read it again after the renderer has
 * mounted; a delayed snapshot or native-state read must not reopen old intent. */
export function observeXboxModeEntryRequests(surface: { fullscreenElement: object | null; hasFocus(): boolean },
  bridge: Pick<import('../shared/types').LauncherApi, 'onXboxModeEntryRequested' | 'getWindowFullscreen'>,
  allowed: () => boolean, open: () => void) {
  let active = true, revision = 0;
  const eligible = () => active && allowed() && surface.hasFocus() && !surface.fullscreenElement;
  const unsubscribe = bridge.onXboxModeEntryRequested?.(() => {
    const request = ++revision;
    if (!eligible() || !bridge.getWindowFullscreen) return;
    void bridge.getWindowFullscreen().then(fullscreen => {
      if (request === revision && fullscreen === false && eligible()) open();
    }).catch(() => { /* An unknown native mode cannot authorize this handoff. */ });
  });
  return () => { active = false; revision++; unsubscribe?.(); };
}

/** A native event supersedes an older asynchronous initial read. No click or
 * renderer attribute is treated as proof that fullscreen was entered. */
export function observeWindowFullscreen(document: FullscreenDocument, bridge: NativeFullscreenBridge | undefined, changed: (state: WindowFullscreenState) => void) {
  let active = true, revision = 0, nativeFullscreen = false;
  const emit = () => { if (active) changed({ documentFullscreen: Boolean(document.fullscreenElement), nativeFullscreen }); };
  const setNative = (value: boolean) => { if (active) { revision++; nativeFullscreen = value === true; emit(); } };
  const documentChanged = () => emit();
  document.addEventListener('fullscreenchange', documentChanged);
  const unsubscribe = bridge?.onWindowFullscreenChanged?.(setNative);
  const readRevision = revision;
  if (bridge?.getWindowFullscreen) void bridge.getWindowFullscreen().then(value => {
    if (active && revision === readRevision) { nativeFullscreen = value === true; emit(); }
  }).catch(() => { /* DOM and session state remain usable without a native read. */ });
  emit();
  return { revision: () => revision, setNative, stop() { active = false; document.removeEventListener('fullscreenchange', documentChanged); unsubscribe?.(); } };
}

export async function enterWindowFullscreen(document: FullscreenDocument, bridge?: NativeFullscreenBridge): Promise<'native' | 'document'> {
  if (bridge?.setWindowFullscreen) {
    if (await bridge.setWindowFullscreen(true) !== true) throw new Error('The fullscreen window could not be opened.');
    return 'native';
  }
  if (document.fullscreenEnabled === false || !document.documentElement.requestFullscreen) throw new Error('Fullscreen is unavailable in this window.');
  await document.documentElement.requestFullscreen();
  return 'document';
}

export function formatShellClock(now: Date, language: 'en' | 'el'): string {
  return now.toLocaleTimeString(language === 'el' ? 'el-GR' : undefined, { hour: 'numeric', minute: '2-digit' })
    .replace(/π\.μ\./g, 'πμ').replace(/μ\.μ\./g, 'μμ').replace(/[\u00a0\u202f]/g, ' ');
}
export function ShellClock() {
  const { language } = useReferenceLocale();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 30000); return () => window.clearInterval(timer); }, []);
  return <time className="shell-clock" dateTime={now.toISOString()}>{formatShellClock(now, language)}</time>;
}

export function ShellHeaderControls({ sessionFullscreen, integrationAvailable, onError, onNotice }: {
  sessionFullscreen: boolean;
  integrationAvailable?: boolean;
  onError: (message: string) => void;
  onNotice?: (message: string) => void;
}) {
  const { text } = useReferenceLocale();
  const [state, setState] = useState<WindowFullscreenState>(() => ({ documentFullscreen: typeof document !== 'undefined' && Boolean(document.fullscreenElement), nativeFullscreen: false }));
  const [busy, setBusy] = useState(false);
  const [entryOpen, setEntryOpen] = useState(false);
  const entryButton = useRef<HTMLButtonElement>(null);
  const restoreEntryFocus = useRef(false);
  const observer = useRef<ReturnType<typeof observeWindowFullscreen>>();
  const pending = useRef(false), mounted = useRef(false);
  const full = shellIsFullscreen(sessionFullscreen, state);
  useEffect(() => {
    mounted.current = true;
    observer.current = observeWindowFullscreen(document, window.launcher, setState);
    return () => { mounted.current = false; observer.current?.stop(); observer.current = undefined; };
  }, []);
  useEffect(() => {
    document.documentElement.toggleAttribute('data-fullscreen-experience', full);
    window.dispatchEvent(new CustomEvent('xboks-fullscreen-experience', { detail: full }));
  }, [full]);
  useEffect(() => observeXboxModeEntryRequests(document, window.launcher,
    () => !full && mounted.current && !pending.current, () => setEntryOpen(true)), [full]);
  useEffect(() => { if (full) setEntryOpen(false); }, [full]);
  useEffect(() => {
    if (entryOpen || !restoreEntryFocus.current) return;
    restoreEntryFocus.current = false;
    // The portaled dialog's passive cleanup restores the app's inert state.
    // Request focus afterwards, so it is not discarded by an inert parent.
    const frame = requestAnimationFrame(() => entryButton.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [entryOpen]);
  async function enter() {
    if (pending.current) return;
    pending.current = true; setBusy(true);
    const revision = observer.current?.revision();
    try {
      const entered = await enterWindowFullscreen(document, window.launcher);
      if (!mounted.current) return;
      const current = observer.current;
      if (entered === 'native') { if (current && current.revision() === revision) current.setNative(true); }
      else setState(value => ({ ...value, documentFullscreen: Boolean(document.fullscreenElement) }));
      let integrationUnavailable = entered === 'document' && integrationAvailable === false;
      if (entered === 'native' && window.launcher.getFullscreenExperience) {
        try { integrationUnavailable = (await window.launcher.getFullscreenExperience()).available === false; }
        catch { /* A missing status read cannot prove integration unavailable. */ }
      }
      if (mounted.current && integrationUnavailable) onNotice?.(text('The fullscreen window is open. System Xbox mode is unavailable in this session.', 'Το παράθυρο πλήρους οθόνης άνοιξε. Η λειτουργία Xbox του συστήματος δεν είναι διαθέσιμη σε αυτήν τη συνεδρία.'));
    } catch (error) {
      if (mounted.current) onError(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error:\s*/, '') : String(error));
      throw error;
    } finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  const closeEntry = () => { restoreEntryFocus.current = true; setEntryOpen(false); };
  return <><div className="shell-tools shell-header-controls" data-shell-display-mode={full ? 'fullscreen' : 'desktop'}>
    {full ? <><BatteryStatus /><ShellClock /></> : <button ref={entryButton} className="xbox-mode-entry" disabled={busy} aria-label={text('Xbox mode', 'Λειτουργία Xbox')} onClick={() => setEntryOpen(true)}>
      <Maximize /><span>{text('Xbox mode', 'Λειτουργία Xbox')}</span>
    </button>}
  </div>{entryOpen ? <XboxModeEntryDialog startNow={enter} close={closeEntry} /> : null}</>;
}
