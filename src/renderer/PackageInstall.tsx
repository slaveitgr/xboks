import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { InstallChoice, InstallPlan, InstallRequest } from '../shared/types';
import { ChevronLeft, FolderOpen, Gamepad2, X } from './XboxIcons';
import { useBackHandler } from './GamepadNavigation';
import { useReferenceLocale } from './ReferenceLocale';
import './package-install.css';

export interface InstallPresentation { productId: string; posterUrl?: string }
export interface InstallDialogSelection { contentId: string; destination: string }
type Install = (request: InstallRequest, presentation?: InstallPresentation) => Promise<string | undefined>;
const InstallContext = createContext<Install>(async () => { throw Error('Installation dialog is unavailable.'); });
export const usePackageInstall = () => useContext(InstallContext);
type InstallStage = 'packages' | 'contents' | 'location';
const useInstallLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** Only a ready, single base-game plan may skip the alternative-package step.
 * GameAddOn alternatives remain an explicit choice, never optional chunks. */
export function initialInstallContent(plan: InstallPlan): string | undefined {
  const supported = plan.choices.filter(item => item.supported);
  return plan.status === 'ready' && supported.length === 1 && supported[0].kind === 'Game' ? supported[0].contentId : undefined;
}
function ChoiceArt({ item, presentation }: { item: InstallChoice; presentation?: InstallPresentation }) {
  const [failed, setFailed] = useState(false);
  const image = presentation?.productId === item.productId ? presentation.posterUrl : undefined;
  useEffect(() => setFailed(false), [image]);
  return <span className="package-content-art" aria-hidden="true">{image && !failed ? <img src={image} alt="" onError={() => setFailed(true)} /> : <Gamepad2 />}</span>;
}

export function PackageDialog({ plan, request, presentation, choose }: {
  plan: InstallPlan; request: InstallRequest; presentation?: InstallPresentation;
  choose: (selection?: InstallDialogSelection) => void;
}) {
  const { text } = useReferenceLocale();
  const initial = initialInstallContent(plan);
  const [selected, setSelected] = useState(initial ?? '');
  const [stage, setStage] = useState<InstallStage>(initial ? 'contents' : 'packages');
  const [destination, setDestination] = useState(request.destination);
  const [choosingFolder, setChoosingFolder] = useState(false), [error, setError] = useState('');
  const root = useRef<HTMLElement>(null), alive = useRef(false), folderPending = useRef(false), finished = useRef(false);
  const item = plan.choices.find(item => item.supported && item.contentId === selected);
  const finish = (value?: InstallDialogSelection) => { if (!finished.current) { finished.current = true; choose(value); } };
  const back = () => {
    if (folderPending.current) return true;
    setError('');
    if (stage === 'location') setStage('contents');
    else if (stage === 'contents' && !initial) setStage('packages');
    else finish();
    return true;
  };
  useBackHandler(back, true, () => root.current);
  useInstallLayoutEffect(() => {
    alive.current = true;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const shell = document.querySelector<HTMLElement>('.app-shell'), wasInert = shell?.inert ?? false;
    if (shell) shell.inert = true;
    return () => {
      alive.current = false; if (shell) shell.inert = wasInert;
      requestAnimationFrame(() => {
        if (!previous?.isConnected || previous.closest('[inert]')) return;
        const top = [...document.querySelectorAll<HTMLElement>('[aria-modal="true"]')].filter(element => element.getClientRects().length).at(-1);
        if (!top || top.contains(previous)) previous.focus({ preventScroll: true });
      });
    };
  }, []);
  useInstallLayoutEffect(() => {
    const selectedChoice = stage === 'packages' ? root.current?.querySelector<HTMLElement>('input[type="radio"]:checked:not(:disabled)') : undefined;
    (selectedChoice ?? root.current?.querySelector<HTMLElement>('[data-install-initial-focus]:not(:disabled)'))?.focus({ preventScroll: true });
  }, [stage]);
  async function chooseFolder() {
    if (folderPending.current || typeof window.launcher?.chooseDirectory !== 'function') return;
    folderPending.current = true; setChoosingFolder(true); setError('');
    try { const path = await window.launcher.chooseDirectory(destination); if (alive.current && path) setDestination(path); }
    catch { if (alive.current) setError(text('The install location could not be selected.', 'Δεν ήταν δυνατή η επιλογή θέσης εγκατάστασης.')); }
    finally { folderPending.current = false; if (alive.current) { setChoosingFolder(false); root.current?.querySelector<HTMLButtonElement>('[data-install-change-location]')?.focus(); } }
  }
  const kind = (choice: InstallChoice) => choice.kind === 'GameAddOn' ? text('Add-on', 'Πρόσθετο') : choice.kind === 'Game' ? text('Base game', 'Κυρίως παιχνίδι') : text('Package', 'Πακέτο');
  const title = stage === 'packages' ? text('Select a package', 'Επιλέξτε πακέτο') : stage === 'location' ? text('Install', 'Εγκατάσταση') : text('Select the items to install', 'Επιλέξτε τα στοιχεία που θα εγκατασταθούν');
  return <div className="dialog-backdrop package-install-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !folderPending.current) finish(); }}>
    <section ref={root} className="game-dialog package-dialog" data-install-stage={stage} role="dialog" aria-modal="true" aria-labelledby="package-dialog-title" aria-busy={choosingFolder || undefined} onKeyDown={event => {
      if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); back(); }
      if (event.key !== 'Tab' || event.defaultPrevented) return;
      const controls = [...(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),a[href]') ?? [])].filter(element => element.getClientRects().length > 0);
      const first = controls[0], last = controls.at(-1);
      if (!root.current?.contains(document.activeElement) || event.shiftKey && document.activeElement === first || !event.shiftKey && document.activeElement === last) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); }
    }}>
      <header className="package-dialog-header"><h2 id="package-dialog-title">{title}</h2><button className="package-dialog-close" data-gamepad-cancel aria-label={text('Cancel installation', 'Ακύρωση εγκατάστασης')} disabled={choosingFolder} onClick={() => finish()}><X /></button></header>
      <div className="package-dialog-body">
        {stage === 'packages' ? <div className="package-choices" role="radiogroup" aria-label={text('Available packages', 'Διαθέσιμα πακέτα')}>{plan.choices.map((choice, index) => <label className={`package-choice${choice.supported ? '' : ' unsupported'}`} key={choice.contentId}>
          <ChoiceArt item={choice} presentation={presentation} /><span className="package-content-copy"><strong>{choice.title}</strong><small>{kind(choice)} · {choice.platform === 'Windows.Desktop' ? 'PC' : choice.platform === 'Xbox.One' ? 'Xbox One' : choice.platform}</small>{!choice.supported ? <small>{text('Not available on this device', 'Δεν διατίθεται σε αυτήν τη συσκευή')}</small> : null}</span>
          <input type="radio" name="install-package" aria-label={choice.title} value={choice.contentId} disabled={!choice.supported} checked={selected === choice.contentId} data-install-initial-focus={choice.supported && !plan.choices.slice(0, index).some(item => item.supported) || undefined} onChange={() => setSelected(choice.contentId)} />
        </label>)}</div> : item ? <>
          <div className="package-content-required"><ChoiceArt item={item} presentation={presentation} /><span className="package-content-copy"><strong>{item.title}</strong><small>{kind(item)}</small><small>{text('Size unavailable', 'Μη διαθέσιμο μέγεθος')}</small></span>{stage === 'contents' ? <label className="package-content-required-mark"><span>{text('Required', 'Απαιτείται')}</span><input type="checkbox" checked disabled aria-label={text(`Required: ${item.title}`, `Απαιτείται: ${item.title}`)} /></label> : null}</div>
          {stage === 'location' ? <div className="package-install-location"><label htmlFor="package-install-destination">{text('Install location', 'Θέση εγκατάστασης')}</label><output id="package-install-destination">{destination}</output><button className="secondary" data-install-change-location data-install-initial-focus disabled={choosingFolder || typeof window === 'undefined' || typeof window.launcher?.chooseDirectory !== 'function'} onClick={() => void chooseFolder()}><FolderOpen />{text('Change location', 'Αλλαγή θέσης')}</button></div> : null}
        </> : null}
        {error ? <p className="package-install-error" role="alert">{error}</p> : null}
      </div>
      <footer className="package-dialog-footer"><p className="package-disk-space" role="status">{text('Disk space requirement unavailable', 'Οι απαιτήσεις χώρου στον δίσκο δεν είναι διαθέσιμες')}</p>
        {stage === 'location' ? <div className="package-location-actions"><button className="secondary package-step-back" disabled={choosingFolder} onClick={back} aria-label={text('Back', 'Πίσω')}><ChevronLeft /></button><button className="primary" disabled={!item || !destination.trim() || choosingFolder} onClick={() => { if (item) finish({ contentId: item.contentId, destination }); }}>{text('Install', 'Εγκατάσταση')}</button></div> : <button className="primary" data-install-initial-focus={stage === 'contents' || undefined} disabled={!item} onClick={() => { if (item) setStage(stage === 'packages' ? 'contents' : 'location'); }}>{text('Next', 'Επόμενο')}</button>}
      </footer>
    </section>
  </div>;
}

export function PackageInstallProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<{ id: number; plan: InstallPlan; request: InstallRequest; presentation?: InstallPresentation }>();
  const pending = useRef<((selection?: InstallDialogSelection) => void)>();
  const busy = useRef(false), mounted = useRef(true), sequence = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; pending.current?.(); pending.current = undefined; }; }, []);
  function choose(selection?: InstallDialogSelection) { const done = pending.current; pending.current = undefined; setDialog(undefined); done?.(selection); }
  const install: Install = async (request, presentation) => {
    if (busy.current) throw Error('Finish the current package selection first.');
    busy.current = true;
    try {
      const result = await window.launcher.getInstallPlan(request.productId);
      if (!mounted.current) return;
      if (result.status === 'unavailable') throw Error('No supported Windows.Desktop MSIXVC package was found for this Store offer.');
      const selected = await new Promise<InstallDialogSelection | undefined>(resolve => { pending.current = resolve; setDialog({ id: ++sequence.current, plan: result, request, presentation }); });
      if (!selected || !mounted.current) return;
      return await window.launcher.startInstall({ ...request, destination: selected.destination, selectedContentId: selected.contentId, selectionMarket: result.market });
    } finally { busy.current = false; }
  };
  return <InstallContext.Provider value={install}>{children}{dialog ? <PackageDialog key={dialog.id} {...dialog} choose={choose} /> : null}</InstallContext.Provider>;
}
