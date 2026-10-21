import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { InstallPlan, InstallRequest } from '../shared/types';

type Install = (request: InstallRequest) => Promise<string | undefined>;
const InstallContext = createContext<Install>(async () => { throw Error('Installation dialog is unavailable.'); });
export const usePackageInstall = () => useContext(InstallContext);

export function PackageDialog({ plan, choose }: { plan: InstallPlan; choose: (id?: string) => void }) {
  const [selected, setSelected] = useState('');
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') choose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [choose]);
  return <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) choose(); }}>
    <section className="game-dialog package-dialog" role="dialog" aria-modal="true" aria-labelledby="package-dialog-title">
      <h2 id="package-dialog-title">Choose files to install</h2>
      <p>Choose the package you want to install from this Store offer. xboks Engine checks your license before downloading.</p>
      <div className="package-choices">{plan.choices.map(item => <label className={`package-choice${item.supported ? '' : ' unsupported'}`} key={`${item.productId}:${item.contentId}`}>
        <input type="radio" name="install-package" value={item.contentId} disabled={!item.supported} checked={selected === item.contentId} onChange={() => setSelected(item.contentId)} />
        <span><strong>{item.title}</strong><small>{item.platform || 'Unknown platform'} · {item.packageFormat || 'Unknown format'}{item.kind === 'GameAddOn' ? ' · Add-on' : ''}{!item.supported ? ' · Unsupported' : ''}</small><small>Store ID {item.productId}</small><small className="package-content-id">Package {item.contentId}</small></span>
      </label>)}</div>
      <div className="dialog-actions"><button className="secondary" data-gamepad-cancel onClick={() => choose()}>Cancel</button><button className="primary" disabled={!selected} onClick={() => choose(selected)}>Install selected package</button></div>
    </section>
  </div>;
}

export function PackageInstallProvider({ children }: { children: ReactNode }) {
  const [plan, setPlan] = useState<InstallPlan>();
  const pending = useRef<((id?: string) => void)>();
  const busy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; pending.current?.(); }; }, []);
  function choose(id?: string) { pending.current?.(id); pending.current = undefined; setPlan(undefined); }
  const install: Install = async request => {
    if (busy.current) throw Error('Finish the current package selection first.');
    busy.current = true;
    try {
      const result = await window.launcher.getInstallPlan(request.productId);
      if (!mounted.current) return;
      if (result.status === 'unavailable') throw Error('No supported Windows.Desktop MSIXVC package was found for this Store offer.');
      const selected = result.status === 'ready' ? result.choices.find(item => item.supported)!.contentId
        : await new Promise<string | undefined>(resolve => { pending.current = resolve; setPlan(result); });
      if (!selected || !mounted.current) return;
      return await window.launcher.startInstall({ ...request, selectedContentId: selected, selectionMarket: result.market });
    } finally { busy.current = false; }
  };
  return <InstallContext.Provider value={install}>{children}{plan ? <PackageDialog plan={plan} choose={choose} /> : null}</InstallContext.Provider>;
}
